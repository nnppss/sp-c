import { useEffect, useLayoutEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Chart, DayBookQuery, LedgerQuery, Period, VoucherDetail } from '../desktop/books';
import type { Firm, WorkspaceKind } from '../desktop/workspace';
import { AccountEntry, accountLabels, errorMessage, money, payeeName, ReversalEntry, VoucherEntry } from './book-entry';

export type BookView =
  | { name: 'chart'; saved?: boolean }
  | { name: 'account' }
  | { name: 'new'; requestId: string }
  | { name: 'day'; query: DayBookQuery }
  | { name: 'trial'; query: { to?: string } }
  | { name: 'ledger'; query: LedgerQuery }
  | { name: 'voucher'; voucherId: number; saved?: boolean }
  | { name: 'reverse'; voucherId: number; requestId: string };

export const DAY_BOOK: BookView = { name: 'day', query: {} };
export const TRIAL_BALANCE: BookView = { name: 'trial', query: {} };

async function load(workspace: WorkspaceKind, firmId: number, view: BookView) {
  const bridge = window.workspaces;
  const chart = bridge.getChart(workspace, firmId);
  switch (view.name) {
    case 'day': return { ...view, ...await loadReport(bridge.getDayBook(workspace, firmId, view.query)) };
    case 'trial': return { ...view, ...await loadReport(bridge.getTrialBalance(workspace, firmId, view.query)) };
    case 'ledger': return { ...view, ...await loadReport(bridge.getLedger(workspace, firmId, view.query)) };
    case 'voucher':
    case 'reverse': return { ...view, ...await loadReport(bridge.getVoucher(workspace, firmId, { voucherId: view.voucherId })) };
    default: return { ...view, chart: await chart };
  }

  async function loadReport<T>(report: Promise<T>) {
    const [accounts, result] = await Promise.all([chart, report]);
    return { chart: accounts, report: result };
  }
}

export function Table({ heading, headings, children, footer }: {
  heading: string; headings: string[]; children: ReactNode; footer?: ReactNode;
}) {
  return <div className="panel book-table" role="region" aria-label={heading}>
    <table aria-label={heading}>
      <thead><tr>{headings.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{children}</tbody>
      {footer && <tfoot>{footer}</tfoot>}
    </table>
  </div>;
}

export function Filters({ period, asOf, sites, siteId, apply }: {
  period: Period; asOf?: boolean; sites?: Chart['sites']; siteId?: number;
  apply: (period: Period, siteId?: number) => void;
}) {
  const [error, setError] = useState('');
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const from = String(fields.get('from') ?? '') || undefined;
    const to = String(fields.get('to') ?? '') || undefined;
    if (from && to && from > to) {
      setError('The end date must be on or after the start date.');
      return;
    }
    apply({ from, to }, Number(fields.get('site')) || undefined);
  }

  return <form className="book-filters" onSubmit={filter}>
    {!asOf && <div><label htmlFor="book-from">From</label>
      <input id="book-from" type="date" name="from" min="0001-01-01" max="9999-12-31" defaultValue={period.from} /></div>}
    <div><label htmlFor="book-to">{asOf ? 'As of' : 'Through'}</label>
      <input id="book-to" type="date" name="to" min="0001-01-01" max="9999-12-31" defaultValue={period.to} /></div>
    {sites && sites.length > 0 && <div><label htmlFor="book-site">Site</label>
      <select id="book-site" name="site" defaultValue={siteId ?? ''}>
        <option value="">All sites</option>
        {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
      </select></div>}
    <button className="secondary" type="submit">Apply filters</button>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

export function Pagination({ page, next, change }: { page: number; next: boolean; change: (page: number) => void }) {
  if (!page && !next) return null;
  return <div className="book-pagination" role="group" aria-label="Report pages">
    <button type="button" className="secondary" disabled={page === 0} onClick={() => change(page - 1)}>Previous page</button>
    <span>Page {page + 1}</span>
    <button type="button" className="secondary" disabled={!next} onClick={() => change(page + 1)}>Next page</button>
  </div>;
}

type LoadState = { view: BookView } & ({ result: Awaited<ReturnType<typeof load>> } | { error: string });

export function Books({ workspace, firm, view, savedFocus, shortcut, open, replace, back, showInvoice }: {
  workspace: WorkspaceKind; firm: Firm; view: BookView; savedFocus?: string; shortcut: string;
  open: (view: BookView) => void; replace: (view: BookView) => void; back: () => void; showInvoice: (voucherId: number) => void;
}) {
  const [state, setState] = useState<LoadState>();
  const [attempt, setAttempt] = useState(0);
  const snapshot = state?.view === view ? state : undefined;

  useEffect(() => {
    let current = true;
    load(workspace, firm.id, view).then(result => {
      if (current) setState({ view, result });
    }, error => {
      if (current) setState({ view, error: errorMessage(error) });
    });
    return () => { current = false; };
  }, [view, workspace, firm.id, attempt]);

  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active !== document.body && active?.id !== 'page-title' && active?.id !== savedFocus) return;
    if (snapshot && 'result' in snapshot) {
      (document.getElementById(savedFocus ?? 'book-title') ?? document.getElementById('book-title'))?.focus();
    }
  }, [snapshot, savedFocus]);

  const chartView = view.name === 'chart' || view.name === 'account';
  const showVoucher = (voucherId: number) => open({ name: 'voucher', voucherId });
  const posted = (voucher: VoucherDetail) => replace({ name: 'voucher', voucherId: voucher.id, saved: true });
  const entry = { firmId: firm.id, workspace, shortcut, cancel: back };
  const renderHeading = (title: string) => <h2 id="book-title" tabIndex={-1}>{title}</h2>;

  function body() {
    if (!snapshot) return <p role="status">Loading books…</p>;
    if ('error' in snapshot) return <div>
      <p className="error" role="alert">{snapshot.error}</p>
      <button className="secondary" onClick={() => { setState(undefined); setAttempt(value => value + 1); }}>Retry</button>
    </div>;
    const screen = snapshot.result;
    const { chart } = screen;
    const accountName = (id: number) => chart.accounts.find(account => account.id === id)?.name ?? '#' + id;
    const siteName = (id: number | null) => chart.sites.find(site => site.id === id)?.name ?? '—';
    const ledger = (accountId: number, to?: string) => open({ name: 'ledger', query: { accountId, to } });

    switch (screen.name) {
      case 'account':
        return <AccountEntry {...entry} done={() => replace({ name: 'chart', saved: true })} />;
      case 'new':
        return <VoucherEntry {...entry} requestId={screen.requestId} chart={chart} done={posted} />;
      case 'reverse':
        return <ReversalEntry {...entry} requestId={screen.requestId} original={screen.report} done={posted} />;
      case 'chart':
        return <>
          <div className="book-heading">{renderHeading('Chart of accounts')}
            {!firm.archived && <button className="action" id="new-account" onClick={() => open({ name: 'account' })}>New account</button>}
          </div>
          {screen.saved && <p role="status">Account saved.</p>}
          {chart.accounts.length === 0 ? <p>No accounts in this firm.</p> :
            <Table heading="Chart of accounts" headings={['Account', 'Type']}>
              {chart.accounts.map(account => <tr key={account.id}>
                <th scope="row"><button className="book-link" id={'chart-account-' + account.id}
                  onClick={() => ledger(account.id)}>{account.name}</button>{account.archived === 1 && ' (archived)'}</th>
                <td>{accountLabels[account.kind]}</td>
              </tr>)}
            </Table>}
        </>;
      case 'day': {
        const { rows, hasNext } = screen.report;
        const page = screen.query.page ?? 0;
        return <>
          <div className="book-heading">{renderHeading('Day book')}
            {!firm.archived && <button className="action" id="new-voucher" disabled={chart.accounts.length === 0}
              onClick={() => open({ name: 'new', requestId: crypto.randomUUID() })}>New voucher</button>}
          </div>
          <Filters period={screen.query} apply={period => replace({ name: 'day', query: period })} />
          {rows.length === 0 ? <p>No vouchers for this period.</p> :
            <Table heading="Day book" headings={['Voucher', 'Date', 'Type', 'Narration', 'Amount']}>
              {rows.map(row => <tr key={row.id}>
                <th scope="row"><button className="book-link" id={'day-voucher-' + row.id}
                  onClick={() => showVoucher(row.id)}>#{row.id}</button></th>
                <td>{row.day}</td><td>{row.kind}{row.reversedById !== null && ' (reversed)'}</td>
                <td>{row.memo || '—'}</td><td className="book-amount">{money(row.amount)}</td>
              </tr>)}
            </Table>}
          <Pagination page={page} next={hasNext} change={page => replace({ name: 'day', query: { ...screen.query, page } })} />
        </>;
      }
      case 'trial': {
        const { rows, debit, credit } = screen.report;
        return <>
          {renderHeading('Trial balance')}
          <Filters period={screen.query} asOf apply={({ to }) => replace({ name: 'trial', query: { to } })} />
          <Table heading="Trial balance" headings={['Account', 'Debit balance', 'Credit balance']}
            footer={<tr><th scope="row">Total</th><td className="book-amount">{money(debit)}</td><td className="book-amount">{money(credit)}</td></tr>}>
            {rows.map(row => <tr key={row.id}>
              <th scope="row"><button className="book-link" id={'trial-account-' + row.id}
                onClick={() => ledger(row.id, screen.query.to)}>{row.name}</button>{row.archived === 1 && ' (archived)'}</th>
              <td className="book-amount">{row.balance > 0n ? money(row.balance) : '—'}</td>
              <td className="book-amount">{row.balance < 0n ? money(-row.balance) : '—'}</td>
            </tr>)}
          </Table>
        </>;
      }
      case 'ledger': {
        const { rows, opening, closing, hasNext } = screen.report;
        const { accountId, page = 0 } = screen.query;
        return <>
          {renderHeading(accountName(accountId) + ' ledger')}
          <Filters period={screen.query} sites={chart.sites} siteId={screen.query.siteId}
            apply={(period, siteId) => replace({ name: 'ledger', query: { accountId, siteId, ...period } })} />
          <dl className="balances book-balances">
            <div><dt>Opening balance</dt><dd>{money(opening)}</dd></div>
            <div><dt>Closing balance</dt><dd>{money(closing)}</dd></div>
          </dl>
          {rows.length === 0 ? <p>No posting lines for this period and site.</p> :
            <Table heading="Account ledger" headings={['Voucher', 'Date', 'Narration', 'Site', 'Debit', 'Credit', 'Balance']}>
              {rows.map(row => <tr key={row.lineId}>
                <th scope="row"><button className="book-link" id={'ledger-line-' + row.lineId}
                  onClick={() => showVoucher(row.voucherId)}>#{row.voucherId}</button></th>
                <td>{row.day}</td><td>{row.memo || row.kind}</td><td>{siteName(row.siteId)}</td>
                <td className="book-amount">{row.value > 0 ? money(row.value) : '—'}</td>
                <td className="book-amount">{row.value < 0 ? money(-row.value) : '—'}</td>
                <td className="book-amount">{money(row.running)}</td>
              </tr>)}
            </Table>}
          <Pagination page={page} next={hasNext} change={page => replace({ name: 'ledger', query: { ...screen.query, page } })} />
        </>;
      }
      case 'voucher': {
        const voucher = screen.report;
        return <>
          <div className="book-heading">{renderHeading(voucher.kind + ' #' + voucher.id)}
            {!firm.archived && voucher.reversesId === null && voucher.reversedById === null &&
              <button className="secondary" id="reverse-voucher" onClick={() => open({
                name: 'reverse', voucherId: voucher.id, requestId: crypto.randomUUID(),
              })}>Reverse voucher</button>}
          </div>
          {screen.saved && <p role="status">{voucher.reversesId === null ? 'Voucher posted.' : 'Reversal posted.'}</p>}
          <p>{voucher.day}{voucher.memo && ' · ' + voucher.memo}</p>
          {voucher.invoiceId !== undefined && <p><button id="voucher-invoice" className="book-link"
            onClick={() => showInvoice(voucher.invoiceId!)}>Open linked invoice</button></p>}
          {voucher.payee && <p>Payee {payeeName(voucher.payee)}</p>}
          {voucher.employee && <p>Employee <button className="book-link" id="voucher-employee"
            onClick={() => ledger(voucher.employee!.id)}>{voucher.employee.name}</button></p>}
          {voucher.reversesId !== null && <p>Reverses <button className="book-link" id="original-voucher"
            onClick={() => showVoucher(voucher.reversesId!)}>voucher #{voucher.reversesId}</button></p>}
          {voucher.reversedById !== null && <p>Reversed by <button className="book-link" id="linked-reversal"
            onClick={() => showVoucher(voucher.reversedById!)}>voucher #{voucher.reversedById}</button></p>}
          <Table heading="Posting lines" headings={['Account', 'Site', 'Debit', 'Credit']}
            footer={<tr><th scope="row" colSpan={2}>Total</th><td className="book-amount">{money(voucher.amount)}</td>
              <td className="book-amount">{money(voucher.amount)}</td></tr>}>
            {voucher.lines.map((line, index) => <tr key={index}>
              <th scope="row"><button className="book-link" id={'voucher-line-' + index}
                onClick={() => ledger(line.accountId)}>{accountName(line.accountId)}</button></th>
              <td>{siteName(line.siteId)}</td>
              <td className="book-amount">{line.value > 0 ? money(line.value) : '—'}</td>
              <td className="book-amount">{line.value < 0 ? money(-line.value) : '—'}</td>
            </tr>)}
          </Table>
        </>;
      }
    }
  }

  return <section className="books" aria-label={firm.name + ' books'}>
    {firm.archived && <p className="intro">{firm.name} · Archived books</p>}
    <div className="book-tabs" role="group" aria-label="Accounting views">
      <button id="book-day-tab" className="secondary" aria-pressed={view.name === 'day'} onClick={() => { if (view.name !== 'day') open(DAY_BOOK); }}>Day book</button>
      <button id="book-chart-tab" className="secondary" aria-pressed={chartView} onClick={() => { if (view.name !== 'chart') open({ name: 'chart' }); }}>Chart of accounts</button>
      <button id="book-trial-tab" className="secondary" aria-pressed={view.name === 'trial'} onClick={() => { if (view.name !== 'trial') open(TRIAL_BALANCE); }}>Trial balance</button>
    </div>
    {body()}
  </section>;
}
