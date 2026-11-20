import { useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { FIRM_FIELDS } from '../desktop/workspace';
import type { FirmDetails, Workspace, WorkspaceKind } from '../desktop/workspace';

const fields = Object.keys(FIRM_FIELDS) as (keyof FirmDetails)[];
const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function DemoBalances({ demo }: { demo: NonNullable<Workspace['demo']> }) {
  return (
    <dl className="balances">
      <div><dt>Prototype vouchers</dt><dd>{demo.vouchers}</dd></div>
      <div><dt>Prototype trial debit</dt><dd>{rupees.format(demo.debit / 100)}</dd></div>
      <div><dt>Prototype trial credit</dt><dd>{rupees.format(demo.credit / 100)}</dd></div>
    </dl>
  );
}

export function Firms({ kind, workspace, saving, shortcut, changeWorkspace, openArchivedBooks }: {
  kind: WorkspaceKind;
  workspace: Workspace;
  saving: boolean;
  shortcut: string;
  changeWorkspace: (change: () => Promise<Workspace>) => Promise<Workspace | undefined>;
  openArchivedBooks: (firmId: number) => void;
}) {
  const [editor, setEditor] = useState<number | 'new' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState('');
  const newButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const cancelRemoval = useRef<HTMLButtonElement>(null);
  const firm = workspace.firms.find(({ id }) => id === editor);

  useLayoutEffect(() => {
    if (confirming) cancelRemoval.current?.focus();
    else if (editor !== null) nameField.current?.focus();
  }, [editor, confirming]);

  function open(id: number | 'new', button: HTMLButtonElement) {
    opener.current = button;
    setNotice('');
    setConfirming(false);
    setEditor(id);
    if (id === editor) nameField.current?.focus();
  }

  function close(removed = false) {
    setConfirming(false);
    setEditor(null);
    (removed ? newButton.current : opener.current)?.focus();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || confirming || editor === null) return;
    const data = new FormData(event.currentTarget);
    const details = Object.fromEntries(fields.map(key => [key, data.get(key)])) as FirmDetails;
    setNotice('');
    if (await changeWorkspace(() => window.workspaces.saveFirm(kind, editor === 'new' ? null : editor, details))) {
      close();
      setNotice('Firm saved.');
    }
  }

  async function remove() {
    if (!firm || saving) return;
    const updated = await changeWorkspace(() => window.workspaces.removeFirm(kind, firm.id));
    if (updated) {
      const archived = updated.firms.some(({ id }) => id === firm.id);
      close(!archived);
      setNotice(archived ? 'Firm archived. Its records are still available.' : 'Firm deleted.');
    }
  }

  return (
    <div className="firms">
      <div className="firm-actions">
        <button className="action" id="new-firm" ref={newButton} aria-disabled={saving}
          onClick={(event) => { if (!saving) open('new', event.currentTarget); }}>New firm</button>
        <span role="status">{notice}</span>
      </div>
      {workspace.firms.length === 0 && <p className="intro">No firms have been created in this workspace.</p>}
      {workspace.firms.length > 0 && <ul className="panel firm-list" aria-label="Firm directory">
        {workspace.firms.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.name}</strong>
              {item.id === workspace.activeFirmId && <span className="mode">Active firm</span>}
              {item.archived && <span className="mode archived">Archived</span>}
              {item.owner && <p>{item.owner}</p>}
            </div>
            <button type="button" className="secondary" id={`edit-firm-${item.id}`}
              aria-label={`Edit ${item.name}`} aria-disabled={saving}
              onClick={(event) => { if (!saving) open(item.id, event.currentTarget); }}>Edit</button>
          </li>
        ))}
      </ul>}
      {editor !== null && (
        <form key={editor} id="firm-form" className="panel settings" onSubmit={save}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || saving || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (confirming) setConfirming(false);
            else close();
          }}>
          <h2>{firm ? `Edit ${firm.name}` : 'New firm'}</h2>
          {fields.map((field, index) => {
            const { label, limit } = FIRM_FIELDS[field];
            const props = {
              id: `firm-${field}`, name: field, maxLength: limit, defaultValue: firm?.[field] ?? '',
              readOnly: saving || confirming,
            };
            return (
              <div key={field}>
                <label htmlFor={props.id}>{label}</label>
                {field === 'address' ? <textarea {...props} rows={2} /> :
                  <input {...props} ref={field === 'name' ? nameField : undefined} required={field === 'name'}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || event.nativeEvent.isComposing || index === fields.length - 1) return;
                      event.preventDefault();
                      document.getElementById(`firm-${fields[index + 1]}`)?.focus();
                    }} />}
              </div>
            );
          })}
          {confirming ? (
            <div className="removal">
              <p id="removal-description">Remove {firm?.name}? Unused firms are deleted. Firms with records are archived with their history.</p>
              <div className="form-actions">
                <button className="secondary" id="keep-firm" type="button" ref={cancelRemoval} disabled={saving}
                  aria-describedby="removal-description"
                  onClick={() => setConfirming(false)}>Keep firm</button>
                <button className="danger" id="confirm-removal" type="button" disabled={saving}
                  aria-describedby="removal-description"
                  onClick={remove}>Confirm removal</button>
              </div>
            </div>
          ) : (
            <div className="form-actions">
              <button type="submit" className="action" id="save-firm" disabled={saving}>Save firm</button>
              <kbd>{shortcut}</kbd>
              <button type="button" className="secondary" id="cancel-firm" disabled={saving} onClick={() => close()}>Cancel</button>
              {firm && !firm.archived && <button className="danger" id="remove-firm" type="button" disabled={saving}
                onClick={() => setConfirming(true)}>Remove firm</button>}
            </div>
          )}
        </form>
      )}
      {firm?.archived && (
        <section className="firm-history" aria-label="Archived firm history">
          {workspace.demo && workspace.demo.firmId === firm.id && <DemoBalances demo={workspace.demo} />}
          <button className="secondary" id="open-archived-books" onClick={() => openArchivedBooks(firm.id)}>Open archived books</button>
        </section>
      )}
    </div>
  );
}
