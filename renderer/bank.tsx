import { useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { STATEMENT_FILE_LIMIT } from '../desktop/books';
import type { Chart, DayBookQuery, NamedAccount, Paged, StatementConfirmation, StatementMapping, StatementPreview,
  StatementRow, Voucher } from '../desktop/books';
import type { Firm, WorkspaceKind } from '../desktop/workspace';
import { accountLabels, EntryActions, entryKeys, money, parseAmount, today, useEntry } from './book-entry';
import type { EntryContext } from './book-entry';
import { Filters, Pagination, Table } from './books';
import { moduleTitle, MovementTable, NamedAccountForm, NamedDirectory, RemoveNamedAccount, useModuleReport } from './named-books';
import type { NamedView, ShowVoucher } from './named-books';

export type BankView = NamedView
  | ({ name: 'ledger'; accountId: number } & DayBookQuery)
  | { name: 'manual'; accountId: number; requestId: string }
  | { name: 'statement'; accountId: number; page?: number; pending?: boolean; notice?: string }
  | { name: 'import'; accountId: number }
  | { name: 'review'; accountId: number; rowId: number; requestId: string; confirmation?: StatementConfirmation; editing?: boolean };

async function load(workspace: WorkspaceKind, firmId: number, view: BankView) {
  const bridge = window.workspaces;
  const accounts = bridge.getNamedAccounts(workspace, firmId, { kind: 'bank' });
  if (view.name === 'ledger') {
    const [banks, chart, ledger] = await Promise.all([
      accounts, bridge.getChart(workspace, firmId), bridge.getLedger(workspace, firmId, view),
    ]);
    return { accounts: banks, chart, ledger };
  }
  if (view.name === 'statement') {
    const [banks, statement] = await Promise.all([accounts, bridge.getStatements(workspace, firmId, view)]);
    return { accounts: banks, statement };
  }
  if (view.name === 'review') {
    const [banks, chart, row, matches] = await Promise.all([
      accounts, bridge.getChart(workspace, firmId), bridge.getStatement(workspace, firmId, { bankId: view.accountId, rowId: view.rowId }),
      view.confirmation && !view.editing ? bridge.getStatementMatches(workspace, firmId, view.confirmation) : undefined,
    ]);
    return { accounts: banks, chart, row, matches };
  }
  if (view.name === 'manual') {
    const [banks, chart] = await Promise.all([accounts, bridge.getChart(workspace, firmId)]);
    return { accounts: banks, chart };
  }
  return { accounts: await accounts };
}

function DirectionFields({ bank, chart, outgoing, existing, selection }: {
  bank: NamedAccount; chart: Chart; outgoing: boolean; existing?: boolean; selection?: StatementConfirmation;
}) {
  const offset = <div key="offset">
    <label htmlFor="bank-offset">{outgoing ? 'To' : 'From'}</label>
    <select id="bank-offset" name="offset" defaultValue={selection?.accountId ?? ''} required>
      <option value="">Choose an account</option>
      {chart.accounts.filter(account => account.id !== bank.id && (existing || !account.archived))
        .map(account => <option key={account.id} value={account.id}>
          {account.name} · {accountLabels[account.kind]}{account.archived ? ' (archived)' : ''}
        </option>)}
    </select>
  </div>;
  const bankName = <div key="bank"><label htmlFor="bank-fixed">{outgoing ? 'From' : 'To'}</label>
    <input id="bank-fixed" value={bank.name} disabled readOnly /></div>;
  return <>
    <div className="book-fields">{outgoing ? [bankName, offset] : [offset, bankName]}</div>
    <label htmlFor="bank-site">Site</label>
    <select id="bank-site" name="site" defaultValue={selection?.siteId ?? ''}>
      <option value="">No site</option>
      {chart.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
    </select>
  </>;
}

function ManualBankEntry({ workspace, firmId, shortcut, cancel, bank, chart, requestId, done }: EntryContext & {
  bank: NamedAccount; chart: Chart; requestId: string; done: ShowVoucher;
}) {
  const [outgoing, setOutgoing] = useState(true);
  const first = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { first.current?.focus(); }, []);
  const { busy, error, save } = useEntry(data => window.workspaces.postBank(workspace, firmId, {
    bankId: bank.id, requestId, day: String(data.get('day')), memo: String(data.get('memo')),
    accountId: Number(data.get('offset')), siteId: Number(data.get('site')) || null,
    value: parseAmount(data.get('amount')) * (outgoing ? -1 : 1),
  }), voucher => done(voucher.id, true));
  return <form id="module-form" className="panel settings book-form" onSubmit={save}
    onKeyDown={event => entryKeys(event, cancel, busy)}>
    {moduleTitle('New bank entry · ' + bank.name)}
    <fieldset disabled={busy}>
      <label htmlFor="bank-day">Voucher date</label>
      <input id="bank-day" ref={first} name="day" type="date" defaultValue={today()} required />
      <label htmlFor="bank-direction">Direction</label>
      <select id="bank-direction" value={outgoing ? 'out' : 'in'} onChange={event => setOutgoing(event.target.value === 'out')}>
        <option value="out">Money out</option><option value="in">Money in</option>
      </select>
      <DirectionFields {...{ bank, chart, outgoing }} />
      <label htmlFor="bank-amount">Amount (₹)</label>
      <input id="bank-amount" name="amount" inputMode="decimal" required maxLength={17} />
      <label htmlFor="bank-memo">Narration</label>
      <input id="bank-memo" name="memo" maxLength={500} />
    </fieldset>
    <EntryActions label="Post voucher" {...{ busy, error, shortcut, cancel }} />
  </form>;
}

function Column({ field, label, header, optional }: { field: string; label: string; header: string[]; optional?: boolean }) {
  return <>
    <label htmlFor={'column-' + field}>{label}</label>
    <select id={'column-' + field} name={field} required={!optional} defaultValue="">
      <option value="">{optional ? 'No column' : 'Choose a column'}</option>
      {header.map((name, index) => <option key={index} value={index}>{name || 'Unnamed'} · Column {index + 1}</option>)}
    </select>
  </>;
}

function StatementImportForm({ workspace, firmId, shortcut, cancel, bank, done }: EntryContext & {
  bank: NamedAccount; done: (added: number, existing: number) => void;
}) {
  const [preview, setPreview] = useState<StatementPreview>();
  const [sheet, setSheet] = useState<string>();
  const [signed, setSigned] = useState(true);
  const first = useRef<HTMLInputElement>(null);
  const mapField = useRef<HTMLSelectElement>(null);
  const ready = !!preview && preview.sheet === sheet;
  useLayoutEffect(() => { first.current?.focus(); }, []);
  useLayoutEffect(() => { if (ready) mapField.current?.focus(); }, [ready]);
  const { busy, error, save } = useEntry(async data => {
    const file = data.get('file');
    if (!(file instanceof File) || !file.size || file.size > STATEMENT_FILE_LIMIT) {
      throw new Error('Choose a non-empty CSV or XLSX statement up to 8 MB.');
    }
    const source = { filename: file.name, bytes: await file.arrayBuffer(), sheet };
    if (!ready) return { preview: await window.workspaces.previewStatement(workspace, firmId, source) };
    const column = (field: string) => Number(data.get(field));
    const mapping: StatementMapping = {
      date: column('date'), description: column('description'),
      reference: data.get('reference') ? column('reference') : undefined,
      ...(signed ? { amount: column('amount') } : { debit: column('debit'), credit: column('credit') }),
    };
    return { imported: await window.workspaces.importStatement(workspace, firmId, { ...source, accountId: bank.id, mapping }) };
  }, result => {
    if (result.preview) {
      setPreview(result.preview);
      setSheet(result.preview.sheet);
    } else if (result.imported) done(result.imported.added, result.imported.existing);
  });
  return <form id="module-form" className="panel settings book-form" onSubmit={save}
    onKeyDown={event => entryKeys(event, cancel, busy)}>
    {moduleTitle('Import statement · ' + bank.name)}
    <fieldset disabled={busy}>
      <label htmlFor="statement-file">CSV or XLSX file</label>
      <input id="statement-file" ref={first} name="file" type="file" accept=".csv,.xlsx" required
        onChange={() => { setPreview(undefined); setSheet(undefined); }} />
      {preview && preview.sheets.length > 1 && <>
        <label htmlFor="statement-sheet">Worksheet</label>
        <select id="statement-sheet" value={sheet} onChange={event => setSheet(event.target.value)}>
          {preview.sheets.map(name => <option key={name}>{name}</option>)}
        </select>
      </>}
      {ready && <>
        <p>{preview.count} source rows. Map the date, description and amount columns.</p>
        <Table heading="Statement preview" headings={preview.header.map((value, index) => value || 'Column ' + (index + 1))}>
          {preview.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell || '—'}</td>)}</tr>)}
        </Table>
        <div className="statement-mapping" key={preview.sheet}>
          <label htmlFor="statement-layout">Amount layout</label>
          <select id="statement-layout" ref={mapField} value={signed ? 'signed' : 'split'}
            onChange={event => setSigned(event.target.value === 'signed')}>
            <option value="signed">Signed amount</option><option value="split">Debit and credit</option>
          </select>
          <p>Dates can be Excel dates, YYYY-MM-DD or DD/MM/YYYY. Withdrawals are negative signed amounts or positive debits.</p>
          <Column field="date" label="Date column" header={preview.header} />
          <Column field="description" label="Description column" header={preview.header} />
          <Column field="reference" label="Reference column" header={preview.header} optional />
          {signed ? <Column field="amount" label="Signed amount column" header={preview.header} /> : <>
            <Column field="debit" label="Debit column" header={preview.header} />
            <Column field="credit" label="Credit column" header={preview.header} />
          </>}
        </div>
      </>}
    </fieldset>
    <EntryActions label={ready ? 'Save pending rows' : 'Preview statement'} {...{ busy, error, shortcut, cancel }} />
  </form>;
}

function ReviewStatement({ workspace, firmId, shortcut, cancel, bank, chart, row, view, matches, open, done }: EntryContext & {
  bank: NamedAccount; chart: Chart; row: StatementRow; view: Extract<BankView, { name: 'review' }>;
  matches?: Paged<Voucher>; open: (view: BankView, replace?: boolean) => void; done: ShowVoucher;
}) {
  const { confirmation } = view;
  const { busy, error, save } = useEntry(data => {
    const choice = String(data.get('choice'));
    return window.workspaces.confirmStatement(workspace, firmId, {
      ...confirmation!, requestId: view.requestId, voucherId: choice === 'post' ? null : Number(choice),
    }).then(voucher => ({ voucher, posted: choice === 'post' }));
  }, ({ voucher, posted }) => done(voucher.id, posted));
  const page = confirmation?.page ?? 0;
  function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    open({ ...view, editing: false, confirmation: { bankId: bank.id, rowId: row.id,
      accountId: Number(data.get('offset')), siteId: Number(data.get('site')) || null } }, true);
  }
  const linked = row.voucherId;
  const reviewing = confirmation && matches;
  const counterpart = chart.accounts.find(account => account.id === confirmation?.accountId)?.name;
  const site = chart.sites.find(site => site.id === confirmation?.siteId)?.name ?? 'No site';
  return <>{moduleTitle('Review statement row ' + row.rowNumber)}
    <dl className="balances">
      <div><dt>Date</dt><dd>{row.day}</dd></div>
      <div><dt>Bank movement</dt><dd>{money(row.value)}</dd></div>
      <div><dt>Description</dt><dd>{row.description || '—'}</dd></div>
      <div><dt>Reference</dt><dd>{row.reference || '—'}</dd></div>
    </dl>
    <p className="intro">{row.filename} · {row.sheet} · Row {row.rowNumber}</p>
    {linked !== null ? <button className="action" id="linked-statement-voucher" onClick={() => done(linked)}>Open voucher #{linked}</button>
      : bank.archived ? <p>Pending · Archived bank account</p> : <>
        {!reviewing && <form id="module-form" className="panel settings book-form" onSubmit={find}
          onKeyDown={event => entryKeys(event, cancel, false)}>
          <DirectionFields bank={bank} chart={chart} outgoing={row.value < 0} existing selection={confirmation} />
          <EntryActions label="Find matching vouchers" busy={false} error="" {...{ shortcut, cancel }} />
        </form>}
        {reviewing && <form id="module-form" className="panel settings book-form statement-mapping"
          onSubmit={save} onKeyDown={event => entryKeys(event, cancel, busy)}>
          <h3>Confirm posting or match</h3>
          <dl className="balances">
            <div><dt>From</dt><dd>{row.value < 0 ? bank.name : counterpart}</dd></div>
            <div><dt>To</dt><dd>{row.value < 0 ? counterpart : bank.name}</dd></div>
            <div><dt>Site</dt><dd>{site}</dd></div>
          </dl>
          <button type="button" className="secondary" id="change-bank-direction" disabled={busy}
            onClick={() => open({ ...view, editing: true }, true)}>Change accounts or site</button>
          {matches.hasNext || page > 0 || matches.rows.length > 1
            ? <p>Multiple vouchers match. Inspect them and choose the voucher you can verify.</p>
            : matches.rows.length === 1 ? <p>A voucher matches. Check it before posting a new one.</p>
              : <p>No matching vouchers for the confirmed account and site.</p>}
          {matches.rows.length > 0 && <Table heading="Matching vouchers" headings={['Voucher', 'Type', 'Narration']}>
            {matches.rows.map(voucher => <tr key={voucher.id}>
              <th scope="row"><button type="button" id={'candidate-' + voucher.id} className="book-link"
                onClick={() => done(voucher.id)}>#{voucher.id}</button></th>
              <td>{voucher.kind}</td><td>{voucher.memo || '—'}</td>
            </tr>)}
          </Table>}
          <Pagination page={page} next={matches.hasNext} change={page => open({ ...view, confirmation: { ...confirmation, page } }, true)} />
          <fieldset disabled={busy}>
            <label htmlFor="statement-action">Review action</label>
            <select id="statement-action" name="choice" defaultValue="" required>
              <option value="">Choose an action</option>
              {matches.rows.map(voucher => <option key={voucher.id} value={voucher.id}>Match voucher #{voucher.id}</option>)}
              <option value="post">Post a new voucher</option>
            </select>
          </fieldset>
          <EntryActions label="Confirm statement row" {...{ busy, error, shortcut, cancel }} />
        </form>}
      </>}
  </>;
}

export function Bank({ workspace, firm, view, savedFocus, shortcut, open, back, showVoucher }: {
  workspace: WorkspaceKind; firm: Firm; view: BankView; savedFocus?: string; shortcut: string;
  open: (view: BankView, replace?: boolean) => void; back: () => void; showVoucher: ShowVoucher;
}) {
  const { result, message } = useModuleReport(workspace, firm.id, view, savedFocus, load);
  const context = { workspace, firmId: firm.id, shortcut, cancel: back };
  function body() {
    if (!result) return message;
    const ledger = (accountId: number, replace = false) => open({ name: 'ledger', accountId }, replace);
    if (view.name === 'directory') return <NamedDirectory kind="bank" accounts={result.accounts} {...{ firm, view, open }}
      select={ledger} />;
    const bank = 'accountId' in view ? result.accounts.find(account => account.id === view.accountId) : undefined;
    const active = !firm.archived && !bank?.archived;
    if (view.name === 'record' && active && (view.accountId === undefined || bank)) {
      return <NamedAccountForm {...context} kind="bank" account={bank} done={saved => ledger(saved.id, true)} />;
    }
    if (!bank) return <p>Choose a bank account in this firm.</p>;
    const accountId = bank.id;
    if (view.name === 'remove' && active) return <RemoveNamedAccount {...context} kind="bank" account={bank}
      done={archived => open({ name: 'directory', notice: archived ? 'Bank account archived.' : 'Bank account deleted.' }, true)} />;
    if (view.name === 'manual' && active && result.chart) return <ManualBankEntry {...context} bank={bank} chart={result.chart}
      requestId={view.requestId} done={showVoucher} />;
    if (view.name === 'import' && active) return <StatementImportForm {...context} bank={bank}
      done={(added, existing) => open({ name: 'statement', accountId,
        notice: `Added ${added} pending rows. ${existing} already imported.` }, true)} />;
    if (view.name === 'review' && result.chart && result.row) return <ReviewStatement {...context}
      bank={firm.archived ? { ...bank, archived: 1 } : bank} chart={result.chart}
      row={result.row} matches={result.matches} {...{ view, open }} done={showVoucher} />;
    if (view.name !== 'ledger' && view.name !== 'statement') return <p>This account is unavailable for new entries.</p>;
    const heading = <>{moduleTitle(bank.name)}
      {(bank.number || bank.role) && <p>{[bank.number, bank.role].filter(Boolean).join(' · ')}</p>}
      {!!bank.archived && <p>Archived bank account</p>}
      <div className="book-tabs" role="group" aria-label="Bank views">
        <button id="bank-ledger" className="secondary" aria-pressed={view.name === 'ledger'}
          onClick={() => { if (view.name !== 'ledger') ledger(accountId); }}>Bank book</button>
        <button id="bank-statement" className="secondary" aria-pressed={view.name === 'statement'}
          onClick={() => { if (view.name !== 'statement') open({ name: 'statement', accountId }); }}>Statement rows</button>
      </div></>;
    const page = view.page ?? 0;
    if (view.name === 'statement' && result.statement) {
      const { rows, hasNext } = result.statement;
      return <>{heading}
        <div className="book-tabs">
          {active && <button className="action" id="import-statement" onClick={() => open({ name: 'import', accountId })}>Import statement</button>}
          <button className="secondary" id="pending-statements" aria-pressed={!!view.pending}
            onClick={() => open({ name: 'statement', accountId, pending: !view.pending }, true)}>Pending only</button>
        </div>
        {view.notice && <p role="status">{view.notice}</p>}
        {rows.length === 0 ? <p>No {view.pending ? 'pending ' : ''}statement rows.</p> :
          <Table heading="Statement rows" headings={['Date', 'Description', 'Reference', 'Amount', 'Review']}>
            {rows.map(row => <tr key={row.id}>
              <td>{row.day}</td><td>{row.description || '—'}</td><td>{row.reference || '—'}</td>
              <td className="book-amount">{money(row.value)}</td>
              <td>{row.voucherId !== null ? <button id={'statement-row-' + row.id} className="book-link"
                onClick={() => showVoucher(row.voucherId!)}>Voucher #{row.voucherId}</button>
                : <button id={'statement-row-' + row.id} className="book-link" onClick={() => open({
                  name: 'review', accountId, rowId: row.id, requestId: crypto.randomUUID(),
                })}>Review row {row.rowNumber}</button>}</td>
            </tr>)}
          </Table>}
        <Pagination page={page} next={hasNext} change={page => open({ ...view, page }, true)} />
      </>;
    }
    if (view.name !== 'ledger' || !result.ledger || !result.chart) return null;
    return <>{heading}
      {active && <div className="book-tabs">
        <button className="action" id="new-bank-entry" onClick={() => open({
          name: 'manual', accountId, requestId: crypto.randomUUID(),
        })}>New bank entry</button>
        <button className="secondary" id="edit-bank" onClick={() => open({ name: 'record', accountId })}>Edit bank account</button>
        <button className="secondary" id="remove-bank" onClick={() => open({ name: 'remove', accountId })}>Remove bank account</button>
      </div>}
      <Filters period={view} apply={period => open({ name: 'ledger', accountId, ...period }, true)} />
      <dl className="balances book-balances">
        <div><dt>Opening balance</dt><dd>{money(result.ledger.opening)}</dd></div>
        <div><dt>Closing balance</dt><dd>{money(result.ledger.closing)}</dd></div>
      </dl>
      <MovementTable name="Bank book" ledger={result.ledger} sites={result.chart.sites} {...{ showVoucher, page }}
        change={page => open({ ...view, page }, true)} />
    </>;
  }
  return <section className="books" aria-label={firm.name + ' bank'}>{body()}</section>;
}
