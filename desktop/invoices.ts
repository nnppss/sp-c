import type { FirmDetails } from './workspace';
import type { DayBookQuery } from './books';

export const INVOICE_SIDES = ['Sale', 'Purchase'] as const;
export const TAX_COMPONENTS = ['CGST', 'SGST', 'IGST'] as const;

export type InvoiceSide = typeof INVOICE_SIDES[number];
export type InvoiceDocument = 'Invoice' | 'Credit note' | 'Debit note';
export type TaxMode = 'split' | 'igst';
export type InvoiceItem = { description: string; quantity: string; unit: string; rate: string; gst: string };
export type TaxAmounts = Record<typeof TAX_COMPONENTS[number], number>;
export type InvoiceAmounts = TaxAmounts & { base: number; total: number };
type Issuer = FirmDetails & { id: number };
export type Allocation = { firmId: number; firmName: string; amount: number };
export type InvoiceSnapshot = {
  side: InvoiceSide; document: InvoiceDocument; originalId: number | null; originalNumber: string | null;
  number: string; day: string; issuer: Issuer; booking: { id: number; name: string };
  party: string; partyAddress: string; partyGstin: string; consumer: string; supply: string;
  taxMode: TaxMode; items: (InvoiceItem & { amounts: InvoiceAmounts })[]; totals: InvoiceAmounts;
  allocations: Allocation[];
};
export type InvoiceEntry = Pick<InvoiceSnapshot, 'side' | 'document' | 'number' | 'day' | 'party' | 'partyAddress'
  | 'partyGstin' | 'consumer' | 'supply' | 'taxMode'> & {
  requestId: string; originalId?: number; issuerId: number; items: InvoiceItem[];
  allocationMode: 'amount' | 'percent'; allocations: { firmId: number; value: string }[];
};
export type InvoiceQuery = DayBookQuery & { payableOnly?: boolean };
export type InvoiceRow = Pick<InvoiceSnapshot, 'number' | 'day' | 'side' | 'document' | 'party'> & {
  voucherId: number; amount: number; outstanding: number; reversedById: number | null;
};
export type BillActivity = { voucherId: number; day: string; kind: string; amount: number };
export type IssuedInvoice = { voucherId: number; snapshot: InvoiceSnapshot; reversedById: number | null;
  outstanding: number | null; activity: BillActivity[] };
export type BillPayment = {
  requestId: string; invoiceId: number; accountId: number; day: string; memo: string; amount: number; refund?: boolean;
};

const SCALE = 1_000_000n;

export function decimal(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{1,14}(?:\.\d{1,6})?$/.test(value)) {
    throw new Error(label + ' must be a decimal with up to six fractional places.');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
}

export function safeNumber(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('The amount is too large.');
  }
  return Number(value);
}

const round = (value: bigint, divisor: bigint) => (value + divisor / 2n) / divisor;

export function invoiceAmounts(item: InvoiceItem, mode: TaxMode): InvoiceAmounts {
  const quantity = decimal(item.quantity, 'Quantity');
  const rate = decimal(item.rate, 'Rate');
  const gst = decimal(item.gst, 'GST');
  if (quantity === 0n || rate === 0n) throw new Error('Enter a positive quantity and rate.');
  if (gst > 100n * SCALE) throw new Error('GST must be between 0 and 100%.');
  const base = round(quantity * rate * 100n, SCALE * SCALE);
  if (base === 0n) throw new Error('The line value rounds to zero paise.');
  const gstDivisor = (mode === 'split' ? 200n : 100n) * SCALE;
  const tax = round(base * gst, gstDivisor);
  return { base: safeNumber(base), CGST: mode === 'split' ? safeNumber(tax) : 0, SGST: mode === 'split' ? safeNumber(tax) : 0,
    IGST: mode === 'igst' ? safeNumber(tax) : 0, total: safeNumber(base + (mode === 'split' ? 2n * tax : tax)) };
}

export function invoiceTotals(items: InvoiceAmounts[]): InvoiceAmounts {
  return items.reduce((sum, item) => ({
    base: safeNumber(BigInt(sum.base) + BigInt(item.base)),
    CGST: safeNumber(BigInt(sum.CGST) + BigInt(item.CGST)),
    SGST: safeNumber(BigInt(sum.SGST) + BigInt(item.SGST)),
    IGST: safeNumber(BigInt(sum.IGST) + BigInt(item.IGST)),
    total: safeNumber(BigInt(sum.total) + BigInt(item.total)),
  }), { base: 0, CGST: 0, SGST: 0, IGST: 0, total: 0 });
}

export function allocationAmounts(base: number, mode: InvoiceEntry['allocationMode'], values: string[]) {
  const amounts = values.map(value => decimal(value, mode === 'percent' ? 'Allocation percentage' : 'Allocation amount'));
  const denominator = mode === 'percent' ? 100n * SCALE : BigInt(base) * (SCALE / 100n);
  if (amounts.some(value => value === 0n || (mode === 'amount' && value % (SCALE / 100n) !== 0n)) ||
      amounts.reduce((sum, value) => sum + value, 0n) !== denominator) {
    throw new Error(mode === 'percent' ? 'Enter positive allocations that total 100%.'
      : 'Enter positive allocations in whole paise that total the pre-tax value.');
  }
  // Round cumulative shares so the last share absorbs remainders and the sum stays exact.
  let running = 0n;
  let assigned = 0n;
  const shares = amounts.map(value => {
    running += value;
    const total = round(BigInt(base) * running, denominator);
    const share = total - assigned;
    assigned = total;
    return safeNumber(share);
  });
  if (shares.some(value => value === 0)) throw new Error('Each allocation must receive at least one paise.');
  return shares;
}

export function invoiceDirection(side: InvoiceSide, document: InvoiceDocument) {
  return document === 'Invoice' || (side === 'Sale' ? document === 'Debit note' : document === 'Credit note') ? 1 : -1;
}
