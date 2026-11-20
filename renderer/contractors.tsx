import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { PAGE_SIZE } from '../desktop/books';
import type { Chart, Contractor, ContractorDirectory, ContractorLedger, ContractorTotals, Site } from '../desktop/books';
import type { Firm, WorkspaceKind } from '../desktop/workspace';
import { accountLabels, EntryActions, entryKeys, errorMessage, money, parseAmount, today, useEntry } from './book-entry';
import type { EntryContext } from './book-entry';
import { Pagination, Table } from './books';

type Movement = 'Payment' | 'Receipt' | 'Settlement';
type LedgerView = {
  name: 'ledger'; accountId: number; bySite?: boolean; siteId?: number; page?: number; notice?: string;
};
type DirectoryView = { name: 'directory'; search: string; page?: number; notice?: string };
export type ContractorView = DirectoryView | LedgerView
  | { name: 'edit'; accountId: number | null }
  | { name: 'remove'; accountId: number }
  | { name: 'movement'; accountId: number; movement: Movement; requestId: string; siteId?: number };

export const CONTRACTOR_DIRECTORY: DirectoryView = { name: 'directory', search: '' };

const actions: Record<Movement, string> = {
  Payment: 'Pay contractor', Receipt: 'Receive money', Settlement: 'Record settlement',
};

function title(value: string) {
  return <h2 id="contractor-title" tabIndex={-1}>{value}</h2>;
}

function Directory({ view, directory, open, replace, archived }: {
  view: DirectoryView; directory: ContractorDirectory; open: (view: ContractorView) => void;
  replace: (view: ContractorView) => void; archived: boolean;
}) {
  const search = view.search.trim().toLowerCase();
  const page = view.page ?? 0;
  const names = new Map(directory.sites.map(site => [site.id, site.name]));
  const matches = directory.contractors.filter(contractor => contractor.name.toLowerCase().includes(search) ||
    contractor.siteIds.some(site => names.get(site)?.toLowerCase().includes(search)));
  const contractors = matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  function focusResult(event: KeyboardEvent, index: number) {
    const target = index < 0 ? 'contractor-search' : 'open-contractor-' + contractors[index]?.id;
    const button = document.getElementById(target);
    if (button) {
      event.preventDefault();
      button.focus();
    }
  }
  return <>
    <div className="book-heading">{title('Contractor directory')}
      {!archived && <button id="new-contractor" className="action" onClick={() => open({ name: 'edit', accountId: null })}>
        New contractor
      </button>}
    </div>
    {view.notice && <p role="status">{view.notice}</p>}
    <div className="book-filters">
      <div><label htmlFor="contractor-search">Search by contractor or site</label>
        <input id="contractor-search" type="search" value={view.search}
          onChange={event => replace({ name: 'directory', search: event.target.value })}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || (event.key === 'Enter' && !event.nativeEvent.isComposing)) focusResult(event, 0);
          }} />
      </div>
    </div>
    {contractors.length === 0 ? <p>No matching contractors.</p> :
      <Table heading="Contractor directory" headings={['Contractor', 'Assigned sites']}>
        {contractors.map((contractor, index) => <tr key={contractor.id}>
          <th scope="row"><button className="book-link" id={'open-contractor-' + contractor.id}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') focusResult(event, index + 1);
              if (event.key === 'ArrowUp') focusResult(event, index - 1);
            }}
            onClick={() => open({ name: 'ledger', accountId: contractor.id })}>{contractor.name}</button>
            {contractor.archived === 1 && ' (archived)'}</th>
          <td>{directory.sites.filter(site => contractor.siteIds.includes(site.id)).map(site => site.name).join(', ') || '—'}</td>
        </tr>)}
      </Table>}
    <Pagination page={page} next={(page + 1) * PAGE_SIZE < matches.length}
      change={page => replace({ ...view, page })} />
  </>;
}

function ContractorEntry({ contractor, sites, done, remove, ...entry }: EntryContext & {
  contractor?: Contractor; sites: Site[]; done: (accountId: number) => void; remove: (accountId: number) => void;
}) {
  const { workspace, firmId, cancel, shortcut } = entry;
  const { busy, error, save } = useEntry(data => window.workspaces.saveContractor(workspace, firmId, {
    id: contractor?.id ?? null, name: String(data.get('name')),
    siteIds: data.getAll('sites').map(Number),
    newSites: String(data.get('newSites')).split(',').map(name => name.trim()).filter(Boolean),
  }), account => done(account.id));
  const name = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { name.current?.focus(); }, []);
  return <form id="contractor-form" className="panel settings book-form" onSubmit={save} onKeyDown={event => entryKeys(event, cancel, busy)}>
    {title(contractor ? 'Edit contractor' : 'New contractor')}
    <fieldset disabled={busy}>
      <label htmlFor="contractor-name">Contractor name</label>
      <input ref={name} id="contractor-name" name="name" defaultValue={contractor?.name} required maxLength={180} />
      {sites.length > 0 && <fieldset className="posting-row">
        <legend>Assigned sites</legend>
        <div className="site-options">{sites.map(site => <label key={site.id}>
          <input type="checkbox" name="sites" value={site.id} defaultChecked={contractor?.siteIds.includes(site.id)} />{site.name}
        </label>)}</div>
      </fieldset>}
      <label htmlFor="contractor-new-sites">New sites (comma-separated)</label>
      <input id="contractor-new-sites" name="newSites" />
    </fieldset>
    <EntryActions label="Save contractor" {...{ busy, error, shortcut, cancel }} />
    {contractor && <button className="danger contractor-remove" type="button" id="remove-contractor" disabled={busy}
      onClick={() => remove(contractor.id)}>Remove contractor</button>}
  </form>;
}

function RemoveContractor({ contractor, workspace, firmId, cancel, done }: EntryContext & {
  contractor: Contractor; done: (archived: boolean) => void;
}) {
  const { busy, error, save } = useEntry(() => window.workspaces.removeContractor(workspace, firmId, { accountId: contractor.id }),
    ({ archived }) => done(archived));
  const keep = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { keep.current?.focus(); }, []);
  return <form className="panel settings removal" onSubmit={save} onKeyDown={event => entryKeys(event, cancel, busy)}>
    {title('Remove ' + contractor.name + '?')}
    <p>Contractors with posted vouchers are archived with their history. Unused contractors are deleted.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="form-actions">
      <button type="button" ref={keep} className="secondary" disabled={busy} onClick={cancel}>Keep contractor</button>
      <button type="submit" className="danger" disabled={busy}>Confirm removal</button>
    </div>
  </form>;
}

function MovementEntry({ view, contractor, chart, done, workspace, firmId, shortcut, cancel }: EntryContext & {
  view: Extract<ContractorView, { name: 'movement' }>; contractor: Contractor; chart: Chart; done: (voucherId: number) => void;
}) {
  const { movement, siteId, requestId } = view;
  const settlement = movement === 'Settlement';
  const sites = chart.sites.filter(site => contractor.siteIds.includes(site.id));
  const offsets = chart.accounts.filter(account => !account.archived && (settlement
    ? account.kind !== 'bank' && account.kind !== 'cash' && account.kind !== 'contractor'
    : account.kind === 'cash' || account.kind === 'bank'));
  const [rows, setRows] = useState([1]);
  const nextRow = useRef(2);
  const focusRow = useRef<number | undefined>(undefined);
  const date = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { date.current?.focus(); }, []);
  useLayoutEffect(() => {
    if (focusRow.current !== undefined) {
      document.getElementById('allocation-site-' + focusRow.current)?.focus();
      focusRow.current = undefined;
    }
  }, [rows]);

  const { busy, error, save } = useEntry(data => {
    const sign = movement === 'Payment' || data.get('direction') === 'reduce' ? 1 : -1;
    const lines = rows.map(row => ({
      accountId: contractor.id, siteId: Number(data.get('site-' + row)),
      value: sign * parseAmount(data.get('amount-' + row)),
    }));
    if (new Set(lines.map(line => line.siteId)).size !== lines.length) throw new Error('Use one allocation per site.');
    const offset = lines.reduce((sum, line) => sum - BigInt(line.value), 0n);
    if (offset > BigInt(Number.MAX_SAFE_INTEGER) || offset < -BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('The voucher total is too large.');
    }
    const memo = String(data.get('memo')).trim();
    if (settlement && !memo) throw new Error('Enter the settlement narration.');
    return window.workspaces.postVoucher(workspace, firmId, {
      requestId, day: String(data.get('day')), memo, kind: movement === 'Settlement' ? 'Journal' : movement,
      lines: [...lines, { accountId: Number(data.get('offset')), siteId: null, value: Number(offset) }],
    });
  }, voucher => done(voucher.id));

  const offsetLabel = settlement ? 'Offset account' : movement === 'Payment' ? 'Pay from' : 'Receive into';
  return <form id="contractor-form" className="panel settings book-form" onSubmit={save} onKeyDown={event => entryKeys(event, cancel, busy)}>
    {title(actions[movement] + ' · ' + contractor.name)}
    {offsets.length === 0 && <p>Create {settlement ? 'an offset account' : 'a bank or cash account'} in the chart of accounts first.</p>}
    <fieldset disabled={busy}>
      <label htmlFor="movement-date">Voucher date</label>
      <input id="movement-date" name="day" type="date" ref={date} required defaultValue={today()} />
      <label htmlFor="movement-offset">{offsetLabel}</label>
      <select id="movement-offset" name="offset" required defaultValue="">
        <option value="">Choose account</option>
        {offsets.map(account => <option key={account.id} value={account.id}>{account.name} · {accountLabels[account.kind]}</option>)}
      </select>
      {settlement && <>
        <label htmlFor="settlement-direction">Settlement direction</label>
        <select id="settlement-direction" name="direction">
          <option value="recognize">Recognize amount due</option><option value="reduce">Reduce amount due</option>
        </select>
      </>}
      <label htmlFor="movement-memo">Narration</label>
      <input id="movement-memo" name="memo" required={settlement} maxLength={500} />
      {rows.map((row, index) => <fieldset className="posting-row" key={row}>
        <legend>Allocation {index + 1}</legend>
        <div className="book-fields">
          <div><label htmlFor={'allocation-site-' + row}>Site</label>
            <select id={'allocation-site-' + row} name={'site-' + row} required
              defaultValue={index === 0 ? siteId ?? (sites.length === 1 ? sites[0].id : '') : ''}>
              <option value="">Choose site</option>
              {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
          </div>
          <div><label htmlFor={'allocation-amount-' + row}>Amount (₹)</label>
            <input id={'allocation-amount-' + row} name={'amount-' + row} inputMode="decimal" maxLength={17} required />
          </div>
        </div>
        {rows.length > 1 && <button type="button" className="secondary" aria-label={'Remove allocation ' + (index + 1)} onClick={() => {
          focusRow.current = rows[index + 1] ?? rows[index - 1];
          setRows(rows.filter(id => id !== row));
        }}>Remove allocation</button>}
      </fieldset>)}
      {rows.length < sites.length && <button type="button" className="secondary" id="add-site-split" onClick={() => {
        const row = nextRow.current++;
        focusRow.current = row;
        setRows([...rows, row]);
      }}>Add site split</button>}
    </fieldset>
    <EntryActions label={settlement ? 'Post settlement journal' : 'Post voucher'} {...{ busy, error, shortcut, cancel }} />
  </form>;
}

function Summary({ given, received, balance }: ContractorTotals) {
  return <dl className="balances">
    <div><dt>Money given</dt><dd>{money(given)}</dd></div>
    <div><dt>Money received</dt><dd>{money(received)}</dd></div>
    <div><dt>Net given</dt><dd>{money(given - received)}</dd></div>
    <div><dt>Ledger balance</dt><dd>{money(balance)}</dd></div>
  </dl>;
}

function LedgerView({ view, contractor, report, sites, archived, open, replace, showVoucher }: {
  view: LedgerView; contractor: Contractor; report: ContractorLedger; sites: Site[]; archived: boolean;
  open: (view: ContractorView) => void; replace: (view: ContractorView) => void; showVoucher: (id: number) => void;
}) {
  const { accountId, bySite, siteId, page = 0 } = view;
  const siteName = (id: number | null) => sites.find(site => site.id === id)?.name ?? 'No site';
  const totals = report.sites.filter(site => site.siteId === null);
  for (const site of sites) {
    const posted = report.sites.find(row => row.siteId === site.id);
    if (posted || contractor.siteIds.includes(site.id)) {
      totals.push(posted ?? { siteId: site.id, given: 0n, received: 0n, balance: 0n });
    }
  }
  return <>
    <div className="book-heading">{title(contractor.name + ' ledger')}
      {!archived && <button id="edit-contractor" className="secondary" onClick={() => open({ name: 'edit', accountId })}>
        Edit contractor
      </button>}
    </div>
    {view.notice && <p role="status">{view.notice}</p>}
    {archived && <p className="intro">Archived records</p>}
    <div className="book-tabs" role="group" aria-label="Contractor ledger views">
      <button className="secondary" id="contractor-chronological" aria-pressed={!bySite}
        onClick={() => { if (bySite) open({ name: 'ledger', accountId }); }}>Chronological</button>
      <button className="secondary" id="contractor-by-site" aria-pressed={!!bySite}
        onClick={() => { if (!bySite || siteId !== undefined) open({ name: 'ledger', accountId, bySite: true }); }}>By site</button>
    </div>
    {!archived && contractor.siteIds.length > 0 && <div className="book-tabs" role="group" aria-label="Contractor vouchers">
      {(Object.keys(actions) as Movement[]).map(movement => <button key={movement} className="action"
        id={'contractor-action-' + movement} onClick={() => open({
          name: 'movement', accountId, movement, requestId: crypto.randomUUID(),
          siteId: siteId !== undefined && contractor.siteIds.includes(siteId) ? siteId : undefined,
        })}>{actions[movement]}</button>)}
    </div>}
    {siteId !== undefined && <h3>{siteName(siteId)} ledger</h3>}
    <Summary {...report.money} />
    {bySite && siteId === undefined ? <Table heading="Contractor sites" headings={['Site', 'Money given', 'Money received', 'Net given', 'Ledger balance']}>
      {totals.map(site => <tr key={site.siteId ?? 'none'}>
        <th scope="row">{site.siteId === null ? 'No site' : <button id={'contractor-site-' + site.siteId} className="book-link"
          onClick={() => open({ name: 'ledger', accountId, bySite: true, siteId: site.siteId! })}>{siteName(site.siteId)}</button>}</th>
        <td className="book-amount">{money(site.given)}</td>
        <td className="book-amount">{money(site.received)}</td>
        <td className="book-amount">{money(site.given - site.received)}</td>
        <td className="book-amount">{money(site.balance)}</td>
      </tr>)}
    </Table> : <>
      {report.rows.length === 0 ? <p>No postings in this ledger.</p> :
        <Table heading="Contractor transactions" headings={['Voucher', 'Date', 'Site', 'Method', 'Money given', 'Money received', 'Running balance']}>
          {report.rows.map(row => <tr key={row.lineId}>
            <th scope="row"><button className="book-link" id={'contractor-line-' + row.lineId}
              onClick={() => showVoucher(row.voucherId)}>#{row.voucherId}</button>
              <small className="voucher-narration">{row.memo || row.kind}</small></th>
            <td>{row.day}</td><td>{siteName(row.siteId)}</td><td>{row.method}</td>
            <td className="book-amount">{row.given ? money(row.given) : '—'}</td>
            <td className="book-amount">{row.received ? money(row.received) : '—'}</td>
            <td className="book-amount">{money(row.running)}</td>
          </tr>)}
        </Table>}
      <Pagination page={page} next={report.hasNext} change={page => replace({ ...view, page })} />
    </>}
  </>;
}

async function load(workspace: WorkspaceKind, firmId: number, view: ContractorView) {
  const bridge = window.workspaces;
  const directory = bridge.getContractors(workspace, firmId);
  switch (view.name) {
    case 'ledger': {
      const [records, report] = await Promise.all([directory, bridge.getContractorLedger(workspace, firmId, {
        accountId: view.accountId, siteId: view.siteId, page: view.page,
      })]);
      return { ...view, directory: records, report };
    }
    case 'movement': {
      const [records, chart] = await Promise.all([directory, bridge.getChart(workspace, firmId)]);
      return { ...view, directory: records, chart };
    }
    default: return { ...view, directory: await directory };
  }
}

type LoadState = { view: ContractorView } & ({ result: Awaited<ReturnType<typeof load>> } | { error: string });

export function Contractors({ workspace, firm, view, savedFocus, shortcut, open, replace, back, showVoucher }: {
  workspace: WorkspaceKind; firm: Firm; view: ContractorView; savedFocus?: string; shortcut: string;
  open: (view: ContractorView) => void; replace: (view: ContractorView) => void; back: () => void;
  showVoucher: (id: number, posted?: boolean) => void;
}) {
  const [state, setState] = useState<LoadState>();
  const [attempt, setAttempt] = useState(0);
  const request = view.name === 'directory' ? CONTRACTOR_DIRECTORY : view;
  const snapshot = state?.view === request ? state : undefined;

  useEffect(() => {
    let current = true;
    load(workspace, firm.id, request).then(result => {
      if (current) setState({ view: request, result });
    }, error => {
      if (current) setState({ view: request, error: errorMessage(error) });
    });
    return () => { current = false; };
  }, [workspace, firm.id, request, attempt]);

  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active !== document.body && active?.id !== 'page-title' && active?.id !== savedFocus) return;
    if (snapshot && 'result' in snapshot) {
      (document.getElementById(savedFocus ?? 'contractor-title') ?? document.getElementById('contractor-title'))?.focus();
    }
  }, [snapshot, savedFocus]);

  function body() {
    if (!snapshot) return <p role="status">Loading contractors…</p>;
    if ('error' in snapshot) return <>
      <p className="error" role="alert">{snapshot.error}</p>
      <button className="secondary" onClick={() => { setState(undefined); setAttempt(value => value + 1); }}>Retry</button>
    </>;
    const screen = snapshot.result;
    if (screen.name === 'directory' && view.name === 'directory') {
      return <Directory {...{ view, open, replace }} archived={firm.archived} directory={screen.directory} />;
    }
    if (screen.name === 'directory') return null;
    const { directory } = screen;
    const contractor = directory.contractors.find(account => account.id === screen.accountId);
    const archived = firm.archived || contractor?.archived === 1;
    const context = { workspace, firmId: firm.id, shortcut, cancel: back };
    if (screen.name === 'edit' && screen.accountId === null && !archived) {
      return <ContractorEntry {...context} sites={directory.sites} done={saved} remove={() => {}} />;
    }
    if (!contractor) return <p>That contractor is no longer available.</p>;
    if (screen.name === 'ledger') {
      return <LedgerView {...{ contractor, archived, open, replace, showVoucher }} view={screen} report={screen.report} sites={directory.sites} />;
    }
    if (archived) return <p>This contractor is archived.</p>;
    switch (screen.name) {
      case 'edit': return <ContractorEntry {...context} contractor={contractor} sites={directory.sites}
        done={saved} remove={accountId => open({ name: 'remove', accountId })} />;
      case 'remove': return <RemoveContractor {...context} contractor={contractor} done={archived => replace({
        ...CONTRACTOR_DIRECTORY, notice: archived ? 'Contractor archived. Its ledger is still available.' : 'Contractor deleted.',
      })} />;
      case 'movement': return <MovementEntry {...context} contractor={contractor} view={screen} chart={screen.chart}
        done={id => showVoucher(id, true)} />;
    }

    function saved(accountId: number) {
      replace({ name: 'ledger', accountId, notice: 'Contractor saved.' });
    }
  }
  return <section className="books" aria-label={firm.name + ' contractors'}>{body()}</section>;
}
