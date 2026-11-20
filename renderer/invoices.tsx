import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { invoiceAmounts, invoiceTotals, TAX_COMPONENTS } from '../desktop/invoices';
import type { InvoiceDocument, InvoiceEntry, InvoiceItem, InvoiceQuery, InvoiceSide, IssuedInvoice } from '../desktop/invoices';
import type { Account } from '../desktop/books';
import type { Firm, WorkspaceKind } from '../desktop/workspace';
import { EntryActions, entryKeys, money, parseAmount, today, useEntry } from './book-entry';
import type { EntryContext } from './book-entry';
import { Filters, Pagination, Table } from './books';
import { moduleTitle, useModuleReport } from './named-books';
import { OutputActions } from './output';

type InvoiceDraft = InvoiceEntry & { bookingId: number };
type DraftBox = { current: InvoiceDraft };
export type InvoiceView =
  | { name: 'register'; query: InvoiceQuery; cashbookId?: number }
  | { name: 'draft'; draft: DraftBox }
  | { name: 'issued'; voucherId: number; saved?: boolean }
  | { name: 'payment'; voucherId: number; requestId: string; accountId?: number };
export const INVOICE_REGISTER: InvoiceView = { name: 'register', query: {} };

const newItem = (): InvoiceItem => ({ description: '', quantity: '', unit: '', rate: '', gst: '0' });
const noteTypes = ['Credit note', 'Debit note'] as const;

function newDraft(side: InvoiceSide, firmId: number, document: InvoiceDocument = 'Invoice',
  original?: IssuedInvoice): InvoiceView {
  const invoice = original?.snapshot;
  const date = today();
  return { name: 'draft', draft: { current: {
    side, document, bookingId: firmId, issuerId: invoice?.issuer.id ?? firmId, originalId: original?.voucherId,
    requestId: crypto.randomUUID(), number: '', day: invoice && invoice.day > date ? invoice.day : date, party: invoice?.party ?? '',
    partyAddress: invoice?.partyAddress ?? '', partyGstin: invoice?.partyGstin ?? '', consumer: invoice?.consumer ?? '',
    supply: invoice?.supply ?? '', items: [newItem()], taxMode: invoice?.taxMode ?? 'split', allocationMode: 'amount',
    allocations: [],
  } } };
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div><label htmlFor={id}>{label}</label>{children}</div>;
}

function InvoiceForm({ workspace, shortcut, cancel, draft, firms, savedFocus, done }: Omit<EntryContext, 'firmId'> & {
  draft: DraftBox; firms: Firm[]; savedFocus?: string; done: (invoice: IssuedInvoice, firmId: number) => void;
}) {
  const [value, setValue] = useState(draft.current);
  const first = useRef<HTMLInputElement>(null);
  const nextItem = useRef<number>(null);
  const active = firms.filter(firm => !firm.archived);
  const edit = (update: Partial<InvoiceDraft>) => {
    draft.current = { ...value, ...update };
    setValue(draft.current);
  };
  const updateItem = (index: number, update: Partial<InvoiceItem>) =>
    edit({ items: value.items.map((item, i) => i === index ? { ...item, ...update } : item) });
  const updateShare = (index: number, update: Partial<InvoiceDraft['allocations'][number]>) =>
    edit({ allocations: value.allocations.map((share, i) => i === index ? { ...share, ...update } : share) });
  const { busy, error, save } = useEntry(() => {
    const { bookingId, ...entry } = value;
    return window.workspaces.postInvoice(workspace, bookingId, entry);
  }, invoice => done(invoice, invoice.snapshot.booking.id));
  useLayoutEffect(() => { (document.getElementById(savedFocus ?? '') ?? first.current)?.focus(); }, [savedFocus]);
  useLayoutEffect(() => {
    if (nextItem.current === null) return;
    document.getElementById('item-description-' + nextItem.current)?.focus();
    nextItem.current = null;
  }, [value.items.length]);
  const totals = (() => {
    try { return invoiceTotals(value.items.map(item => invoiceAmounts(item, value.taxMode))); }
    catch { return undefined; }
  })();
  const plain = (key: 'number' | 'day' | 'party' | 'partyGstin' | 'supply', label: string,
    limit: number, required = false) => {
    const id = 'invoice-' + key;
    return <Field id={id} label={label}><input id={id} ref={key === 'number' ? first : undefined}
      type={key === 'day' ? 'date' : 'text'} maxLength={limit} required={required} value={value[key]}
      readOnly={key === 'party' && value.originalId !== undefined}
      onChange={event => edit({ [key]: event.target.value })} /></Field>;
  };
  const title = value.document === 'Invoice' ? value.side + ' invoice' : value.document + ' · ' + value.side;
  return <form id="invoice-form" className="panel settings book-form invoice-entry" onSubmit={save}
    onKeyDown={event => entryKeys(event, cancel, busy)}>
    <h2>{title}</h2>
    <p className="entry-hint"><kbd>Enter</kbd> next field · <kbd>Shift+Tab</kbd> previous · <kbd>Esc</kbd> back</p>
    <fieldset disabled={busy} className="invoice-entry-fields">
      <div className="book-fields">
        {plain('number', 'Invoice or note number', 80, true)}
        {plain('day', 'Invoice date', 10, true)}
      </div>
      <Field id="invoice-issuer" label="Issuer">
        <select id="invoice-issuer" value={value.issuerId} required disabled={value.originalId !== undefined}
          onChange={event => edit({ issuerId: Number(event.target.value) })}>
          {active.map(firm => <option key={firm.id} value={firm.id}>{firm.name}</option>)}
        </select>
      </Field>
      {plain('party', value.side === 'Sale' ? 'Customer' : 'Supplier', 180, true)}
      <div className="book-fields">
        <Field id="invoice-party-address" label="Party address"><textarea data-advance id="invoice-party-address" rows={2} maxLength={1000}
          value={value.partyAddress} onChange={event => edit({ partyAddress: event.target.value })} /></Field>
        {plain('partyGstin', 'Party GSTIN', 32)}
      </div>
      <Field id="invoice-consumer" label="Consumer details"><textarea data-advance id="invoice-consumer" rows={2} maxLength={1000}
        value={value.consumer} onChange={event => edit({ consumer: event.target.value })} /></Field>
      {value.items.map((item, index) => <fieldset key={index} className="posting-row">
        <legend>Item {index + 1}</legend>
        <Field id={'item-description-' + index} label="Description"><input id={'item-description-' + index} required maxLength={500}
          value={item.description} onChange={event => updateItem(index, { description: event.target.value })} /></Field>
        <div className="book-fields">
          {([['quantity', 'Quantity'], ['unit', 'Unit'], ['rate', 'Rate (₹)'], ['gst', 'GST (%)']] as const).map(([key, label]) => {
            const id = 'item-' + key + '-' + index;
            return <Field key={key} id={id} label={label}><input id={id} required maxLength={key === 'unit' ? 40 : 21}
              inputMode={key === 'unit' ? 'text' : 'decimal'} value={item[key]}
              onChange={event => updateItem(index, { [key]: event.target.value })} /></Field>;
          })}
        </div>
        {value.items.length > 1 && <button className="secondary" type="button"
          onClick={() => edit({ items: value.items.filter((_, i) => i !== index) })}>Remove item {index + 1}</button>}
      </fieldset>)}
      <button id="add-invoice-item" type="button" className="secondary" disabled={value.items.length >= 250}
        onClick={() => { nextItem.current = value.items.length; edit({ items: [...value.items, newItem()] }); }}>Add item</button>
      <div className="book-fields invoice-tax-fields">
        <Field id="invoice-tax" label="GST treatment">
          <select id="invoice-tax" value={value.taxMode} onChange={event => edit({ taxMode: event.target.value === 'igst' ? 'igst' : 'split' })}>
            <option value="split">CGST + SGST</option><option value="igst">IGST</option>
          </select>
        </Field>
        {plain('supply', 'Place of supply', 180)}
      </div>
      <div className="book-fields">
        <Field id="invoice-booking" label="Booking firm">
          <select id="invoice-booking" value={value.bookingId} disabled={value.originalId !== undefined} required
            onChange={event => edit({ bookingId: Number(event.target.value) })}>
            {active.map(firm => <option key={firm.id} value={firm.id}>{firm.name}</option>)}
          </select>
        </Field>
        <Field id="allocation-mode" label="Management allocation">
          <select id="allocation-mode" value={value.allocations.length ? value.allocationMode : ''}
            onChange={event => {
              const mode = event.target.value;
              edit(mode === '' ? { allocations: [] } : { allocationMode: mode === 'percent' ? 'percent' : 'amount',
                allocations: value.allocations.length ? value.allocations.map(share => ({ ...share, value: '' }))
                  : [{ firmId: value.bookingId, value: '' }] });
            }}>
            <option value="">100% to booking firm</option><option value="amount">By amount</option><option value="percent">By percentage</option>
          </select>
        </Field>
      </div>
      {value.allocations.map((share, index) => <fieldset className="posting-row" key={index}>
        <legend>Allocation {index + 1}</legend>
        <div className="book-fields">
          <Field id={'beneficiary-' + index} label="Beneficiary firm">
            <select id={'beneficiary-' + index} value={share.firmId} required
              onChange={event => updateShare(index, { firmId: Number(event.target.value) })}>
              <option value="">Choose firm</option>
              {active.map(firm => <option key={firm.id} value={firm.id}
                disabled={firm.id !== share.firmId && value.allocations.some(item => item.firmId === firm.id)}>{firm.name}</option>)}
            </select>
          </Field>
          <Field id={'share-' + index} label={value.allocationMode === 'percent' ? 'Share (%)' : 'Share (₹)'}>
            <input id={'share-' + index} inputMode="decimal" maxLength={21} required value={share.value}
              onChange={event => updateShare(index, { value: event.target.value })} />
          </Field>
        </div>
        <button type="button" className="secondary"
          onClick={() => edit({ allocations: value.allocations.filter((_, i) => i !== index) })}>Remove allocation {index + 1}</button>
      </fieldset>)}
      {!!value.allocations.length && <button className="secondary" type="button"
        disabled={value.allocations.length >= Math.min(active.length, 250)}
        onClick={() => edit({ allocations: [...value.allocations, { firmId: 0, value: '' }] })}>Add allocation</button>}
    </fieldset>
    <div className="invoice-sticky">
      <p>Pre-tax <strong>{totals ? money(totals.base) : '—'}</strong> · GST <strong>{totals ? money(totals.total - totals.base) : '—'}</strong>
        {' · '}Total <strong>{totals ? money(totals.total) : '—'}</strong></p>
      <EntryActions label={value.document === 'Invoice' ? 'Issue invoice' : 'Issue note'} {...{ busy, error, shortcut, cancel }} />
    </div>
  </form>;
}

function InvoicePaper({ invoice }: { invoice: IssuedInvoice }) {
  const { snapshot: s } = invoice;
  const taxes = s.taxMode === 'split' ? TAX_COMPONENTS.slice(0, 2) : TAX_COMPONENTS.slice(2);
  const heading = (s.document === 'Invoice' ? s.side + ' invoice' : s.document + ' · ' + s.side) + ' ' + s.number;
  return <article className="invoice-paper print-document" aria-label="Issued document">
    <h2 id="module-title" tabIndex={-1}>{heading}</h2>
    <p>{s.day}{s.supply && ' · Place of supply ' + s.supply}</p>
    {s.originalNumber && <p>Original invoice {s.originalNumber}</p>}
    <div className="invoice-parties">
      <section><h3>Issuer</h3><strong>{s.issuer.name}</strong>
        {s.issuer.owner && <div>{s.issuer.owner}</div>}<div className="address">{s.issuer.address}</div>
        {s.issuer.gstin && <div>GSTIN {s.issuer.gstin}</div>}</section>
      <section><h3>{s.side === 'Sale' ? 'Customer' : 'Supplier'}</h3>
        <strong>{s.party}</strong><div className="address">{s.partyAddress}</div>
        {s.partyGstin && <div>GSTIN {s.partyGstin}</div>}</section>
    </div>
    {s.consumer && <section><h3>Consumer</h3><div className="address">{s.consumer}</div></section>}
    <Table heading="Invoice line items"
      headings={['Description', 'Quantity', 'Unit', 'Rate (₹)', 'GST (%)', 'Pre-tax', ...taxes, 'Total']}
      footer={<tr><th scope="row" colSpan={5}>Total</th><td className="book-amount">{money(s.totals.base)}</td>
        {taxes.map(tax => <td key={tax} className="book-amount">{money(s.totals[tax])}</td>)}
        <td className="book-amount">{money(s.totals.total)}</td></tr>}>
      {s.items.map((item, index) => <tr key={index}><th scope="row">{item.description}</th>
        <td>{item.quantity}</td><td>{item.unit}</td><td>{item.rate}</td><td>{item.gst}</td>
        <td className="book-amount">{money(item.amounts.base)}</td>
        {taxes.map(tax => <td key={tax} className="book-amount">{money(item.amounts[tax])}</td>)}
        <td className="book-amount">{money(item.amounts.total)}</td></tr>)}
    </Table>
  </article>;
}

function settlementTitle(invoice: IssuedInvoice) {
  const purchase = invoice.snapshot.side === 'Purchase';
  if ((invoice.outstanding ?? 0) < 0) return purchase ? 'Receive supplier refund' : 'Refund customer credit';
  return purchase ? 'Apply bill payment' : 'Apply customer receipt';
}

function BillPaymentForm({ workspace, firmId, shortcut, cancel, invoice, accounts, requestId, accountId, done }: EntryContext & {
  invoice: IssuedInvoice; accounts: Account[]; requestId: string; accountId?: number; done: (id: number) => void;
}) {
  const { busy, error, save } = useEntry(data => window.workspaces.applyBillPayment(workspace, firmId, {
    requestId, invoiceId: invoice.voucherId, accountId: Number(data.get('account')), day: String(data.get('day')),
    memo: String(data.get('memo')), amount: parseAmount(data.get('amount')), refund: (invoice.outstanding ?? 0) < 0,
  }), voucher => done(voucher.id));
  const first = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => { first.current?.focus(); }, []);
  const title = settlementTitle(invoice);
  return <form className="panel settings book-form" id="invoice-form" onSubmit={save}
    onKeyDown={event => entryKeys(event, cancel, busy)}>
    <h2>{title} · {invoice.snapshot.number}</h2>
    <p>{invoice.snapshot.party} · Outstanding {money(invoice.outstanding ?? 0)}</p>
    <fieldset disabled={busy}>
      <label htmlFor="bill-cash">Cashbook or bank account</label>
      <select ref={first} id="bill-cash" name="account" required defaultValue={accountId ?? ''}>
        <option value="">Choose an account</option>
        {accounts.filter(account => !account.archived && (account.kind === 'cash' || account.kind === 'bank'))
          .map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select>
      <label htmlFor="bill-day">Voucher date</label>
      <input id="bill-day" name="day" required type="date" min={invoice.snapshot.day}
        defaultValue={today() < invoice.snapshot.day ? invoice.snapshot.day : today()} />
      <label htmlFor="bill-amount">Amount (₹)</label>
      <input id="bill-amount" name="amount" required inputMode="decimal" maxLength={17} />
      <label htmlFor="bill-memo">Narration</label>
      <input id="bill-memo" name="memo" maxLength={500} />
    </fieldset>
    <EntryActions label={title} {...{ busy, error, shortcut, cancel }} />
  </form>;
}

async function load(workspace: WorkspaceKind, firmId: number, view: InvoiceView) {
  const bridge = window.workspaces;
  switch (view.name) {
    case 'register': return { ...view, register: await bridge.getInvoices(workspace, firmId, view.query) };
    case 'issued': return { ...view, invoice: await bridge.getInvoice(workspace, firmId, view) };
    case 'payment': {
      const [invoice, chart] = await Promise.all([bridge.getInvoice(workspace, firmId, view), bridge.getChart(workspace, firmId)]);
      return { ...view, invoice, chart };
    }
    case 'draft': return view;
  }
}

export function Invoices({ workspace, firm, firms, view, savedFocus, shortcut, open, back, showVoucher }: {
  workspace: WorkspaceKind; firm: Firm; firms: Firm[]; view: InvoiceView; savedFocus?: string; shortcut: string;
  open: (view: InvoiceView, replace?: boolean, firmId?: number) => void;
  back: () => void; showVoucher: (voucherId: number, replace?: boolean) => void;
}) {
  const { result, message } = useModuleReport(workspace, firm.id, view, savedFocus, load);
  if (!result) return <section className="books">{message}</section>;
  const payment = (voucherId: number, accountId?: number) =>
    open({ name: 'payment', voucherId, requestId: crypto.randomUUID(), accountId });
  const context = { workspace, firmId: firm.id, shortcut, cancel: back };
  function body() {
    switch (result?.name) {
      case 'draft':
        return <InvoiceForm key={result.draft.current.requestId} {...context} draft={result.draft} firms={firms} savedFocus={savedFocus}
          done={(invoice, id) => open({ name: 'issued', voucherId: invoice.voucherId, saved: true }, true, id)} />;
      case 'payment':
        if (!result.invoice.outstanding || result.invoice.reversedById !== null || firm.archived) return <p>This bill has no outstanding balance to apply.</p>;
        return <BillPaymentForm key={result.requestId} {...context} invoice={result.invoice} accounts={result.chart.accounts}
          requestId={result.requestId} accountId={result.accountId} done={id => showVoucher(id, true)} />;
      case 'register': {
        const { register, query, cashbookId } = result;
        return <>
          <div className="book-heading">{moduleTitle(cashbookId ? 'Choose a supplier bill' : 'Issued invoices')}
            {!firm.archived && !cashbookId && <div className="form-actions">
              <button id="new-sale" className="action" onClick={() => open(newDraft('Sale', firm.id))}>New sale</button>
              <button id="new-purchase" className="action" onClick={() => open(newDraft('Purchase', firm.id))}>New purchase</button>
            </div>}
          </div>
          <p>Booking firm {firm.name}</p>
          <Filters key={JSON.stringify(query)} period={query}
            apply={period => open({ ...result, query: { ...period, payableOnly: query.payableOnly } }, true)} />
          {!register.rows.length ? <p>No invoices for these filters.</p> :
            <Table heading="Issued invoices" headings={['Number', 'Date', 'Type', 'Party', 'Total', 'Outstanding']}>
              {register.rows.map(row => <tr key={row.voucherId}>
                <th scope="row"><button id={'issued-' + row.voucherId} className="book-link" onClick={() => cashbookId
                  ? payment(row.voucherId, cashbookId) : open({ name: 'issued', voucherId: row.voucherId })}>{row.number}</button></th>
                <td>{row.day}</td><td>{row.document === 'Invoice' ? row.side : row.document}{row.reversedById !== null && ' · Reversed'}</td>
                <td>{row.party}</td><td className="book-amount">{money(row.amount)}</td>
                <td className="book-amount">{row.document === 'Invoice' ? money(row.outstanding) : '—'}</td>
              </tr>)}
            </Table>}
          <Pagination page={query.page ?? 0} next={register.hasNext} change={page => open({ ...result, query: { ...query, page } }, true)} />
        </>;
      }
      case 'issued': {
        const { invoice, saved } = result;
        const { snapshot, voucherId, reversedById, outstanding, activity } = invoice;
        return <>
          {saved && <p role="status">Issued copy saved.</p>}
          {reversedById !== null && <p>Reversed · <button className="book-link" id="invoice-reversal"
            onClick={() => showVoucher(reversedById)}>Voucher #{reversedById}</button></p>}
          <OutputActions title={snapshot.side + ' ' + snapshot.number} />
          <InvoicePaper invoice={invoice} />
          <div className="invoice-booking">
            <div className="book-heading"><h2>Booking firm · {snapshot.booking.name}</h2>
              <button id="invoice-voucher" className="secondary" onClick={() => showVoucher(voucherId)}>Open posting voucher</button>
            </div>
            {snapshot.originalId !== null && <button id="invoice-original" className="book-link"
              onClick={() => open({ name: 'issued', voucherId: snapshot.originalId! })}>Open original invoice</button>}
            <Table heading="Management allocation" headings={['Beneficiary', 'Pre-tax share']}>
              {snapshot.allocations.map(share => <tr key={share.firmId}><th scope="row">{share.firmName}</th>
                <td className="book-amount">{money(share.amount)}</td></tr>)}
            </Table>
            {outstanding !== null && <>
              <p>Outstanding <strong>{money(outstanding)}</strong></p>
              {!firm.archived && reversedById === null && <div className="form-actions">
                {outstanding !== 0 && <button id="apply-invoice-payment" className="action" onClick={() => payment(voucherId)}>
                  {settlementTitle(invoice)}</button>}
                {noteTypes.map(note => <button key={note} id={'create-' + note.split(' ')[0]} className="secondary"
                  onClick={() => open(newDraft(snapshot.side, firm.id, note, invoice))}>Create {note.toLowerCase()}</button>)}
              </div>}
              <Table heading="Bill activity" headings={['Voucher', 'Date', 'Type', 'Change to outstanding']}>
                {activity.map(row => <tr key={row.voucherId}><th scope="row"><button id={'bill-activity-' + row.voucherId}
                  className="book-link" onClick={() => showVoucher(row.voucherId)}>#{row.voucherId}</button></th>
                  <td>{row.day}</td><td>{row.kind}</td><td className="book-amount">{money(row.amount)}</td></tr>)}
              </Table>
            </>}
          </div>
        </>;
      }
    }
  }
  return <section className="books invoice-module">{body()}</section>;
}
