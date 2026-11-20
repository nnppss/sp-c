import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { NAME_LIMIT, WORKSPACES, workspaceName } from '../desktop/workspace';
import type { Workspace, WorkspaceBridge, WorkspaceKind } from '../desktop/workspace';
import './style.css';

declare global {
  interface Window { workspaces: WorkspaceBridge }
}

const PAGES = ['Overview', 'Firms', 'Vouchers', 'Contractors', 'Cashbooks', 'Employees', 'Bank', 'Sale & Purchase', 'Reports', 'Workspace settings'] as const;
type Page = (typeof PAGES)[number];
type Entry = { page: Page; focus?: string; selection?: [number, number] };
const labels = { live: 'Live', demo: 'Demo' };
const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
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
    if (target instanceof HTMLInputElement && entry.selection) target.setSelectionRange(...entry.selection);
  }, [entry]);

  function rememberFocus() {
    const target = document.getElementById(focus.current);
    const saved: Entry = { page: entry.page, focus: target?.id };
    if (target instanceof HTMLInputElement && target.selectionStart !== null && target.selectionEnd !== null) {
      saved.selection = [target.selectionStart, target.selectionEnd];
    }
    return entries.map((item, position) => position === index ? saved : item);
  }

  function navigate(page: Page) {
    if (page === entry.page) return;
    setHistory({ entries: [...rememberFocus().slice(0, index + 1), { page }], index: index + 1 });
  }

  function move(offset: number) {
    const next = index + offset;
    if (next < 0 || next >= entries.length) return;
    setHistory({ entries: rememberFocus(), index: next });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !workspace) return;
    setNotice('');
    setError('');
    setSaving(true);
    try {
      const result = await window.workspaces.saveName(kind, workspaceName(name));
      setWorkspace(result);
      setName(result.name);
      setNotice('Workspace settings saved.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save workspace settings.');
    } finally {
      setSaving(false);
    }
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
      } else if (primary && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's' && entry.page === 'Workspace settings') {
        event.preventDefault();
        document.querySelector<HTMLFormElement>('#settings-form')?.requestSubmit();
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
          <span className={kind === 'demo' ? 'mode demo' : 'mode'}>{labels[kind]} workspace</span>
        </header>
        <main onFocusCapture={(event) => { focus.current = event.target.id || 'page-title'; }}>
          {entry.page === 'Overview' && <p className="eyebrow">{labels[kind]} workspace</p>}
          <h1 id="page-title" tabIndex={-1}>{entry.page === 'Overview' && workspace ? workspace.name : entry.page}</h1>
          {error && <p className="error" role="alert">{error}</p>}
          {entry.page === 'Overview' && (
            <>
              {workspace && <p className="intro">{workspace.demo ? 'Sample books from 20 November 2026.' : 'Your company books are stored on this computer.'}</p>}
              {!workspace && !error && <p role="status">Opening workspace…</p>}
              {workspace?.demo && (
                <dl className="balances">
                  <div><dt>Prototype vouchers</dt><dd>{workspace.demo.vouchers}</dd></div>
                  <div><dt>Trial balance debit</dt><dd>{rupees.format(workspace.demo.debit / 100)}</dd></div>
                  <div><dt>Trial balance credit</dt><dd>{rupees.format(workspace.demo.credit / 100)}</dd></div>
                </dl>
              )}
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
          {entry.page === 'Workspace settings' && !workspace && !error && <p role="status">Opening workspace…</p>}
          {entry.page !== 'Overview' && entry.page !== 'Workspace settings' && (
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
