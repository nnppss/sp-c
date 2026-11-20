import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { NAME_LIMIT, WORKSPACES, workspaceName } from '../desktop/workspace';
import type { Workspace, WorkspaceBridge, WorkspaceKind } from '../desktop/workspace';
import { Books, DAY_BOOK, TRIAL_BALANCE } from './books';
import type { BookView } from './books';
import { Cashbooks, CASHBOOK_DIRECTORY } from './cashbooks';
import type { CashbookView } from './cashbooks';
import { Contractors, CONTRACTOR_DIRECTORY } from './contractors';
import type { ContractorView } from './contractors';
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
  const changing = useRef(false);
  const availableFirms = workspace?.firms.filter(firm => !firm.archived) ?? [];
  const activeDemo = workspace?.demo && workspace.demo.firmId === workspace.activeFirmId ? workspace.demo : null;
  const booksPage = entry.page === 'Vouchers' || entry.page === 'Reports';
  const contractorsPage = entry.page === 'Contractors';
  const cashbooksPage = entry.page === 'Cashbooks';
  const bookFirm = workspace?.firms.find(firm => firm.id === (entry.archivedFirmId ?? workspace.activeFirmId));
  const bookView = entry.firmId === bookFirm?.id && entry.book ? entry.book
    : entry.page === 'Reports' ? TRIAL_BALANCE : DAY_BOOK;
  const contractorView = entry.firmId === bookFirm?.id && entry.contractor ? entry.contractor : CONTRACTOR_DIRECTORY;
  const cashbookView = entry.firmId === bookFirm?.id && entry.cashbook ? entry.cashbook : CASHBOOK_DIRECTORY;

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
    if (page === entry.page && !entry.archivedFirmId &&
        !(contractorsPage && contractorView.name !== 'directory') && !(cashbooksPage && cashbookView.name !== 'directory')) return;
    setHistory({ entries: [...rememberFocus().slice(0, index + 1), { page }], index: index + 1 });
  }

  function openEntry(next: Entry, replace = false) {
    if (replace) setHistory({ entries: entries.map((item, position) => position === index ? next : item), index });
    else setHistory({ entries: [...rememberFocus().slice(0, index + 1), next], index: index + 1 });
  }

  function openBook(view: BookView, replace = false, page: Page = entry.page) {
    openEntry({ page, book: view, firmId: bookFirm?.id, archivedFirmId: entry.archivedFirmId }, replace);
  }

  function openContractor(view: ContractorView, replace = false) {
    const focusEntry = replace && view.name === 'directory' && contractorView.name === 'directory'
      ? rememberFocus()[index] : { page: entry.page };
    openEntry({ ...focusEntry, contractor: view, firmId: bookFirm?.id }, replace);
  }

  function openCashbook(view: CashbookView, replace = false) {
    openEntry({ page: 'Cashbooks', cashbook: view, firmId: bookFirm?.id, archivedFirmId: entry.archivedFirmId }, replace);
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

  async function changeWorkspace(change: () => Promise<Workspace>) {
    if (changing.current || !workspace) return;
    changing.current = true;
    setError('');
    setSaving(true);
    try {
      const result = await change();
      setWorkspace(result);
      return result;
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

  function selectFirm(id: number) {
    if (id === workspace?.activeFirmId || changing.current) return;
    void changeWorkspace(() => window.workspaces.selectFirm(kind, id));
    if (entry.archivedFirmId) navigate(entry.page);
  }

  return (
    <div className="shell" onKeyDown={(event) => {
      if (event.defaultPrevented || event.nativeEvent.isComposing) return;
      const primary = window.workspaces.isMac ? event.metaKey : event.ctrlKey;
      const historyModifier = window.workspaces.isMac ? event.metaKey : event.altKey;
      const [back, forward] = window.workspaces.isMac ? ['[', ']'] : ['ArrowLeft', 'ArrowRight'];
      if (historyModifier && !event.shiftKey && (event.key === back || event.key === forward)) {
        event.preventDefault();
        move(event.key === back ? -1 : 1);
      } else if (primary && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's' &&
          (entry.page === 'Workspace settings' || entry.page === 'Firms' || booksPage || contractorsPage || cashbooksPage)) {
        event.preventDefault();
        const formId = booksPage ? '#book-form' : contractorsPage ? '#contractor-form'
          : cashbooksPage ? '#cashbook-form' : entry.page === 'Firms' ? '#firm-form' : '#settings-form';
        document.querySelector<HTMLFormElement>(formId)?.requestSubmit();
      }
    }}>
      <aside className="sidebar">
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
        <header className="toolbar">
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
            <form id="settings-form" className="panel settings" onSubmit={save}>
              <label htmlFor="workspace-name">Workspace name</label>
              <input id="workspace-name" required maxLength={NAME_LIMIT} value={name} readOnly={saving}
                onChange={(event) => { setName(event.target.value); setNotice(''); setError(''); }} />
              <div className="form-actions">
                <button type="submit" className="action" id="save-settings" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
                <kbd>{shortcuts.save}</kbd>
                <span role="status">{notice}</span>
              </div>
            </form>
          )}
          {workspace && (
            <section hidden={entry.page !== 'Firms'} aria-labelledby="page-title">
              <Firms kind={kind} workspace={workspace} saving={saving} shortcut={shortcuts.save}
                changeWorkspace={changeWorkspace} openArchivedBooks={openArchivedBooks} />
            </section>
          )}
          {booksPage && workspace && (bookFirm
            ? <>
                {bookFirm.archived && <button id="archived-cashbooks" className="secondary"
                  onClick={() => openCashbook(CASHBOOK_DIRECTORY)}>Archived cashbooks</button>}
                <Books key={bookFirm.id} workspace={kind} firm={bookFirm} view={bookView} savedFocus={entry.focus}
                  shortcut={shortcuts.save} open={view => openBook(view)} replace={view => openBook(view, true)} back={() => move(-1)} />
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
                showVoucher={(voucherId, saved) => openBook({ name: 'voucher', voucherId, saved }, saved, 'Vouchers')} />
            : <p className="intro">Create or select a firm to open its cashbooks.</p>)}
          {(entry.page === 'Workspace settings' || entry.page === 'Firms' || booksPage || contractorsPage || cashbooksPage) &&
            !workspace && !error && <p role="status">Opening workspace…</p>}
          {!booksPage && !contractorsPage && !cashbooksPage && entry.page !== 'Overview' && entry.page !== 'Workspace settings' && entry.page !== 'Firms' && (
            <p className="intro">This module is awaiting implementation.</p>
          )}
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
