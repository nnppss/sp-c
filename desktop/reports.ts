import type { DatabaseSync } from 'node:sqlite';
import { check, fields, getChart, getDayBook, getLedger, getTrialBalance, period, readInvoiceSnapshot } from './accounting';
import type { Period, TrialBalance } from './books';
import { invoiceDirection, TAX_COMPONENTS } from './invoices';
import type { InvoiceSide } from './invoices';
import { REPORT_TITLES } from './report-model';
import type { Report, ReportCell, ReportKind, ReportTable } from './report-model';

const sum = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);
const voucher = (firmId: number, id: number): ReportCell => ({ label: '#' + id, source: { firmId, id, view: 'voucher' } });
const invoice = (firmId: number, id: number, label: string): ReportCell => ({ label, source: { firmId, id, view: 'invoice' } });
const ledger = (firmId: number, id: number, label: string, period: Period): ReportCell =>
  ({ label, source: { firmId, id, period, view: 'ledger' } });

function financial(db: DatabaseSync, firmId: number, query: Period, kind: 'trial' | 'pnl' | 'balance'): ReportTable[] {
  const { rows, debit, credit } = getTrialBalance(db, firmId, kind === 'pnl' ? query : { to: query.to });
  type Row = TrialBalance['rows'][number];
  const accountLink = (row: Row) => ledger(firmId, row.id, row.name + (row.archived ? ' (archived)' : ''), query);
  if (kind === 'trial') return [{
    title: 'Trial balance', columns: ['Account', 'Debit balance (₹)', 'Credit balance (₹)'],
    rows: rows.map(row => [accountLink(row), row.balance > 0n ? row.balance : '', row.balance < 0n ? -row.balance : '']),
    totals: [['Total', debit, credit]],
  }];

  function section(title: string, accounts: Row[], sign = 1n, extra: [ReportCell, bigint][] = []) {
    const movements: [ReportCell, bigint][] = [...accounts.map((row): [ReportCell, bigint] =>
      [accountLink(row), row.balance * sign]), ...extra];
    const total = sum(movements.map(([, value]) => value));
    return { title, columns: ['Account', 'Amount (₹)'], rows: movements, total, totals: [['Total ' + title.toLowerCase(), total]] };
  }

  const income = rows.filter(row => row.kind === 'income');
  const expenses = rows.filter(row => row.kind === 'expense');
  const profit = -sum([...income, ...expenses].map(row => row.balance));
  if (kind === 'pnl') return [section('Income', income, -1n), section('Expenses', expenses),
    { title: 'Result', columns: ['Measure', 'Amount (₹)'], rows: [], totals: [['Net profit / (loss)', profit]] }];

  const positions = rows.filter(row => row.balance !== 0n);
  const assetKinds = ['asset', 'cash', 'bank'];
  const signBased = ['party', 'contractor', 'employee'];
  const assets = section('Assets', positions.filter(row =>
    assetKinds.includes(row.kind) && (row.kind !== 'bank' || row.balance > 0n) || signBased.includes(row.kind) && row.balance > 0n));
  const liabilities = section('Liabilities', positions.filter(row =>
    row.kind === 'liability' || (signBased.includes(row.kind) || row.kind === 'bank') && row.balance < 0n), -1n);
  const equity = section('Equity', positions.filter(row => row.kind === 'equity'), -1n, [
    [{ label: 'Cumulative profit / (loss)', source: { firmId, view: 'pnl', period: query } }, profit],
  ]);
  const funding = liabilities.total + equity.total;
  return [assets, liabilities, equity, {
    title: 'Balance check', columns: ['Measure', 'Amount (₹)'], rows: [],
    totals: [['Total assets', assets.total], ['Total liabilities and equity', funding], ['Difference', assets.total - funding]],
  }];
}

function journals(db: DatabaseSync, firmId: number, query: Period, name: 'day' | 'ledger', accountId: unknown): ReportTable[] {
  if (name === 'day') {
    const { rows } = getDayBook(db, firmId, query, true);
    return [{
      title: 'Day book', columns: ['Voucher', 'Date', 'Type', 'Narration', 'Amount (₹)'],
      rows: rows.map(row => [voucher(firmId, row.id), row.day, row.kind, row.memo, BigInt(row.amount)]),
      totals: [['Total', '', '', '', sum(rows.map(row => BigInt(row.amount)))]],
    }];
  }
  check(typeof accountId === 'number', 'Choose an account for the ledger.');
  const { rows, opening, closing } = getLedger(db, firmId, { ...query, accountId }, false, true);
  const chart = getChart(db, firmId);
  return [{
    title: chart.accounts.find(row => row.id === accountId)!.name + ' ledger',
    columns: ['Voucher', 'Date', 'Narration', 'Site', 'Debit (₹)', 'Credit (₹)', 'Balance (₹)'],
    rows: rows.map(row => [voucher(firmId, row.voucherId), row.day, row.memo || row.kind,
      chart.sites.find(site => site.id === row.siteId)?.name ?? '', row.value > 0 ? BigInt(row.value) : '',
      row.value < 0 ? BigInt(-row.value) : '', row.running]),
    totals: [['Opening balance', '', '', '', '', '', opening],
      ['Period movement', '', '', '', sum(rows.map(row => BigInt(Math.max(row.value, 0)))),
        sum(rows.map(row => BigInt(Math.max(-row.value, 0)))), closing - opening],
      ['Closing balance', '', '', '', '', '', closing]],
  }];
}

function outstanding(db: DatabaseSync, firmId: number, to: string | null): ReportTable[] {
  const rows = db.prepare(`SELECT i.voucher_id AS id, i.number, i.side, v.document ->> '$.party' AS party, v.day, v.amount,
      CAST(SUM(m.amount) AS TEXT) AS balance,
      CAST(SUM(m.amount) FILTER (WHERE m.application = 1) AS TEXT) AS applied
    FROM invoice_records i JOIN vouchers v ON v.id = i.voucher_id
    JOIN bill_movements m ON m.bill_id = i.voucher_id
    WHERE i.firm_id = $firm AND i.original_id IS NULL AND ($to IS NULL OR m.day <= $to)
    GROUP BY i.voucher_id HAVING SUM(m.amount) <> 0 ORDER BY v.day, i.voucher_id`)
    .all({ firm: firmId, to }) as { id: number; number: string; side: InvoiceSide; party: string; day: string;
      amount: number; balance: string; applied: string | null }[];
  return (['Sale', 'Purchase'] as const).map(side => {
    const amounts = rows.filter(row => row.side === side).map(row => {
      const face = BigInt(row.amount);
      const balance = BigInt(row.balance);
      const paid = -BigInt(row.applied ?? '0');
      return { ...row, face, balance, paid, adjustments: balance + paid - face };
    });
    return {
      title: side === 'Sale' ? 'Receivables' : 'Payables',
      columns: ['Invoice', 'Date', 'Party', 'Invoiced (₹)', 'Notes (₹)', 'Applied (₹)', 'Outstanding (₹)'],
      rows: amounts.map(row => [invoice(firmId, row.id, row.number), row.day, row.party, row.face, row.adjustments, row.paid, row.balance]),
      totals: [['Total', '', '', ...(['face', 'adjustments', 'paid', 'balance'] as const).map(key => sum(amounts.map(row => row[key])))]],
    };
  });
}

function documents(db: DatabaseSync, firmId: number, from: string | null, to: string | null,
  kind: 'sales' | 'purchases' | 'gst' | 'allocations', combined: boolean): ReportTable[] {
  const params = { firm: firmId, from, to, allocations: kind === 'allocations' ? 1 : 0, combined: combined ? 1 : 0 };
  const rows = db.prepare(`WITH movements AS (
    SELECT i.voucher_id AS id, i.firm_id AS firmId, i.side, v.day, v.day AS issuedDay, v.document, v.amount,
      NULL AS reversalId FROM invoice_records i JOIN vouchers v ON v.id = i.voucher_id
    UNION ALL SELECT i.voucher_id, i.firm_id, i.side, r.day, v.day, v.document, v.amount, r.id
    FROM invoice_records i JOIN vouchers v ON v.id = i.voucher_id JOIN vouchers r ON r.reverses_id = v.id
  )
  SELECT * FROM movements WHERE ($from IS NULL OR day >= $from) AND ($to IS NULL OR day <= $to) AND
    (CASE WHEN NOT $allocations THEN firmId = $firm
     WHEN $combined THEN 1 ELSE EXISTS (SELECT 1 FROM invoice_allocations a WHERE a.invoice_id = id AND a.firm_id = $firm) END)
    ORDER BY day, COALESCE(reversalId, id)`).all(params) as {
    id: number; firmId: number; side: InvoiceSide; day: string; issuedDay: string; amount: number; document: string; reversalId: number | null;
  }[];
  const records = rows.map(row => {
    const snapshot = readInvoiceSnapshot({ ...row, day: row.issuedDay });
    const sign = BigInt(invoiceDirection(row.side, snapshot.document) * (row.reversalId === null ? 1 : -1));
    return { ...row, snapshot, sign, source: invoice(row.firmId, row.id, snapshot.number),
      type: row.reversalId === null ? snapshot.document : 'Reversal', reversal: row.reversalId === null ? '' : voucher(row.firmId, row.reversalId) };
  });
  if (kind === 'allocations') {
    const shares = records.flatMap(row => row.snapshot.allocations.filter(a => combined || a.firmId === firmId).map(a =>
      ({ ...row, beneficiary: a.firmName, beneficiaryId: a.firmId, value: BigInt(a.amount) * row.sign })));
    const firms = new Map<number, { label: string; sale: bigint; purchase: bigint }>();
    for (const row of shares) {
      const totals = firms.get(row.beneficiaryId) ?? { label: row.beneficiary, sale: 0n, purchase: 0n };
      if (row.side === 'Sale') totals.sale += row.value;
      else totals.purchase += row.value;
      firms.set(row.beneficiaryId, totals);
    }
    const sale = sum([...firms.values()].map(row => row.sale));
    const purchase = sum([...firms.values()].map(row => row.purchase));
    return [{
      title: 'Allocated by beneficiary', columns: ['Beneficiary', 'Sales (₹)', 'Purchases (₹)', 'Combined pre-tax (₹)'],
      rows: [...firms.values()].map(row => [row.label, row.sale, row.purchase, row.sale + row.purchase]),
      totals: [['Total allocated', sale, purchase, sale + purchase]],
    }, {
      title: 'Allocation sources',
      columns: ['Invoice', 'Date', 'Booking firm', 'Side', 'Document', 'Beneficiary', 'Allocated pre-tax (₹)', 'Reversal voucher'],
      rows: shares.map(row => [row.source, row.day, row.snapshot.booking.name, row.side, row.type, row.beneficiary, row.value, row.reversal]),
      totals: [['Total allocated', '', '', '', '', '', sale + purchase, '']],
    }];
  }

  const breakdown = (side: InvoiceSide) => {
    const selected = records.filter(row => row.side === side);
    const taxes = ['base', ...TAX_COMPONENTS, 'total'] as const;
    const totals = taxes.map(key => sum(selected.map(row => BigInt(row.snapshot.totals[key]) * row.sign)));
    const table: ReportTable = {
      title: kind === 'gst' ? (side === 'Sale' ? 'Output GST' : 'Input GST') : REPORT_TITLES[kind],
      columns: ['Invoice', 'Date', 'Party', 'Document', 'Pre-tax (₹)', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)', 'Total (₹)', 'Reversal voucher'],
      rows: selected.map(row => [row.source, row.day, row.snapshot.party, row.type,
        ...taxes.map(key => BigInt(row.snapshot.totals[key]) * row.sign), row.reversal]),
      totals: [['Total', '', '', '', ...totals, '']],
    };
    return { table, totals };
  };
  if (kind === 'sales' || kind === 'purchases') return [breakdown(kind === 'sales' ? 'Sale' : 'Purchase').table];
  const output = breakdown('Sale');
  const input = breakdown('Purchase');
  return [output.table, input.table, {
    title: 'GST totals', columns: ['Measure', 'CGST (₹)', 'SGST (₹)', 'IGST (₹)'], rows: [],
    totals: [['Output less input', ...output.totals.slice(1, 4).map((value, index) => value - input.totals[index + 1])]],
  }];
}

function reconciliation(db: DatabaseSync, firmId: number, query: Period, from: string | null, to: string | null): ReportTable[] {
  const params = { firm: firmId, from, to };
  const banks = getChart(db, firmId).accounts.filter(account => account.kind === 'bank');
  const statement = db.prepare(`SELECT s.id, s.day, s.bank_id AS accountId, s.description, s.reference, s.value, s.row_number AS rowNumber,
    (SELECT m.voucher_id FROM statement_match_history m
      WHERE m.statement_id = s.id AND NOT EXISTS (SELECT 1 FROM vouchers r WHERE r.reverses_id = m.voucher_id
        AND ($to IS NULL OR r.day <= $to)) ORDER BY m.id DESC LIMIT 1) AS voucherId
    FROM statement_rows s WHERE s.firm_id = $firm AND ($from IS NULL OR s.day >= $from) AND ($to IS NULL OR s.day <= $to)
    ORDER BY s.day, s.id`).all(params) as {
    id: number; day: string; accountId: number; description: string; reference: string;
    value: number; rowNumber: number; voucherId: number | null;
  }[];
  const book = db.prepare(`SELECT v.day, v.id, a.id AS accountId, v.memo, CAST(SUM(l.value) AS TEXT) AS value,
    COALESCE(original.kind, v.kind) = 'Opening balance' AS opening
    FROM posting_lines l JOIN vouchers v ON v.id = l.voucher_id JOIN accounts a ON a.id = l.account_id AND a.kind = 'bank'
    LEFT JOIN vouchers original ON original.id = v.reverses_id
    WHERE l.firm_id = $firm AND ($to IS NULL OR v.day <= $to) AND ($from IS NULL OR v.day >= $from)
    GROUP BY a.id, v.id HAVING SUM(l.value) <> 0 ORDER BY v.day, v.id, a.id`).all(params) as {
    day: string; id: number; accountId: number; memo: string; value: string; opening: number;
  }[];
  const linked = new Set(statement.filter(row => row.voucherId !== null).map(row => row.accountId + ':' + row.voucherId));
  const unmatched = book.filter(row => !row.opening && !linked.has(row.accountId + ':' + row.id));
  const balances = getTrialBalance(db, firmId, { to: query.to });
  const name = (id: number) => banks.find(row => row.id === id)!.name;
  return [{
    title: 'Reconciliation by bank',
    columns: ['Bank ledger', 'Book opening (₹)', 'Book movement (₹)', 'Book closing (₹)',
      'Statement movement (₹)', 'Matched (₹)', 'Unmatched book (₹)', 'Pending statement (₹)', 'Movement difference (₹)'],
    rows: banks.map(bank => {
      const movement = sum(book.filter(row => row.accountId === bank.id && !row.opening).map(row => BigInt(row.value)));
      const closing = balances.rows.find(row => row.id === bank.id)!.balance;
      const total = sum(statement.filter(row => row.accountId === bank.id).map(row => BigInt(row.value)));
      const pending = sum(statement.filter(row => row.accountId === bank.id && row.voucherId === null).map(row => BigInt(row.value)));
      const outstanding = sum(unmatched.filter(row => row.accountId === bank.id).map(row => BigInt(row.value)));
      return [ledger(firmId, bank.id, bank.name, query), closing - movement, movement, closing,
        total, total - pending, outstanding, pending, movement - total];
    }),
  }, {
    title: 'Statement rows', columns: ['Statement row', 'Date', 'Bank', 'Description', 'Reference', 'Amount (₹)', 'Matched voucher'],
    rows: statement.map(row => [{ label: 'Row ' + row.rowNumber, source: { firmId, view: 'statement', id: row.id, accountId: row.accountId } },
      row.day, name(row.accountId), row.description, row.reference, BigInt(row.value),
      row.voucherId === null ? 'Pending' : voucher(firmId, row.voucherId)]),
  }, {
    title: 'Unmatched book movements', columns: ['Voucher', 'Date', 'Bank', 'Narration', 'Amount (₹)'],
    rows: unmatched.map(row => [voucher(firmId, row.id), row.day, name(row.accountId), row.memo, BigInt(row.value)]),
  }];
}

export function getReport(db: DatabaseSync, firmId: number, value: unknown): Report {
  const input = fields(value);
  check(typeof input.name === 'string' && Object.hasOwn(REPORT_TITLES, input.name), 'Choose a report.');
  const name = input.name as ReportKind;
  const { from, to } = period(input);
  const query = { from: from ?? undefined, to: to ?? undefined };
  const title = REPORT_TITLES[name];
  switch (name) {
    case 'trial':
    case 'balance': return { title, tables: financial(db, firmId, { to: query.to }, name) };
    case 'pnl': return { title, tables: financial(db, firmId, query, name) };
    case 'day':
    case 'ledger': return { title, tables: journals(db, firmId, query, name, input.accountId) };
    case 'bills': return { title, tables: outstanding(db, firmId, to) };
    case 'bank': return { title, tables: reconciliation(db, firmId, query, from, to),
      note: 'The comparison uses imported statement movements and excludes book opening entries from period movements.' };
    case 'sales':
    case 'purchases':
    case 'gst':
    case 'allocations': return { title, tables: documents(db, firmId, from, to, name, input.combined === true) };
  }
}
