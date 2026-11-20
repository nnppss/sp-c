import { read, SSF, utils } from 'xlsx';
import { STATEMENT_FILE_LIMIT } from './books';

const ROW_LIMIT = 30_000;

export class StatementFileError extends Error {}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new StatementFileError(message);
}

function readTable(input: Record<string, unknown>) {
  const { filename, bytes, sheet: selected } = input;
  requireValue(typeof filename === 'string' && filename.length <= 255 && /\.(csv|xlsx)$/i.test(filename),
    'Choose a CSV or XLSX statement.');
  requireValue(bytes instanceof ArrayBuffer && bytes.byteLength > 0 && bytes.byteLength <= STATEMENT_FILE_LIMIT,
    'Choose a non-empty statement up to 8 MB.');
  const xlsx = /\.xlsx$/i.test(filename);
  const data = new Uint8Array(bytes);
  requireValue(!xlsx || (data[0] === 0x50 && data[1] === 0x4b), 'Choose a valid XLSX workbook.');
  let workbook;
  try {
    if (xlsx) workbook = read(data, { sheetRows: ROW_LIMIT + 2, sheets: typeof selected === 'string' ? selected : 0 });
    else {
      const csv = new TextDecoder('utf-8', { fatal: true }).decode(data);
      requireValue(!csv.includes('\0'), 'Save the CSV as UTF-8.');
      workbook = read(csv, { type: 'string', raw: true, sheetRows: ROW_LIMIT + 2, PRN: false });
    }
  } catch {
    throw new StatementFileError('Could not read the statement. Use a UTF-8 CSV or an unprotected XLSX workbook.');
  }
  const sheets = workbook.SheetNames;
  const sheet = selected ?? sheets[0];
  requireValue(typeof sheet === 'string' && sheets.includes(sheet), 'Choose a worksheet in this file.');
  const worksheet = workbook.Sheets[sheet];
  requireValue(worksheet?.['!ref'], 'This worksheet has no statement rows.');
  const range = utils.decode_range(worksheet['!fullref'] ?? worksheet['!ref']);
  requireValue(range.e.r - range.s.r <= ROW_LIMIT && range.e.r < ROW_LIMIT + 1, 'Use a statement with up to 30,000 data rows.');
  requireValue(range.e.c < 128, 'Use a statement with up to 128 columns.');
  const cells = utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: null, blankrows: true });
  const rows = cells.slice(1);
  const header = (cells[0] ?? []).map(value => String(value ?? '').trim());
  const show = (row: number, index: number) => {
    const cell = worksheet[utils.encode_cell({ r: range.s.r + row, c: range.s.c + index })];
    return String(cell?.w ?? cell?.v ?? '').trim();
  };
  requireValue(header.some(Boolean) && rows.length > 0, 'Include a header row followed by statement data.');
  return { filename, sheet, sheets, header, rows, show, xlsx, firstRow: range.s.r + 2,
    date1904: Boolean(workbook.Workbook?.WBProps?.date1904) };
}

export function previewStatement(input: Record<string, unknown>) {
  const { sheet, sheets, header, rows, show } = readTable(input);
  return { sheet, sheets, header, count: rows.length,
    rows: rows.slice(0, 6).map((_, index) => header.map((_, col) => show(index + 1, col))) };
}

function statementDate(value: unknown, date1904: boolean, xlsx: boolean) {
  if (typeof value === 'number' && xlsx && Number.isInteger(value)) {
    const date = SSF.parse_date_code(value, { date1904 });
    if (date) return [String(date.y), String(date.m).padStart(2, '0'), String(date.d).padStart(2, '0')].join('-');
  }
  const text = String(value ?? '').trim();
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (dmy) return [dmy[3], dmy[2].padStart(2, '0'), dmy[1].padStart(2, '0')].join('-');
  return text;
}

function statementAmount(value: unknown) {
  const text = String(value ?? '').trim().replace('−', '-');
  if (!text) return 0;
  const match = /^([+-]?)(?:₹\s*)?(\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.(\d{1,2}))?$/
    .exec(text.startsWith('(') && text.endsWith(')') ? '-' + text.slice(1, -1).trim() : text);
  requireValue(match, 'Enter an amount in rupees with up to two decimal places.');
  const magnitude = BigInt(match[2].replaceAll(',', '')) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  requireValue(magnitude <= BigInt(Number.MAX_SAFE_INTEGER), 'The amount is too large.');
  return match[1] === '-' ? -Number(magnitude) : Number(magnitude);
}

export function mapStatement(input: Record<string, unknown>, validateDate: (value: unknown) => string) {
  const table = readTable(input);
  const mapping = input.mapping as Record<string, unknown> | undefined;
  requireValue(mapping && typeof mapping === 'object' && !Array.isArray(mapping), 'Map the statement columns.');
  const signed = mapping.amount !== undefined;
  const keys = ['date', 'description', ...(mapping.reference === undefined ? [] : ['reference']),
    ...(signed ? ['amount'] : ['debit', 'credit'])];
  const indexes = keys.map(key => {
    const value = mapping[key];
    requireValue(typeof value === 'number' && Number.isInteger(value) && value >= 0 &&
      value < table.header.length, 'Map all required statement columns.');
    return value;
  });
  requireValue(new Set(indexes).size === indexes.length, 'Use different columns for each field.');

  const rows = [];
  for (const [index, row] of table.rows.entries()) {
    if (!row.some(value => value !== null && String(value).trim())) continue;
    const rowNumber = table.firstRow + index;
    try {
      const date = validateDate(statementDate(row[mapping.date as number], table.date1904, table.xlsx));
      const description = table.show(index + 1, mapping.description as number);
      const reference = mapping.reference === undefined ? '' : table.show(index + 1, mapping.reference as number);
      const debit = signed ? 0 : statementAmount(row[mapping.debit as number]);
      const credit = signed ? 0 : statementAmount(row[mapping.credit as number]);
      requireValue(debit >= 0 && credit >= 0 && !(debit && credit), 'Use a positive amount in either Debit or Credit.');
      const value = signed ? statementAmount(row[mapping.amount as number]) : credit - debit;
      requireValue(value !== 0, 'Enter a non-zero statement amount.');
      requireValue(description.length <= 500 && reference.length <= 180, 'The description or reference is too long.');
      rows.push({ day: date, description, reference, value, rowNumber });
    } catch (error) {
      throw new StatementFileError(`Row ${rowNumber}: ${error instanceof Error ? error.message : 'Invalid statement data.'}`);
    }
  }
  requireValue(rows.length > 0, 'No statement transactions found.');
  return { filename: table.filename, sheet: table.sheet, rows };
}
