import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PAGE_SIZE } from '../desktop/books';
import type { Cashbook, CashbookQuery, Chart, NamedAccount, PostVoucher } from '../desktop/books';
import type { Firm, WorkspaceKind } from '../desktop/workspace';
import { accountLabels, EntryActions, entryKeys, errorMessage, money, parseAmount, payeeName, today, useEntry } from './book-entry';
import type { EntryContext } from './book-entry';
import { Filters, Pagination, Table } from './books';

const actions = { handover: 'Record handover', payment: 'Record payment', return: 'Record return' } as const;
type Movement = keyof typeof actions;
type PayeeType = 'Expense' | 'Person' | 'Firm';
export type CashbookView =
  | { name: 'directory'; page?: number; notice?: string }
  | { name: 'new'; requestId: string; employeeId?: number }
  | { name: 'custodian'; accountId: number }
  | { name: 'ledger'; query: CashbookQuery }
  | { name: 'movement'; accountId: number; movement: Movement; requestId: string }
  | { name: 'remove'; accountId: number };
export const CASHBOOK_DIRECTORY: CashbookView = { name: 'directory' };

function title(name: string) {
  return <h2 id="cashbook-title" tabIndex={-1}>{name}</h2>;
}

function CashbookEntry({ workspace, firmId, shortcut, cancel, requestId, employeeId, cashbook, employees, done }: EntryContext & {
  requestId?: string; employeeId?: number; cashbook?: Cashbook; employees: NamedAccount[]; done: (cashbook: Cashbook) => void;
}) {
  const [selected, setSelected] = useState(cashbook?.employeeId ?? employeeId ?? 0);
  const first = useRef<HTMLInputElement>(null);
  const custodianField = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => { (first.current ?? custodianField.current)?.focus(); }, []);
  const { busy, error, save } = useEntry(data => {
    const custodian = String(data.get('custodian') ?? '');
    const assigned = { custodian, employeeId: selected || undefined };
    if (cashbook) return window.workspaces.saveCashbookCustodian(workspace, firmId, { accountId: cashbook.id, ...assigned });
    const amount = String(data.get('openingCash')).trim();
    const openingCash = /^0+(?:\.0{1,2})?$/.test(amount) ? 0 : parseAmount(amount);
    return window.workspaces.createCashbook(workspace, firmId, {
      requestId: requestId!, name: String(data.get('name')), ...assigned,
      openedOn: String(data.get('openedOn')), openingCash,
    });
  }, done);
  return <form id="cashbook-form" className="panel settings book-form" onSubmit={save}
    onKeyDown={event => entryKeys(event, cancel, busy)}>
    {title(cashbook ? 'Change custodian · ' + cashbook.name : 'New cashbook')}
    <fieldset disabled={busy}>
      {!cashbook && <>
        <label htmlFor="cashbook-name">Cashbook name</label>
        <input id="cashbook-name" ref={first} name="name" maxLength={180} required />
      </>}
      {(employees.length > 0 || cashbook) && <>
        <label htmlFor="cashbook-employee">Employee custodian</label>
        <select ref={custodianField} id="cashbook-employee" value={selected} onChange={event => setSelected(Number(event.target.value))}>
          <option value={0}>Enter a custodian name</option>
          {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </select>
      </>}
      {!selected && <>
        <label htmlFor="cashbook-custodian">Custodian</label>
        <input id="cashbook-custodian" name="custodian" maxLength={180} defaultValue={cashbook?.custodian} required />
      </>}
      {!cashbook && <>
        <label htmlFor="cashbook-opened">Opening date</label>
        <input id="cashbook-opened" name="openedOn" type="date" defaultValue={today()} required />
        <label htmlFor="cashbook-opening">Opening cash (₹)</label>
        <input id="cashbook-opening" name="openingCash" inputMode="decimal" defaultValue="0" maxLength={17} required />
      </>}
    </fieldset>
    <EntryActions label="Save cashbook" {...{ busy, error, shortcut, cancel }} />
  </form>;
}

function CashMovement({ workspace, firmId, shortcut, cancel, view, cashbook, chart, firms, done }: EntryContext & {
  view: Extract<CashbookView, { name: 'movement' }>; cashbook: Cashbook; chart: Chart; firms: Firm[];
  done: (id: number) => void;
}) {
  const { movement, requestId } = view;
  const payment = movement === 'payment';
  const incoming = movement === 'handover';
  const [payeeType, setPayeeType] = useState<PayeeType>('Expense');
  const first = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { first.current?.focus(); }, []);
  const offsets = chart.accounts.filter(account => !account.archived && account.id !== cashbook.id &&
    (!payment ? account.kind === 'cash' : payeeType === 'Expense' ? account.kind === 'expense'
      : account.kind !== 'contractor' && account.kind !== 'cash' && account.kind !== 'bank' && account.system !== 'capital'));
  const { busy, error, save } = useEntry(data => {
    const amount = parseAmount(data.get('amount'));
    const cashValue = incoming ? amount : -amount;
    const payee: Extract<PostVoucher, { lines: unknown }>['payee'] = !payment || payeeType === 'Expense' ? undefined
      : payeeType === 'Person' ? { kind: 'Person', name: String(data.get('person')) }
        : { kind: 'Firm', firmId: Number(data.get('payeeFirm')) };
    return window.workspaces.postVoucher(workspace, firmId, {
      requestId, day: String(data.get('day')), memo: String(data.get('memo')), kind: payment ? 'Payment' : 'Contra', payee,
      lines: [
        { accountId: cashbook.id, siteId: null, value: cashValue },
        { accountId: Number(data.get('offset')), siteId: null, value: -cashValue },
      ],
    });
  }, voucher => done(voucher.id));
  const offsetLabel = payment ? 'Debit account' : incoming ? 'Cash from' : 'Return to';
  return <form id="cashbook-form" className="panel settings book-form" onSubmit={save}
    onKeyDown={event => entryKeys(event, cancel, busy)}>
    {title(actions[movement] + ' · ' + cashbook.name)}
    <fieldset disabled={busy}>
      <label htmlFor="cash-date">Voucher date</label>
      <input id="cash-date" ref={first} name="day" type="date" required
        min={cashbook.openedOn} defaultValue={today() < cashbook.openedOn ? cashbook.openedOn : today()} />
      {payment && <>
        <label htmlFor="cash-payee-type">Payment type</label>
        <select id="cash-payee-type" value={payeeType} onChange={event => setPayeeType(event.target.value as PayeeType)}>
          <option value="Expense">Expense</option><option value="Person">Pay a person</option><option value="Firm">Pay a firm</option>
        </select>
        {payeeType === 'Person' && <>
          <label htmlFor="cash-person">Payee name</label>
          <input id="cash-person" name="person" maxLength={180} required />
        </>}
        {payeeType === 'Firm' && <>
          <label htmlFor="cash-payee-firm">Payee firm</label>
          <select id="cash-payee-firm" name="payeeFirm" defaultValue="" required>
            <option value="">Choose a firm</option>
            {firms.filter(firm => !firm.archived).map(firm => <option key={firm.id} value={firm.id}>
              {firm.name}{firm.owner && ' (owner: ' + firm.owner + ')'}
            </option>)}
          </select>
        </>}
      </>}
      <label htmlFor="cash-offset">{offsetLabel}</label>
      <select id="cash-offset" name="offset" key={payeeType} defaultValue="" required>
        <option value="">Choose an account</option>
        {offsets.map(account => <option key={account.id} value={account.id}>
          {payment ? account.name + ' · ' + accountLabels[account.kind] : account.name}
        </option>)}
      </select>
      {offsets.length === 0 && <p>{payment
        ? 'Create a debit account in the chart of accounts to post this payment.'
        : 'Create another cashbook or cash account in this firm to transfer cash.'}</p>}
      <label htmlFor="cash-amount">Amount (₹)</label>
      <input id="cash-amount" name="amount" inputMode="decimal" maxLength={17} required />
      <label htmlFor="cash-purpose">Purpose</label>
      <input id="cash-purpose" name="memo" maxLength={500} required />
    </fieldset>
    <EntryActions label="Post voucher" {...{ busy, error, shortcut, cancel }} />
  </form>;
}

function RemoveCashbook({ workspace, firmId, cancel, cashbook, done }: EntryContext & {
  cashbook: Cashbook; done: (archived: boolean) => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { keep.current?.focus(); }, []);
  const { busy, error, save } = useEntry(() => window.workspaces.removeCashbook(workspace, firmId, { accountId: cashbook.id }),
    ({ archived }) => done(archived));
  return <form className="panel settings removal" onSubmit={save} onKeyDown={event => entryKeys(event, cancel, busy)}>
    {title('Remove ' + cashbook.name + '?')}
    <p>Unused cashbooks are deleted. Cashbooks with vouchers are archived with their history.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="form-actions">
      <button type="button" ref={keep} className="secondary" disabled={busy} onClick={cancel}>Keep cashbook</button>
      <button type="submit" className="danger" disabled={busy}>Confirm removal</button>
    </div>
  </form>;
}

async function load(workspace: WorkspaceKind, firmId: number, view: CashbookView) {
  const bridge = window.workspaces;
  if (view.name === 'ledger') return { ...view, report: await bridge.getCashbookLedger(workspace, firmId, view.query) };
  if (view.name === 'new' || view.name === 'custodian') {
    const [employees, cashbook] = await Promise.all([
      bridge.getNamedAccounts(workspace, firmId, { kind: 'employee' }),
      view.name === 'custodian' ? bridge.getCashbooks(workspace, firmId).then(books => books.find(book => book.id === view.accountId))
        : undefined,
    ]);
    return { ...view, cashbook, employees: employees.filter(employee => !employee.archived || employee.id === cashbook?.employeeId) };
  }
  if (view.name === 'movement') {
    const [cashbooks, chart] = await Promise.all([bridge.getCashbooks(workspace, firmId), bridge.getChart(workspace, firmId)]);
    return { ...view, cashbook: cashbooks.find(book => book.id === view.accountId), chart };
  }
  const cashbooks = await bridge.getCashbooks(workspace, firmId);
  if (view.name === 'remove') return { ...view, cashbook: cashbooks.find(book => book.id === view.accountId) };
  return { ...view, cashbooks };
}

type LoadState = { view: CashbookView } & ({ result: Awaited<ReturnType<typeof load>> } | { error: string });

export function Cashbooks({ workspace, firm, firms, view, savedFocus, shortcut, open, back, showVoucher, payBill }: {
  workspace: WorkspaceKind; firm: Firm; firms: Firm[]; view: CashbookView; savedFocus?: string; shortcut: string;
  open: (view: CashbookView, replace?: boolean) => void; back: () => void; showVoucher: (id: number, posted?: boolean) => void; payBill: (cashbookId: number) => void;
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
  }, [workspace, firm.id, view, attempt]);

  useLayoutEffect(() => {
    const active = document.activeElement;
    if (snapshot && 'result' in snapshot &&
        (active === document.body || active?.id === 'page-title' || active?.id === savedFocus)) {
      (document.getElementById(savedFocus ?? 'cashbook-title') ?? document.getElementById('cashbook-title'))?.focus();
    }
  }, [snapshot, savedFocus]);

  const context = { workspace, firmId: firm.id, shortcut, cancel: back };
  const openLedger = (accountId: number, replace = false) => open({ name: 'ledger', query: { accountId } }, replace);
  function body() {
    if (!snapshot) return <p role="status">Loading cashbooks…</p>;
    if ('error' in snapshot) return <>
      <p className="error" role="alert">{snapshot.error}</p>
      <button className="secondary" onClick={() => { setState(undefined); setAttempt(value => value + 1); }}>Retry</button>
    </>;
    const screen = snapshot.result;
    switch (screen.name) {
      case 'new':
      case 'custodian':
        if (screen.name === 'custodian' && (!screen.cashbook || screen.cashbook.archived)) return <p>Choose an active cashbook.</p>;
        return firm.archived ? null :
          <CashbookEntry {...context} cashbook={screen.cashbook} employees={screen.employees}
            requestId={screen.name === 'new' ? screen.requestId : undefined}
            employeeId={screen.name === 'new' ? screen.employeeId : undefined} done={book => openLedger(book.id, true)} />;
      case 'directory': {
        const page = screen.page ?? 0;
        const rows = screen.cashbooks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        return <>
          <div className="book-heading">{title('Cashbook directory')}
            {!firm.archived && <button className="action" id="new-cashbook"
              onClick={() => open({ name: 'new', requestId: crypto.randomUUID() })}>New cashbook</button>}
          </div>
          {screen.notice && <p role="status">{screen.notice}</p>}
          {rows.length === 0 ? <p>No cashbooks in this firm.</p> :
            <Table heading="Cashbook directory" headings={['Cashbook', 'Custodian', 'Opening date', 'Opening cash']}>
              {rows.map(book => <tr key={book.id}>
                <th scope="row"><button className="book-link" id={'open-cashbook-' + book.id}
                  onClick={() => openLedger(book.id)}>{book.name}</button>{book.archived === 1 && ' (archived)'}</th>
                <td>{book.custodian}</td><td>{book.openedOn}</td><td className="book-amount">{money(book.openingCash)}</td>
              </tr>)}
            </Table>}
          <Pagination page={page} next={(page + 1) * PAGE_SIZE < screen.cashbooks.length}
            change={page => open({ name: 'directory', page }, true)} />
        </>;
      }
      case 'ledger': {
        const { cashbook, closing, totalCash, rows, hasNext } = screen.report;
        const { accountId, to, page = 0 } = screen.query;
        const archived = firm.archived || cashbook.archived === 1;
        return <>
          <div className="book-heading">{title(cashbook.name)}
            {!archived && <div className="book-heading">
              <button className="secondary" id="edit-custodian" onClick={() => open({ name: 'custodian', accountId })}>
                Change custodian</button>
              <button className="secondary" id="remove-cashbook" onClick={() => open({ name: 'remove', accountId })}>
                Remove cashbook</button>
            </div>}
          </div>
          {cashbook.archived === 1 && <p>Archived cashbook</p>}
          <dl className="balances">
            <div><dt>Custodian</dt><dd>{cashbook.custodian}</dd></div>
            <div><dt>Opening date</dt><dd>{cashbook.openedOn}</dd></div>
            <div><dt>Opening cash</dt><dd>{money(cashbook.openingCash)}</dd></div>
          </dl>
          {!archived && <div className="book-tabs" role="group" aria-label="Cashbook transactions">
            {(Object.keys(actions) as Movement[]).map(movement => <button key={movement} className="action" id={'cash-action-' + movement}
              onClick={() => open({ name: 'movement', accountId, movement, requestId: crypto.randomUUID() })}>
              {actions[movement]}
            </button>)}
            <button id="cash-action-bill" className="secondary" onClick={() => payBill(accountId)}>Pay supplier bill</button>
          </div>}
          <Filters period={{ to }} asOf apply={({ to }) => open({ name: 'ledger', query: { accountId, to } }, true)} />
          <dl className="balances book-balances">
            <div><dt>Balance held</dt><dd>{money(closing)}</dd></div>
            <div><dt>Total firm cash</dt><dd>{money(totalCash)}</dd></div>
          </dl>
          {rows.length === 0 ? <p>No transactions for this date range.</p> :
            <Table heading="Cashbook history" headings={['Voucher', 'Date', 'Counterparty', 'Purpose', 'Cash in', 'Cash out', 'Balance']}>
              {rows.map(row => <tr key={row.lineId}>
                <th scope="row"><button className="book-link" id={'cashbook-line-' + row.lineId}
                  onClick={() => showVoucher(row.voucherId)}>#{row.voucherId}</button>
                  <small className="voucher-narration">{row.kind}</small></th>
                <td>{row.day}</td><td>{row.payee ? payeeName(row.payee) : row.offsets || '—'}</td><td>{row.memo || '—'}</td>
                <td className="book-amount">{row.value > 0 ? money(row.value) : '—'}</td>
                <td className="book-amount">{row.value < 0 ? money(-row.value) : '—'}</td>
                <td className="book-amount">{money(row.running)}</td>
              </tr>)}
            </Table>}
          <Pagination page={page} next={hasNext} change={page => open({ name: 'ledger', query: { accountId, to, page } }, true)} />
        </>;
      }
      case 'movement':
      case 'remove': {
        const { cashbook } = screen;
        if (!cashbook || firm.archived || cashbook.archived) return <p>This cashbook is unavailable for new entries.</p>;
        return screen.name === 'movement' ?
          <CashMovement {...context} view={screen} cashbook={cashbook} chart={screen.chart} firms={firms}
            done={id => showVoucher(id, true)} /> :
          <RemoveCashbook {...context} cashbook={cashbook} done={archived => open({
            name: 'directory', notice: archived ? 'Cashbook archived.' : 'Cashbook deleted.',
          }, true)} />;
      }
    }
  }
  return <section className="books" aria-label={firm.name + ' cashbooks'}>
    <p className="intro">Funding firm {firm.name}{firm.archived && ' · Archived books'}</p>
    {body()}
  </section>;
}
