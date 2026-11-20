import type { Period } from './books';

export const REPORT_TITLES = {
  trial: 'Trial balance', day: 'Day book', ledger: 'Account ledger', pnl: 'Profit and loss', balance: 'Balance sheet',
  bills: 'Outstanding bills', bank: 'Bank reconciliation', sales: 'Sales register', purchases: 'Purchase register',
  gst: 'GST summary', allocations: 'Firm allocations',
} as const;

export type ReportKind = keyof typeof REPORT_TITLES;
export type ReportQuery = Period & { name: ReportKind; accountId?: number; combined?: boolean };
export type ReportSource = { firmId: number } & (
  { view: 'invoice' | 'voucher'; id: number } |
  { view: 'ledger'; id: number; period: Period } |
  { view: 'statement'; id: number; accountId: number } |
  { view: 'pnl'; period: Period }
);
export type ReportCell = string | bigint | { label: string; source: ReportSource };
export type ReportTable = { title: string; columns: string[]; rows: ReportCell[][]; totals?: ReportCell[][] };
export type Report = { title: string; tables: ReportTable[]; note?: string };

export function formatReportCSV(context: string[], report: Report) {
  const quote = (cell: ReportCell) => {
    if (typeof cell === 'bigint') {
      const absolute = cell < 0n ? -cell : cell;
      return (cell < 0n ? '-' : '') + (absolute / 100n) + '.' + String(absolute % 100n).padStart(2, '0');
    }
    const label = typeof cell === 'string' ? cell : cell.label;
    return '"' + (/^[\s\uFEFF]*[=+\-@\t\r\n]/u.test(label) ? "'" : '') + label.replaceAll('"', '""') + '"';
  };
  return [...context.map(value => [value]), ...(report.note ? [[report.note]] : []), ...report.tables.flatMap(table =>
    [[], [table.title], table.columns, ...table.rows, ...(table.totals ?? [])])]
    .map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}
