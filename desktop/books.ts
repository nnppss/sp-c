import type { WorkspaceKind } from './workspace';

export const ACCOUNT_KINDS = ['asset', 'liability', 'equity', 'income', 'expense', 'bank', 'cash', 'party', 'contractor', 'employee'] as const;
export const VOUCHER_KINDS = ['Opening balance', 'Payment', 'Receipt', 'Contra', 'Journal'] as const;
export const PAGE_SIZE = 25;

export type AccountKind = typeof ACCOUNT_KINDS[number];
export type VoucherKind = typeof VOUCHER_KINDS[number];
export type Account = { id: number; name: string; kind: AccountKind; archived: number; system: string | null };
export type Site = { id: number; name: string };
export type Chart = { accounts: Account[]; sites: Site[] };
export type Contractor = Account & { siteIds: number[] };
export type ContractorDirectory = { contractors: Contractor[]; sites: Site[] };
export type ContractorDetails = { id: number | null; name: string; siteIds: number[]; newSites: string[] };
export type Line = { accountId: number; siteId: number | null; value: number };
export type Voucher = {
  id: number; day: string; kind: string; memo: string; amount: number;
  reversesId: number | null; reversedById: number | null;
};
export type VoucherDetail = Voucher & { lines: Line[] };
export type PostVoucher = {
  requestId: string; day: string; memo: string;
} & ({ kind: 'Opening balance'; accountId: number; value: number }
  | { kind: Exclude<VoucherKind, 'Opening balance'>; lines: Line[] });
export type ReverseVoucher = { requestId: string; day: string; memo: string; voucherId: number };
export type Period = { from?: string; to?: string };
export type DayBookQuery = Period & { page?: number };
export type LedgerQuery = DayBookQuery & { accountId: number; siteId?: number };
export type Paged<Row> = { rows: Row[]; hasNext: boolean };
export type Ledger = Paged<{
  lineId: number; voucherId: number; day: string; kind: string; memo: string;
  siteId: number | null; value: number; running: bigint;
}> & { opening: bigint; closing: bigint };
export type ContractorTotals = { given: bigint; received: bigint; balance: bigint };
export type ContractorLedger = Omit<Ledger, 'rows'> & {
  rows: (Ledger['rows'][number] & { method: string; given: number; received: number })[];
  money: ContractorTotals;
  sites: (ContractorTotals & { siteId: number | null })[];
};
export type TrialBalance = { rows: (Account & { balance: bigint })[]; debit: bigint; credit: bigint };

type BookOperations = {
  getChart: [undefined, Chart];
  createAccount: [{ name: string; kind: AccountKind }, Account];
  getContractors: [undefined, ContractorDirectory];
  saveContractor: [ContractorDetails, Account];
  removeContractor: [{ accountId: number }, { archived: boolean }];
  getContractorLedger: [LedgerQuery, ContractorLedger];
  postVoucher: [PostVoucher, VoucherDetail];
  reverseVoucher: [ReverseVoucher, VoucherDetail];
  getVoucher: [{ voucherId: number }, VoucherDetail];
  getDayBook: [DayBookQuery, Paged<Voucher>];
  getLedger: [LedgerQuery, Ledger];
  getTrialBalance: [{ to?: string }, TrialBalance];
};

export const BOOK_OPERATIONS = [
  'getChart', 'createAccount', 'getContractors', 'saveContractor', 'removeContractor', 'getContractorLedger',
  'postVoucher', 'reverseVoucher', 'getVoucher', 'getDayBook', 'getLedger', 'getTrialBalance',
] as const satisfies readonly (keyof BookOperations)[];

export type BookOperation = keyof BookOperations;
export type BookResult = BookOperations[BookOperation][1];
export type BookCommand = { operation: BookOperation; kind: WorkspaceKind; firmId: unknown; input: unknown };
export type BooksBridge = {
  [K in BookOperation]: (
    kind: WorkspaceKind, firmId: number, ...input: BookOperations[K][0] extends undefined ? [] : [BookOperations[K][0]]
  ) => Promise<BookOperations[K][1]>;
};
