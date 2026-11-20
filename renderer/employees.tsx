import { useLayoutEffect, useRef, useState } from 'react';
import { EMPLOYEE_ACTIONS } from '../desktop/books';
import type { Chart, DayBookQuery, EmployeeAction, NamedAccount } from '../desktop/books';
import type { Firm, WorkspaceKind } from '../desktop/workspace';
import { EntryActions, entryKeys, money, parseAmount, today, useEntry } from './book-entry';
import type { EntryContext } from './book-entry';
import { Filters, Table } from './books';
import { moduleTitle, MovementTable, NamedAccountForm, NamedDirectory, RemoveNamedAccount, useModuleReport } from './named-books';
import type { NamedView, ShowVoucher } from './named-books';

export type EmployeeView = NamedView
  | ({ name: 'ledger'; accountId: number; advancePage?: number } & DayBookQuery)
  | { name: 'cash'; accountId: number }
  | { name: 'movement'; accountId: number; requestId: string };

async function load(workspace: WorkspaceKind, firmId: number, view: EmployeeView) {
  const bridge = window.workspaces;
  const accounts = bridge.getNamedAccounts(workspace, firmId, { kind: 'employee' });
  if (view.name === 'cash') {
    const [employees, books] = await Promise.all([accounts, bridge.getCashbooks(workspace, firmId)]);
    const cash = await Promise.all(books.filter(book => book.employeeId === view.accountId).map(async book => ({
      book, held: (await bridge.getCashbookLedger(workspace, firmId, { accountId: book.id })).closing,
    })));
    return { accounts: employees, cash };
  }
  if (view.name === 'ledger') {
    const [employees, ledger] = await Promise.all([accounts, bridge.getEmployeeLedger(workspace, firmId, view)]);
    return { accounts: employees, ledger };
  }
  if (view.name === 'movement') {
    const [employees, chart] = await Promise.all([accounts, bridge.getChart(workspace, firmId)]);
    return { accounts: employees, chart };
  }
  return { accounts: await accounts };
}

function EmployeeMovement({ workspace, firmId, shortcut, cancel, employee, chart, requestId, done }: EntryContext & {
  employee: NamedAccount; chart: Chart; requestId: string; done: ShowVoucher;
}) {
  const [action, setAction] = useState<EmployeeAction>('Salary earned');
  const first = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => { first.current?.focus(); }, []);
  const funding = ['Salary payment', 'Salary advance', 'Advance repayment', 'Reimbursement'].includes(action);
  const adjustment = action === 'Manual adjustment';
  const offsets = chart.accounts.filter(account => !account.archived && (adjustment
    ? account.id !== employee.id && !['cash', 'bank', 'contractor'].includes(account.kind)
    : account.kind === 'expense' && account.system !== 'salary'));
  const { busy, error, save } = useEntry(data => window.workspaces.postEmployee(workspace, firmId, {
    requestId, action, accountId: employee.id, day: String(data.get('day')), memo: String(data.get('memo')),
    amount: parseAmount(data.get('amount')), fundingId: Number(data.get('funding')) || undefined,
    offsetId: Number(data.get('offset')) || undefined, reducePayable: data.get('adjustment') === 'reduce',
  }), voucher => done(voucher.id, true));
  return <form id="module-form" className="panel settings book-form" onSubmit={save}
    onKeyDown={event => entryKeys(event, cancel, busy)}>
    {moduleTitle('New employee entry · ' + employee.name)}
    <fieldset disabled={busy}>
      <label htmlFor="employee-action">Transaction type</label>
      <select ref={first} id="employee-action" value={action} onChange={event => setAction(event.target.value as EmployeeAction)}>
        {EMPLOYEE_ACTIONS.map(kind => <option key={kind}>{kind}</option>)}
      </select>
      <label htmlFor="employee-date">Voucher date</label>
      <input id="employee-date" name="day" type="date" defaultValue={today()} required />
      {funding && <>
        <label htmlFor="employee-funding">{action === 'Advance repayment' ? 'Received into' : 'Paid from'}</label>
        <select id="employee-funding" name="funding" defaultValue="" key={action} required>
          <option value="">Choose a bank or cash account</option>
          {chart.accounts.filter(account => !account.archived && (account.kind === 'bank' || account.kind === 'cash'))
            .map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
      </>}
      {adjustment && <>
        <label htmlFor="employee-adjustment">Effect on payable</label>
        <select id="employee-adjustment" name="adjustment">
          <option value="increase">Increase payable</option><option value="reduce">Reduce payable</option>
        </select>
      </>}
      {(adjustment || action === 'Reimbursement') && <>
        <label htmlFor="employee-offset">{adjustment ? 'Offset account' : 'Expense account'}</label>
        <select id="employee-offset" name="offset" defaultValue="" key={action} required>
          <option value="">Choose an account</option>
          {offsets.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
      </>}
      <label htmlFor="employee-amount">Amount (₹)</label>
      <input id="employee-amount" name="amount" inputMode="decimal" maxLength={17} required />
      <label htmlFor="employee-memo">Narration</label>
      <input id="employee-memo" name="memo" maxLength={500} />
    </fieldset>
    <EntryActions label="Post voucher" {...{ busy, error, shortcut, cancel }} />
  </form>;
}

export function Employees({ workspace, firm, view, savedFocus, shortcut, open, back, showVoucher, openCashbook }: {
  workspace: WorkspaceKind; firm: Firm; view: EmployeeView; savedFocus?: string; shortcut: string;
  open: (view: EmployeeView, replace?: boolean) => void; back: () => void; showVoucher: ShowVoucher;
  openCashbook: (id: number | null, employeeId: number) => void;
}) {
  const { result, message } = useModuleReport(workspace, firm.id, view, savedFocus, load);
  const context = { workspace, firmId: firm.id, shortcut, cancel: back };
  function body() {
    if (!result) return message;
    const ledger = (accountId: number, replace = false) => open({ name: 'ledger', accountId }, replace);
    if (view.name === 'directory') return <NamedDirectory kind="employee" accounts={result.accounts} {...{ firm, view, open }}
      select={ledger} />;
    const account = 'accountId' in view ? result.accounts.find(employee => employee.id === view.accountId) : undefined;
    const active = !firm.archived && !account?.archived;
    if (view.name === 'record' && active && (view.accountId === undefined || account)) {
      return <NamedAccountForm {...context} kind="employee" account={account}
        done={saved => ledger(saved.id, true)} />;
    }
    if (!account) return <p>Choose an employee in this firm.</p>;
    const accountId = account.id;
    if (view.name === 'remove' && active) return <RemoveNamedAccount {...context} kind="employee" account={account}
      done={archived => open({ name: 'directory', notice: archived ? 'Employee archived.' : 'Employee deleted.' }, true)} />;
    if (view.name === 'movement' && active && result.chart) return <EmployeeMovement {...context} employee={account}
      chart={result.chart} requestId={view.requestId} done={showVoucher} />;
    if (view.name !== 'ledger' && view.name !== 'cash') return <p>This employee is unavailable for new entries.</p>;
    const tabs = <div className="book-tabs" role="group" aria-label="Employee views">
      <button id="employee-personal" className="secondary" aria-pressed={view.name === 'ledger'}
        onClick={() => { if (view.name !== 'ledger') ledger(accountId); }}>Personal transactions</button>
      <button id="employee-cash" className="secondary" aria-pressed={view.name === 'cash'}
        onClick={() => { if (view.name !== 'cash') open({ name: 'cash', accountId }); }}>Company cash held</button>
    </div>;
    const heading = <>{moduleTitle(account.name)}
      {account.role && <p>{account.role}</p>}
      {!!account.archived && <p>Archived employee</p>}
      {tabs}</>;
    if (view.name === 'cash') {
      const cash = result.cash ?? [];
      return <>{heading}
        {active && <button className="action" id="new-employee-cashbook"
          onClick={() => openCashbook(null, accountId)}>New employee cashbook</button>}
        <dl className="balances book-balances"><div><dt>Company cash held</dt>
          <dd>{money(cash.reduce((total, row) => total + row.held, 0n))}</dd></div></dl>
        {cash.length === 0 ? <p>No cashbooks assigned to this employee.</p> :
          <Table heading="Company cash held" headings={['Cashbook', 'Balance held']}>
            {cash.map(({ book, held }) => <tr key={book.id}>
              <th scope="row"><button id={'employee-cashbook-' + book.id} className="book-link"
                onClick={() => openCashbook(book.id, accountId)}>{book.name}</button>{!!book.archived && ' (archived)'}</th>
              <td className="book-amount">{money(held)}</td>
            </tr>)}
          </Table>}
      </>;
    }
    if (!result.ledger) return null;
    const { personal, advances } = result.ledger;
    const { page = 0, advancePage = 0 } = view;
    return <>{heading}
      {active && <div className="book-tabs">
        <button className="action" id="new-employee-movement" onClick={() => open({
          name: 'movement', accountId, requestId: crypto.randomUUID(),
        })}>New employee entry</button>
        <button className="secondary" id="edit-employee" onClick={() => open({ name: 'record', accountId })}>Edit employee</button>
        <button className="secondary" id="remove-employee" onClick={() => open({ name: 'remove', accountId })}>Remove employee</button>
      </div>}
      <Filters period={view} apply={period => open({ name: 'ledger', accountId, ...period }, true)} />
      <dl className="balances book-balances">
        <div><dt>Salary payable</dt><dd>{money(-personal.closing)}</dd></div>
        <div><dt>Salary advance outstanding</dt><dd>{money(advances?.closing ?? 0)}</dd></div>
      </dl>
      <h3>Salary and reimbursements</h3>
      <MovementTable name="Salary and reimbursements" ledger={personal} reimbursements {...{ showVoucher, page }}
        change={page => open({ ...view, page }, true)} />
      <h3>Salary advance ledger</h3>
      {advances ? <MovementTable name="Salary advance ledger" ledger={advances} {...{ showVoucher }} page={advancePage}
        change={advancePage => open({ ...view, advancePage }, true)} /> : <p>No salary advances.</p>}
    </>;
  }
  return <section className="books" aria-label={firm.name + ' employees'}>{body()}</section>;
}
