import { useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { ACCOUNT_KINDS, VOUCHER_KINDS } from '../desktop/books';
import type { AccountKind, Chart, Line, VoucherDetail, VoucherKind, VoucherPayee } from '../desktop/books';
import type { WorkspaceKind } from '../desktop/workspace';

export const accountLabels: Record<AccountKind, string> = {
  asset: 'Asset', liability: 'Liability', equity: 'Equity', income: 'Income', expense: 'Expense',
  bank: 'Bank', cash: 'Cash', party: 'Trading party', contractor: 'Contractor', employee: 'Employee',
};

export const errorMessage = (error: unknown) => error instanceof Error
  ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Could not access these books.';

export function today() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function money(value: number | bigint) {
  const paise = BigInt(value);
  const amount = paise < 0n ? -paise : paise;
  const cents = amount % 100n;
  return (paise < 0n ? '−₹' : '₹') + (amount / 100n).toLocaleString('en-IN') +
    (cents ? '.' + cents.toString().padStart(2, '0') : '');
}

export function payeeName(payee: VoucherPayee) {
  return payee.kind === 'Firm' && payee.owner ? payee.name + ' (owner: ' + payee.owner + ')' : payee.name;
}

export function parseAmount(input: FormDataEntryValue | null) {
  const amount = String(input ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) throw new Error('Enter each amount in rupees with up to two decimal places.');
  const [rupees, cents = ''] = amount.split('.');
  const value = BigInt(rupees) * 100n + BigInt(cents.padEnd(2, '0'));
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Enter a positive amount within the allowed range.');
  return Number(value);
}

export function entryKeys(event: KeyboardEvent<HTMLFormElement>, cancel: () => void, busy: boolean) {
  if (event.nativeEvent.isComposing) return;
  if (event.key === 'Escape' && !busy) {
    event.preventDefault();
    cancel();
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || busy) return;
  const target = event.target;
  if (target instanceof HTMLSelectElement && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    const next = target.selectedIndex + (event.key === 'ArrowDown' ? 1 : -1);
    if (next >= 0 && next < target.options.length) {
      target.selectedIndex = next;
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return;
  }
  if (event.key !== 'Enter') return;
  const fields = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'input:not(:disabled), select:not(:disabled), button[type="submit"]:not(:disabled)'));
  const index = fields.indexOf(event.target as HTMLElement);
  if (index >= 0 && index < fields.length - 1) {
    event.preventDefault();
    fields[index + 1].focus();
  }
}

export type EntryContext = { workspace: WorkspaceKind; firmId: number; shortcut: string; cancel: () => void };

export function useEntry<T>(submit: (data: FormData) => Promise<T>, done: (result: T) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const data = new FormData(event.currentTarget);
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await submit(data);
      if (mounted.current) done(result);
    } catch (error) {
      if (mounted.current) setError(errorMessage(error));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { busy, error, save };
}

export function EntryActions({ label, busy, error, shortcut, cancel }: {
  label: string; busy: boolean; error: string; shortcut: string; cancel: () => void;
}) {
  const alert = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => { if (error && !busy) alert.current?.focus(); }, [error, busy]);
  return <>
    {error && <p ref={alert} className="error" role="alert" tabIndex={-1}>{error}</p>}
    <div className="form-actions">
      <button type="submit" className="action" disabled={busy}>{busy ? 'Saving…' : label}</button>
      <kbd>{shortcut}</kbd>
      <button type="button" className="secondary" disabled={busy} onClick={cancel}>Cancel</button>
    </div>
  </>;
}

export function AccountEntry({ workspace, firmId, shortcut, cancel, done }: EntryContext & { done: () => void }) {
  const { busy, error, save } = useEntry(data => window.workspaces.createAccount(workspace, firmId, {
    name: String(data.get('name')), kind: data.get('kind') as AccountKind,
  }), done);
  const name = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { name.current?.focus(); }, []);
  return <form id="book-form" className="panel settings book-form" onSubmit={save} onKeyDown={event => entryKeys(event, cancel, busy)}>
    <h2>New account</h2>
    <fieldset disabled={busy}>
      <label htmlFor="account-name">Account name</label>
      <input ref={name} id="account-name" name="name" required maxLength={180} />
      <label htmlFor="account-kind">Account type</label>
      <select id="account-kind" name="kind">
        {ACCOUNT_KINDS.filter(kind => kind !== 'contractor' && kind !== 'employee')
          .map(kind => <option key={kind} value={kind}>{accountLabels[kind]}</option>)}
      </select>
    </fieldset>
    <EntryActions label="Save account" {...{ busy, error, shortcut, cancel }} />
  </form>;
}

export function VoucherEntry({ workspace, firmId, shortcut, cancel, requestId, chart, done }: EntryContext & {
  requestId: string; chart: Chart; done: (voucher: VoucherDetail) => void;
}) {
  const [kind, setKind] = useState<VoucherKind>('Payment');
  const [rows, setRows] = useState([1, 2]);
  const nextLine = useRef(3);
  const type = useRef<HTMLSelectElement>(null);
  const focusLine = useRef<number | null>(null);
  const opening = kind === 'Opening balance';
  const accounts = chart.accounts.filter(account => !account.archived &&
    (kind !== 'Contra' || account.kind === 'bank' || account.kind === 'cash') &&
    (!opening || (account.system !== 'capital' && account.kind !== 'contractor')));
  useLayoutEffect(() => { type.current?.focus(); }, []);
  useLayoutEffect(() => {
    if (focusLine.current !== null) {
      document.getElementById('account-' + focusLine.current)?.focus();
      focusLine.current = null;
    }
  }, [rows]);

  const { busy, error, save } = useEntry(data => {
    const common = { requestId, day: String(data.get('day')), memo: String(data.get('memo')) };
    const lines: Line[] = (opening ? rows.slice(0, 1) : rows).map(row => ({
      accountId: Number(data.get('account-' + row)),
      siteId: Number(data.get('site-' + row)) || null,
      value: parseAmount(data.get('amount-' + row)) * (data.get('side-' + row) === 'credit' ? -1 : 1),
    }));
    return window.workspaces.postVoucher(workspace, firmId, kind === 'Opening balance'
      ? { ...common, kind, accountId: lines[0].accountId, value: lines[0].value }
      : { ...common, kind, lines });
  }, done);

  return <form id="book-form" className="panel settings book-form voucher-form" onSubmit={save}
    onKeyDown={event => entryKeys(event, cancel, busy)}>
    <h2>New voucher</h2>
    <fieldset disabled={busy}>
      <div className="book-fields">
        <div><label htmlFor="voucher-kind">Voucher type</label>
          <select id="voucher-kind" ref={type} value={kind} onChange={(event) => setKind(event.target.value as VoucherKind)}>
            {VOUCHER_KINDS.map(item => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div><label htmlFor="voucher-date">Voucher date</label>
          <input id="voucher-date" name="day" type="date" required defaultValue={today()} />
        </div>
      </div>
      <label htmlFor="voucher-memo">Narration</label>
      <input id="voucher-memo" name="memo" maxLength={500} />
      {opening && <p>The offset posts to Opening capital.</p>}
      <div key={kind}>
        {(opening ? rows.slice(0, 1) : rows).map((row, index) => (
          <fieldset key={row} className="posting-row">
            <legend>{opening ? 'Opening entry' : 'Line ' + (index + 1)}</legend>
            <div className="book-fields">
              <div><label htmlFor={'account-' + row}>Account</label>
                <select id={'account-' + row} name={'account-' + row} required defaultValue="">
                  <option value="">Choose account</option>
                  {accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {accountLabels[account.kind]}</option>)}
                </select>
              </div>
              <div><label htmlFor={'side-' + row}>Debit or credit</label>
                <select id={'side-' + row} name={'side-' + row} defaultValue={index === 1 ? 'credit' : 'debit'}>
                  <option value="debit">Debit</option><option value="credit">Credit</option>
                </select>
              </div>
              <div><label htmlFor={'amount-' + row}>Amount (₹)</label>
                <input id={'amount-' + row} name={'amount-' + row} inputMode="decimal" maxLength={17} required />
              </div>
              {!opening && chart.sites.length > 0 && <div><label htmlFor={'site-' + row}>Site</label>
                <select id={'site-' + row} name={'site-' + row}>
                  <option value="">No site</option>
                  {chart.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
                </select>
              </div>}
            </div>
            {!opening && rows.length > 2 && <button type="button" className="secondary"
              aria-label={'Remove line ' + (index + 1)} onClick={() => {
                focusLine.current = rows[index + 1] ?? rows[index - 1];
                setRows(rows.filter(id => id !== row));
              }}>Remove line</button>}
          </fieldset>
        ))}
      </div>
      {!opening && <button type="button" className="secondary" onClick={() => {
        const row = nextLine.current++;
        focusLine.current = row;
        setRows([...rows, row]);
      }}>Add line</button>}
    </fieldset>
    <EntryActions label="Post voucher" {...{ busy, error, shortcut, cancel }} />
  </form>;
}

export function ReversalEntry({ workspace, firmId, shortcut, cancel, requestId, original, done }: EntryContext & {
  requestId: string; original: VoucherDetail; done: (voucher: VoucherDetail) => void;
}) {
  const { busy, error, save } = useEntry(data => window.workspaces.reverseVoucher(workspace, firmId, {
    requestId, voucherId: original.id, day: String(data.get('day')), memo: String(data.get('memo')),
  }), done);
  const date = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { date.current?.focus(); }, []);
  return <form id="book-form" className="panel settings book-form" onSubmit={save} onKeyDown={event => entryKeys(event, cancel, busy)}>
    <h2>Reverse voucher #{original.id}</h2>
    <fieldset disabled={busy}>
      <label htmlFor="reversal-date">Reversal date</label>
      <input id="reversal-date" name="day" type="date" ref={date} required min={original.day} defaultValue={today() < original.day ? original.day : today()} />
      <label htmlFor="reversal-reason">Reversal reason</label>
      <input id="reversal-reason" name="memo" required maxLength={500} />
    </fieldset>
    <EntryActions label="Post reversal" {...{ busy, error, shortcut, cancel }} />
  </form>;
}
