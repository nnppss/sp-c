import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { PAGE_SIZE } from '../desktop/books';
import type { Chart } from '../desktop/books';
import { formatReportCSV, REPORT_TITLES } from '../desktop/report-model';
import type { ReportCell, ReportKind, ReportQuery, ReportSource } from '../desktop/report-model';
import type { Firm, WorkspaceKind } from '../desktop/workspace';
import { errorMessage, money } from './book-entry';
import { Pagination, Table } from './books';
import { moduleTitle, useModuleReport } from './named-books';
import { OutputActions } from './output';

export type ReportView = { query: ReportQuery; pages?: Record<number, number> };
export const REPORT_HOME: ReportView = { query: { name: 'trial' } };

async function load(workspace: WorkspaceKind, firmId: number, query: ReportQuery) {
  if (query.name === 'ledger' && !query.accountId) return { report: undefined };
  return { report: await window.workspaces.getReport(workspace, firmId, query) };
}

function ReportFilters({ workspace, firm, firms, query, apply }: {
  workspace: WorkspaceKind; firm: Firm; firms: Firm[]; query: ReportQuery;
  apply: (query: ReportQuery, firmId: number) => void;
}) {
  const [firmId, setFirmId] = useState(firm.id);
  const [name, setName] = useState(query.name);
  const [combined, setCombined] = useState(query.combined ?? true);
  const [chart, setChart] = useState<{ firmId: number; chart: Chart }>();
  const [error, setError] = useState('');
  const asOf = name === 'trial' || name === 'balance' || name === 'bills';
  useEffect(() => {
    if (name !== 'ledger') return;
    let active = true;
    window.workspaces.getChart(workspace, firmId).then(result => {
      if (active) setChart({ firmId, chart: result });
    }, error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [workspace, firmId, name]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const from = String(fields.get('from') ?? '') || undefined;
    const to = String(fields.get('to') ?? '') || undefined;
    if (from && to && from > to) {
      setError('The end date must be on or after the start date.');
      return;
    }
    apply({ name, from, to, accountId: name === 'ledger' ? Number(fields.get('account')) || undefined : undefined,
      combined: name === 'allocations' ? combined : undefined }, firmId);
  }

  return <form className="book-filters print-control" onSubmit={submit}>
    <div><label htmlFor="report-name">Report</label>
      <select id="report-name" value={name} onChange={event => setName(event.target.value as ReportKind)}>
        {Object.entries(REPORT_TITLES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></div>
    <div><label htmlFor="report-firm">{name === 'allocations' ? 'Beneficiary firm' : 'Report firm'}</label>
      <select id="report-firm" value={firmId} disabled={name === 'allocations' && combined}
        onChange={event => { setFirmId(Number(event.target.value)); setError(''); }}>
        {firms.map(item => <option key={item.id} value={item.id}>{item.name}{item.archived && ' (archived)'}</option>)}
      </select></div>
    {name === 'allocations' && <div><label htmlFor="report-combined">Allocation scope</label>
      <select id="report-combined" value={combined ? 'all' : 'one'} onChange={event => setCombined(event.target.value === 'all')}>
        <option value="all">All firms</option><option value="one">Selected firm</option>
      </select></div>}
    {name === 'ledger' && <div><label htmlFor="report-account">Account</label>
      <select id="report-account" name="account" key={firmId + ':' + (chart?.firmId ?? 0)}
        defaultValue={firm.id === firmId ? query.accountId ?? '' : ''} required>
        <option value="">Choose an account</option>
        {chart?.firmId === firmId && chart.chart.accounts.map(account => <option key={account.id} value={account.id}>
          {account.name}{account.archived === 1 && ' (archived)'}</option>)}
      </select></div>}
    {!asOf && <div><label htmlFor="report-from">From</label>
      <input id="report-from" name="from" type="date" min="0001-01-01" max="9999-12-31" defaultValue={query.from} /></div>}
    <div><label htmlFor="report-to">{asOf ? 'As of' : 'Through'}</label>
      <input id="report-to" name="to" type="date" min="0001-01-01" max="9999-12-31" defaultValue={query.to} /></div>
    <button type="submit" className="secondary">Apply filters</button>
    {error && <p role="alert" className="error">{error}</p>}
  </form>;
}

export function Reports({ workspace, firm, firms, view, savedFocus, open, source }: {
  workspace: WorkspaceKind; firm: Firm; firms: Firm[]; view: ReportView; savedFocus?: string;
  open: (view: ReportView, firmId: number, replace?: boolean) => void; source: (link: ReportSource) => void;
}) {
  const { query, pages } = view;
  const { result, message } = useModuleReport(workspace, firm.id, query, savedFocus, load);
  const report = result?.report;
  const heading = report?.title ?? REPORT_TITLES[query.name];
  const who = query.name === 'allocations'
    ? query.combined === false ? 'Beneficiary · ' + firm.name : 'Combined · All firms'
    : firm.name;
  const when = query.from ? query.from + ' through ' + (query.to ?? 'latest entry')
    : query.to ? 'Through ' + query.to : 'All dates';
  function renderCell(cell: ReportCell, id: string): ReactNode {
    if (typeof cell === 'bigint') return money(cell);
    if (typeof cell === 'string') return cell || '—';
    return <button id={id} className="book-link" onClick={() => source(cell.source)}>{cell.label}</button>;
  }
  function cells(row: ReportCell[], prefix: string) {
    return row.map((cell, index) => index === 0
      ? <th key={index} scope="row">{renderCell(cell, prefix + '-' + index)}</th>
      : <td key={index} className={typeof cell === 'bigint' ? 'book-amount' : undefined}>{renderCell(cell, prefix + '-' + index)}</td>);
  }
  return <section className="books report-view">
    <ReportFilters key={firm.id + ':' + JSON.stringify(query)} {...{ workspace, firm, firms, query }}
      apply={(next, id) => open({ query: next }, id, true)} />
    {message}
    {result && !report && <p>Choose an account and apply the filters to open its ledger.</p>}
    {report && <>
      <OutputActions key={JSON.stringify(query) + ':' + firm.id} title={heading} csv={() => formatReportCSV([heading, who, when], report)} />
      <article className="print-document">
        <div className="report-heading">{moduleTitle(heading)}<p>{who} · {when}</p></div>
        {report.note && <p>{report.note}</p>}
        {report.tables.map((table, tableIndex) => {
          const page = pages?.[tableIndex] ?? 0;
          return <section key={table.title} className="report-section">
            {table.title !== heading && <h3>{table.title}</h3>}
            <Table heading={table.title} headings={table.columns}
              footer={table.totals?.map((row, index) => <tr key={index}>{cells(row, 'total-' + tableIndex + '-' + index)}</tr>)}>
              {table.rows.map((row, index) => <tr key={index}
                className={Math.floor(index / PAGE_SIZE) === page ? undefined : 'print-only'}>
                {cells(row, 'report-row-' + tableIndex + '-' + index)}</tr>)}
            </Table>
            {!table.rows.length && !table.totals && <p>No entries for these filters.</p>}
            <Pagination page={page} next={(page + 1) * PAGE_SIZE < table.rows.length}
              change={index => open({ query, pages: { ...pages, [tableIndex]: index } }, firm.id, true)} />
          </section>;
        })}
      </article>
    </>}
  </section>;
}
