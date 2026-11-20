import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { NAME_LIMIT, WORKSPACES, workspaceName } from '../desktop/workspace';
import type { Workspace, WorkspaceBridge, WorkspaceKind } from '../desktop/workspace';
import { Books, DAY_BOOK } from './books';
import type { BookView } from './books';
import { Cashbooks, CASHBOOK_DIRECTORY } from './cashbooks';
import type { CashbookView } from './cashbooks';
import { Contractors, CONTRACTOR_DIRECTORY } from './contractors';
import type { ContractorView } from './contractors';
import { Employees } from './employees';
import type { EmployeeView } from './employees';
import { Bank } from './bank';
import type { BankView } from './bank';
import { Invoices, INVOICE_REGISTER } from './invoices';
import type { InvoiceView } from './invoices';
import { Reports, REPORT_HOME } from './reports';
import type { ReportView } from './reports';
import type { ReportSource } from '../desktop/report-model';
import { NAMED_DIRECTORY } from './named-books';
import { DemoBalances, Firms } from './firms';
import './style.css';

declare global {
  interface Window { workspaces: WorkspaceBridge }
}

const PAGES = ['Overview', 'Firms', 'Vouchers', 'Contractors', 'Cashbooks', 'Employees', 'Bank', 'Sale & Purchase', 'Reports', 'Workspace settings'] as const;
type Page = (typeof PAGES)[number];
type Entry = {
  page: Page; focus?: string; selection?: [number, number];
  book?: BookView; contractor?: ContractorView; cashbook?: CashbookView; firmId?: number; archivedFirmId?: number;
  employee?: EmployeeView; bank?: BankView; invoice?: InvoiceView; report?: ReportView; scopeFirmId?: number;
};
const labels = { live: 'Live', demo: 'Demo' };
const shortcuts = window.workspaces.isMac
  ? { back: '⌘ [', forward: '⌘ ]', save: '⌘ S' }
  : { back: 'Alt ←', forward: 'Alt →', save: 'Ctrl S' };

function WorkspaceShell({ kind, switchWorkspace }: { kind: WorkspaceKind; switchWorkspace: (kind: WorkspaceKind) => void }) {
  const [history, setHistory] = useState<{ entries: Entry[]; index: number }>({ entries: [{ page: 'Overview' }], index: 0 });
  const { entries, index } = history;
  const entry = entries[index];
  const focus = useRef('page-title');
  const [workspace, setWorkspace] = useState<Workspace>();
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [transfer, setTransfer] = useState<'backup' | 'restore'>();
  const [restores, setRestores] = useState(0);
  const changing = useRef(false);
  const availableFirms = workspace?.firms.filter(firm => !firm.archived) ?? [];
  const activeDemo = workspace?.demo && workspace.demo.firmId === workspace.activeFirmId ? workspace.demo : null;
  const booksPage = entry.page === 'Vouchers';
  const reportsPage = entry.page === 'Reports';
  const invoicesPage = entry.page === 'Sale & Purchase';
  const contractorsPage = entry.page === 'Contractors';
  const cashbooksPage = entry.page === 'Cashbooks';
  const employeesPage = entry.page === 'Employees';
  const bankPage = entry.page === 'Bank';
  const bookFirm = workspace?.firms.find(firm => firm.id === (entry.scopeFirmId ?? entry.archivedFirmId ?? workspace.activeFirmId));
  const bookView = entry.firmId === bookFirm?.id && entry.book ? entry.book : DAY_BOOK;
  const invoiceView = entry.firmId === bookFirm?.id && entry.invoice ? entry.invoice : INVOICE_REGISTER;
  const reportView = entry.report ?? REPORT_HOME;
  const contractorView = entry.firmId === bookFirm?.id && entry.contractor ? entry.contractor : CONTRACTOR_DIRECTORY;
  const cashbookView = entry.firmId === bookFirm?.id && entry.cashbook ? entry.cashbook : CASHBOOK_DIRECTORY;
  const employeeView = entry.firmId === bookFirm?.id && entry.employee ? entry.employee : NAMED_DIRECTORY;
  const bankView = entry.firmId === bookFirm?.id && entry.bank ? entry.bank : NAMED_DIRECTORY;

  useEffect(() => {
    let active = true;
    window.workspaces.read(kind).then((result) => {
      if (!active) return;
      setWorkspace(result);
      setName(result.name);
    }).catch(() => {
      if (active) setError('Could not open this workspace. Reopen the app to try again.');
    });
    return () => { active = false; };
  }, [kind]);

  useLayoutEffect(() => {
    const target = document.getElementById(entry.focus ?? 'page-title') ?? document.getElementById('page-title');
    target?.focus();
    if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && entry.selection) {
      target.setSelectionRange(...entry.selection);
    }
  }, [entry]);

  function rememberFocus() {
    const target = document.getElementById(focus.current);
    const saved: Entry = { ...entry, focus: target?.id, selection: undefined };
    if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
        target.selectionStart !== null && target.selectionEnd !== null) {
      saved.selection = [target.selectionStart, target.selectionEnd];
    }
    return entries.map((item, position) => position === index ? saved : item);
  }

  function navigate(page: Page) {
    if (page === entry.page && !entry.archivedFirmId && !entry.scopeFirmId &&
        !(invoicesPage && invoiceView.name !== 'register') &&
        !(contractorsPage && contractorView.name !== 'directory') && !(cashbooksPage && cashbookView.name !== 'directory') &&
        !(employeesPage && employeeView.name !== 'directory') && !(bankPage && bankView.name !== 'directory')) return;
    setHistory({ entries: [...rememberFocus().slice(0, index + 1), { page }], index: index + 1 });
  }

  function openEntry(next: Entry, replace = false) {
    if (replace) setHistory({ entries: entries.map((item, position) => position === index ? next : item), index });
    else setHistory({ entries: [...rememberFocus().slice(0, index + 1), next], index: index + 1 });
  }

  function openBook(view: BookView, replace = false, page: Page = entry.page) {
    openEntry({ page, book: view, firmId: bookFirm?.id, archivedFirmId: entry.archivedFirmId, scopeFirmId: entry.scopeFirmId }, replace);
  }

  function openContractor(view: ContractorView, replace = false) {
    const focusEntry = replace && view.name === 'directory' && contractorView.name === 'directory'
      ? rememberFocus()[index] : { page: entry.page };
    openEntry({ ...focusEntry, contractor: view, firmId: bookFirm?.id }, replace);
  }

  function openCashbook(view: CashbookView, replace = false) {
    openEntry({ page: 'Cashbooks', cashbook: view, firmId: bookFirm?.id, archivedFirmId: entry.archivedFirmId, scopeFirmId: entry.scopeFirmId }, replace);
  }

  function openEmployee(view: EmployeeView, replace = false) {
    openEntry({ page: 'Employees', employee: view, firmId: bookFirm?.id, archivedFirmId: entry.archivedFirmId, scopeFirmId: entry.scopeFirmId }, replace);
  }

  function openBank(view: BankView, replace = false) {
    const focus = view.name === 'review' ? view.confirmation && !view.editing ? 'statement-action' : 'bank-offset' : undefined;
    openEntry({ page: 'Bank', bank: view, focus, firmId: bookFirm?.id, archivedFirmId: entry.archivedFirmId, scopeFirmId: entry.scopeFirmId }, replace);
  }

  function openInvoice(view: InvoiceView, replace = false, firmId = bookFirm?.id) {
    openEntry({ page: 'Sale & Purchase', invoice: view, firmId, scopeFirmId: firmId }, replace);
  }

  function openReport(view: ReportView, firmId: number, replace = false) {
    openEntry({ page: 'Reports', report: view, scopeFirmId: firmId }, replace);
  }

  function reportSource(source: ReportSource) {
    const { firmId } = source;
    switch (source.view) {
      case 'invoice': return openInvoice({ name: 'issued', voucherId: source.id }, false, firmId);
      case 'voucher': return openEntry({ page: 'Vouchers', book: { name: 'voucher', voucherId: source.id }, firmId, scopeFirmId: firmId });
      case 'ledger': return openReport({ query: { name: 'ledger', accountId: source.id, ...source.period } }, firmId);
      case 'pnl': return openReport({ query: { name: 'pnl', ...source.period } }, firmId);
      case 'statement': return openEntry({ page: 'Bank', bank: { name: 'review', accountId: source.accountId, rowId: source.id,
        requestId: crypto.randomUUID() }, firmId, scopeFirmId: firmId });
    }
  }

  function openArchivedBooks(firmId: number) {
    const next: Entry = { page: 'Vouchers', archivedFirmId: firmId };
    setHistory({ entries: [...rememberFocus().slice(0, index + 1), next], index: index + 1 });
  }

  function move(offset: number) {
    const next = index + offset;
    if (next < 0 || next >= entries.length) return;
    setHistory({ entries: rememberFocus(), index: next });
  }

  async function changeWorkspace(change: () => Promise<Workspace | null>) {
    if (changing.current || !workspace) return;
    changing.current = true;
    setError('');
    setSaving(true);
    try {
      const result = await change();
      if (result) {
        setWorkspace(result);
        return result;
      }
    } catch (error) {
      setError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
        : 'Could not update the workspace.');
    } finally {
      changing.current = false;
      setSaving(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    const result = await changeWorkspace(() => window.workspaces.saveName(kind, workspaceName(name)));
    if (result) {
      setName(result.name);
      setNotice('Workspace settings saved.');
    }
  }

  async function transferBooks(operation: 'backup' | 'restore') {
    if (changing.current) return;
    setNotice('');
    setTransfer(operation);
    try {
      const restored = await changeWorkspace(async () => {
        if (operation === 'restore') return window.workspaces.restore(kind);
        if (await window.workspaces.backup(kind)) setNotice('Workspace backup saved.');
        return null;
      });
      if (restored) {
        setName(restored.name);
        setRestores(count => count + 1);
        setHistory({ entries: [{ page: 'Workspace settings', focus: 'restore-workspace' }], index: 0 });
        setNotice(`Workspace restored. The previous books were saved as ${kind}.before-restore.sqlite3.`);
      }
    } finally {
      setTransfer(undefined);
    }
  }

  function selectFirm(id: number) {
    if (id === workspace?.activeFirmId || changing.current) return;
    void changeWorkspace(() => window.workspaces.selectFirm(kind, id));
    if (entry.archivedFirmId || entry.scopeFirmId) navigate(entry.page);
  }

  return (
    <div className="shell" onKeyDown={(event) => {
      if (transfer || event.defaultPrevented || event.nativeEvent.isComposing) return;
      const primary = window.workspaces.isMac ? event.metaKey : event.ctrlKey;
      const historyModifier = window.workspaces.isMac ? event.metaKey : event.altKey;
      const [back, forward] = window.workspaces.isMac ? ['[', ']'] : ['ArrowLeft', 'ArrowRight'];
      if (historyModifier && !event.shiftKey && (event.key === back || event.key === forward)) {
        event.preventDefault();
        move(event.key === back ? -1 : 1);
      } else if (primary && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's' &&
          (entry.page === 'Workspace settings' || entry.page === 'Firms' || booksPage || contractorsPage || cashbooksPage ||
            employeesPage || bankPage || invoicesPage)) {
        event.preventDefault();
        const formId = invoicesPage ? '#invoice-form' : booksPage ? '#book-form' : contractorsPage ? '#contractor-form'
          : cashbooksPage ? '#cashbook-form' : employeesPage || bankPage ? '#module-form'
            : entry.page === 'Firms' ? '#firm-form' : '#settings-form';
        document.querySelector<HTMLFormElement>(formId)?.requestSubmit();
      }
    }}>
      <aside className="sidebar" inert={Boolean(transfer)}>
        <div className="brand"><span className="monogram" aria-hidden="true">SP</span><div>SP &amp; Company<span>ACCOUNTS</span></div></div>
        <div className="workspace-picker" role="group" aria-label="Workspace">
          {WORKSPACES.map(key => (
            <button key={key} aria-pressed={kind === key} onClick={() => switchWorkspace(key)}>{labels[key]}</button>
          ))}
        </div>
        <nav aria-label="Pages">
          {PAGES.map(page => (
            <button key={page} aria-current={entry.page === page ? 'page' : undefined} onClick={() => navigate(page)}>{page}</button>
          ))}
        </nav>
      </aside>
      <div className="workspace">
        <header className="toolbar" inert={Boolean(transfer)}>
          <div className="history" role="group" aria-label="Page history">
            <button type="button" disabled={index === 0} onClick={() => move(-1)}>Back <kbd>{shortcuts.back}</kbd></button>
            <button type="button" disabled={index === entries.length - 1} onClick={() => move(1)}>Forward <kbd>{shortcuts.forward}</kbd></button>
          </div>
          <div className="toolbar-context">
            <div className="firm-picker">
              <label htmlFor="active-firm">Active firm</label>
              <select id="active-firm" value={workspace?.activeFirmId ?? ''} disabled={availableFirms.length === 0} aria-disabled={saving}
                onChange={(event) => selectFirm(Number(event.target.value))}
                onKeyDown={(event) => {
                  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
                      event.nativeEvent.isComposing || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                  event.preventDefault();
                  const index = availableFirms.findIndex(firm => firm.id === workspace?.activeFirmId);
                  const next = availableFirms[index + (event.key === 'ArrowDown' ? 1 : -1)];
                  if (next) selectFirm(next.id);
                }}>
                {availableFirms.length === 0 && <option value="">No firm selected</option>}
                {availableFirms.map(firm => <option key={firm.id} value={firm.id}>{firm.name}</option>)}
              </select>
            </div>
            <span className={kind === 'demo' ? 'mode demo' : 'mode'}>{labels[kind]} workspace</span>
          </div>
        </header>
        <main onFocusCapture={(event) => { focus.current = event.target.id || 'page-title'; }}>
          {entry.page === 'Overview' && <p className="eyebrow">{labels[kind]} workspace</p>}
          <h1 id="page-title" tabIndex={-1}>{entry.page === 'Overview' && workspace ? workspace.name : entry.page}</h1>
          {error && <p className="error" role="alert">{error}</p>}
          {entry.page === 'Overview' && (
            <>
              {workspace && <p className="intro">{workspace.demo ? 'Sample books from 20 November 2026.' : 'Your company books are stored on this computer.'}</p>}
              {!workspace && !error && <p role="status">Opening workspace…</p>}
              {activeDemo && <DemoBalances demo={activeDemo} />}
              {workspace && <div className="panel overview-panel">
                <div><h2>Workspace settings</h2><p>Set the name displayed when these books open.</p></div>
                <button className="action" id="open-settings" onClick={() => navigate('Workspace settings')}>Open settings</button>
              </div>}
            </>
          )}
          {entry.page === 'Workspace settings' && workspace && (
            <>
              <form id="settings-form" className="panel settings" onSubmit={save}>
                <label htmlFor="workspace-name">Workspace name</label>
                <input id="workspace-name" required maxLength={NAME_LIMIT} value={name} readOnly={saving}
                  onChange={(event) => { setName(event.target.value); setNotice(''); setError(''); }} />
                <div className="form-actions">
                  <button type="submit" className="action" id="save-settings" disabled={saving}>{saving && !transfer ? 'Saving…' : 'Save settings'}</button>
                  <kbd>{shortcuts.save}</kbd>
                </div>
              </form>
              <section className="panel settings" aria-labelledby="backup-title">
                <h2 id="backup-title">Backup and restore</h2>
                <p>Save all firms and books in {labels[kind]}. Restoring a backup replaces this entire workspace.</p>
                <div className="form-actions">
                  <button type="button" className="action" id="save-backup" aria-disabled={saving}
                    onClick={() => void transferBooks('backup')}>Save backup</button>
                  <button type="button" className="secondary" id="restore-workspace" aria-disabled={saving}
                    onClick={() => void transferBooks('restore')}>Restore backup</button>
                </div>
              </section>
              <p role="status">{transfer === 'backup' ? 'Saving backup…' : transfer === 'restore' ? 'Restoring backup…' : notice}</p>
            </>
          )}
          {workspace && (
            <section hidden={entry.page !== 'Firms'} aria-labelledby="page-title">
              <Firms key={restores} kind={kind} workspace={workspace} saving={saving} shortcut={shortcuts.save}
                changeWorkspace={changeWorkspace} openArchivedBooks={openArchivedBooks} />
            </section>
          )}
          {booksPage && workspace && (bookFirm
            ? <>
                {bookFirm.archived && <button id="archived-cashbooks" className="secondary"
                  onClick={() => openCashbook(CASHBOOK_DIRECTORY)}>Archived cashbooks</button>}
                {bookFirm.archived && <button id="archived-employees" className="secondary"
                  onClick={() => openEmployee(NAMED_DIRECTORY)}>Archived employees</button>}
                {bookFirm.archived && <button id="archived-bank" className="secondary"
                  onClick={() => openBank(NAMED_DIRECTORY)}>Archived bank accounts</button>}
                <Books key={bookFirm.id} workspace={kind} firm={bookFirm} view={bookView} savedFocus={entry.focus}
                  shortcut={shortcuts.save} showInvoice={voucherId => openInvoice({ name: 'issued', voucherId })}
                  open={view => openBook(view)} replace={view => openBook(view, true)} back={() => move(-1)} />
              </>
            : <p className="intro">Create or select a firm to open its books.</p>)}
          {contractorsPage && workspace && (bookFirm
            ? <Contractors key={bookFirm.id} workspace={kind} firm={bookFirm} view={contractorView} savedFocus={entry.focus}
                shortcut={shortcuts.save} open={openContractor} replace={view => openContractor(view, true)} back={() => move(-1)}
                showVoucher={(voucherId, saved) => openBook({ name: 'voucher', voucherId, saved }, saved, 'Vouchers')} />
            : <p className="intro">Create or select a firm to open its contractors.</p>)}
          {cashbooksPage && workspace && (bookFirm
            ? <Cashbooks key={bookFirm.id} workspace={kind} firm={bookFirm} firms={workspace.firms} view={cashbookView}
                savedFocus={entry.focus} shortcut={shortcuts.save} open={openCashbook} back={() => move(-1)}
                payBill={cashbookId => openInvoice({ name: 'register', query: { payableOnly: true }, cashbookId })}
                showVoucher={(voucherId, saved) => openBook({ name: 'voucher', voucherId, saved }, saved, 'Vouchers')} />
            : <p className="intro">Create or select a firm to open its cashbooks.</p>)}
          {employeesPage && workspace && (bookFirm
            ? <Employees key={bookFirm.id} workspace={kind} firm={bookFirm} view={employeeView} savedFocus={entry.focus}
                shortcut={shortcuts.save} open={openEmployee} back={() => move(-1)}
                showVoucher={(voucherId, saved) => openBook({ name: 'voucher', voucherId, saved }, saved, 'Vouchers')}
                openCashbook={(id, employeeId) => openCashbook(id === null
                  ? { name: 'new', requestId: crypto.randomUUID(), employeeId } : { name: 'ledger', query: { accountId: id } })} />
            : <p className="intro">Create or select a firm to open its employees.</p>)}
          {bankPage && workspace && (bookFirm
            ? <Bank key={bookFirm.id} workspace={kind} firm={bookFirm} view={bankView} savedFocus={entry.focus}
                shortcut={shortcuts.save} open={openBank} back={() => move(-1)}
                showVoucher={(voucherId, saved) => openBook({ name: 'voucher', voucherId, saved }, saved, 'Vouchers')} />
            : <p className="intro">Create or select a firm to open its bank accounts.</p>)}
          {(entry.page === 'Workspace settings' || entry.page === 'Firms' || booksPage || contractorsPage || cashbooksPage ||
            employeesPage || bankPage || invoicesPage || reportsPage) &&
            !workspace && !error && <p role="status">Opening workspace…</p>}
          {invoicesPage && workspace && (bookFirm
            ? <Invoices key={bookFirm.id} workspace={kind} firm={bookFirm} firms={workspace.firms} view={invoiceView}
                savedFocus={entry.focus} shortcut={shortcuts.save} open={openInvoice} back={() => move(-1)}
                showVoucher={(voucherId, saved) => openBook({ name: 'voucher', voucherId, saved }, saved, 'Vouchers')} />
            : <p className="intro">Create or select a firm to enter its invoices.</p>)}
          {reportsPage && workspace && (bookFirm
            ? <Reports key={bookFirm.id} workspace={kind} firm={bookFirm} firms={workspace.firms} view={reportView}
                savedFocus={entry.focus} open={openReport} source={reportSource} />
            : <p className="intro">Create or select a firm to open its reports.</p>)}
        </main>
        <footer><span className="offline-dot" aria-hidden="true" /> Offline · Local storage</footer>
      </div>
    </div>
  );
}

function App() {
  const [kind, setKind] = useState<WorkspaceKind>('live');
  return <WorkspaceShell key={kind} kind={kind} switchWorkspace={setKind} />;
}

createRoot(document.getElementById('root')!).render(<App />);
