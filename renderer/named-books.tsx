import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PAGE_SIZE } from '../desktop/books';
import type { Ledger, NamedAccount, NamedKind, Site } from '../desktop/books';
import type { Firm, WorkspaceKind } from '../desktop/workspace';
import { EntryActions, entryKeys, errorMessage, money, useEntry } from './book-entry';
import type { EntryContext } from './book-entry';
import { Pagination, Table } from './books';

export type NamedView =
  | { name: 'directory'; page?: number; notice?: string }
  | { name: 'record'; accountId?: number }
  | { name: 'remove'; accountId: number };
export const NAMED_DIRECTORY: NamedView = { name: 'directory' };
export type ShowVoucher = (id: number, posted?: boolean) => void;

export function moduleTitle(label: string) {
  return <h2 id="module-title" tabIndex={-1}>{label}</h2>;
}

export function useModuleReport<View, Report>(workspace: WorkspaceKind, firmId: number, view: View,
  savedFocus: string | undefined, load: (workspace: WorkspaceKind, firmId: number, view: View) => Promise<Report>) {
  const [state, setState] = useState<{ view: View } & ({ report: Report } | { error: string })>();
  const [attempt, setAttempt] = useState(0);
  const snapshot = state?.view === view ? state : undefined;
  useEffect(() => {
    let active = true;
    load(workspace, firmId, view).then(report => {
      if (active) setState({ view, report });
    }, error => {
      if (active) setState({ view, error: errorMessage(error) });
    });
    return () => { active = false; };
  }, [workspace, firmId, view, load, attempt]);

  useLayoutEffect(() => {
    const active = document.activeElement;
    if (snapshot && (active === document.body || active?.id === 'page-title')) {
      (document.getElementById(savedFocus ?? '') ?? document.getElementById('module-title'))?.focus();
    }
  }, [snapshot, savedFocus]);

  const message = !snapshot ? <p role="status">Loading…</p> : 'error' in snapshot ? <>
    <p className="error" role="alert">{snapshot.error}</p>
    <button className="secondary" onClick={() => { setState(undefined); setAttempt(value => value + 1); }}>Retry</button>
  </> : null;
  return { result: snapshot && 'report' in snapshot ? snapshot.report : undefined, message };
}

export function NamedDirectory({ kind, accounts, firm, view, open, select }: {
  kind: NamedKind; accounts: NamedAccount[]; firm: Firm; view: Extract<NamedView, { name: 'directory' }>;
  open: (view: NamedView, replace?: boolean) => void; select: (id: number) => void;
}) {
  const bank = kind === 'bank';
  const heading = bank ? 'Bank accounts' : 'Employee directory';
  const page = view.page ?? 0;
  const rows = accounts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return <>
    <div className="book-heading">{moduleTitle(heading)}
      {!firm.archived && <button id="new-named-account" className="action" onClick={() => open({ name: 'record' })}>
        {bank ? 'New bank account' : 'New employee'}
      </button>}
    </div>
    {view.notice && <p role="status">{view.notice}</p>}
    {rows.length === 0 ? <p>{bank ? 'No bank accounts in this firm.' : 'No employees in this firm.'}</p> :
      <Table heading={heading} headings={bank ? ['Bank account', 'Account number', 'Account type'] : ['Employee', 'Role']}>
        {rows.map(account => <tr key={account.id}>
          <th scope="row"><button id={'named-account-' + account.id} className="book-link" onClick={() => select(account.id)}>
            {account.name}</button>{account.archived === 1 && ' (archived)'}</th>
          {bank && <td>{account.number || '—'}</td>}
          <td>{account.role || '—'}</td>
        </tr>)}
      </Table>}
    <Pagination page={page} next={(page + 1) * PAGE_SIZE < accounts.length}
      change={page => open({ name: 'directory', page }, true)} />
  </>;
}

export function NamedAccountForm({ workspace, firmId, shortcut, cancel, kind, account, done }: EntryContext & {
  kind: NamedKind; account?: NamedAccount; done: (account: NamedAccount) => void;
}) {
  const bank = kind === 'bank';
  const name = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { name.current?.focus(); }, []);
  const { busy, error, save } = useEntry(data => window.workspaces.saveNamedAccount(workspace, firmId, {
    kind, id: account?.id ?? null, name: String(data.get('name')), role: String(data.get('role')),
    number: String(data.get('number') ?? ''),
  }), done);
  return <form id="module-form" className="panel settings book-form" onSubmit={save}
    onKeyDown={event => entryKeys(event, cancel, busy)}>
    {moduleTitle(account ? 'Edit ' + account.name : bank ? 'New bank account' : 'New employee')}
    <fieldset disabled={busy}>
      <label htmlFor="named-name">{bank ? 'Bank account name' : 'Employee name'}</label>
      <input ref={name} id="named-name" name="name" defaultValue={account?.name} required maxLength={180} />
      {bank && <>
        <label htmlFor="named-number">Account number</label>
        <input id="named-number" name="number" defaultValue={account?.number} maxLength={80} />
      </>}
      <label htmlFor="named-role">{bank ? 'Account type' : 'Role'}</label>
      <input id="named-role" name="role" defaultValue={account?.role} maxLength={180} />
    </fieldset>
    <EntryActions label={bank ? 'Save bank account' : 'Save employee'} {...{ busy, error, shortcut, cancel }} />
  </form>;
}

export function RemoveNamedAccount({ workspace, firmId, cancel, account, kind, done }: EntryContext & {
  account: NamedAccount; kind: NamedKind; done: (archived: boolean) => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { keep.current?.focus(); }, []);
  const { busy, error, save } = useEntry(() => window.workspaces.removeNamedAccount(workspace, firmId, { kind, accountId: account.id }),
    ({ archived }) => done(archived));
  return <form className="panel settings removal" onSubmit={save} onKeyDown={event => entryKeys(event, cancel, busy)}>
    {moduleTitle('Remove ' + account.name + '?')}
    <p>Unused records are deleted. Records with history or references are archived.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="form-actions">
      <button type="button" ref={keep} className="secondary" disabled={busy} onClick={cancel}>Keep record</button>
      <button type="submit" className="danger" disabled={busy}>Confirm removal</button>
    </div>
  </form>;
}

export function MovementTable({ name, ledger, showVoucher, sites, reimbursements, page, change }: {
  name: string; ledger: Omit<Ledger, 'rows'> & { rows: (Ledger['rows'][number] & { reimbursement?: number })[] };
  showVoucher: ShowVoucher; sites?: Site[]; reimbursements?: boolean; page: number; change: (page: number) => void;
}) {
  return <>
    {ledger.rows.length === 0 ? <p>No transactions for this period.</p> :
      <Table heading={name} headings={['Voucher', 'Date', 'Type', 'Narration', ...(sites ? ['Site'] : []),
        'Debit', 'Credit', ...(reimbursements ? ['Reimbursed'] : []), 'Balance']}>
        {ledger.rows.map(row => <tr key={row.lineId}>
          <th scope="row"><button className="book-link" id={'movement-line-' + row.lineId}
            onClick={() => showVoucher(row.voucherId)}>#{row.voucherId}</button></th>
          <td>{row.day}</td><td>{row.kind}</td><td>{row.memo || '—'}</td>
          {sites && <td>{sites.find(site => site.id === row.siteId)?.name ?? '—'}</td>}
          <td className="book-amount">{row.value > 0 ? money(row.value) : '—'}</td>
          <td className="book-amount">{row.value < 0 ? money(-row.value) : '—'}</td>
          {reimbursements && <td className="book-amount">{row.reimbursement === undefined ? '—' : money(row.reimbursement)}</td>}
          <td className="book-amount">{money(row.running)}</td>
        </tr>)}
      </Table>}
    <Pagination page={page} next={ledger.hasNext} change={change} />
  </>;
}
