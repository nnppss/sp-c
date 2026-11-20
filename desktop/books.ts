import type { BillPayment, InvoiceEntry, InvoiceQuery, InvoiceRow, IssuedInvoice } from './invoices';
import type { Report, ReportQuery } from './report-model';
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
export type Cashbook = Pick<Account, 'id' | 'name' | 'archived'> & {
  custodian: string; employeeId: number | null; openedOn: string; openingCash: number;
};
type Custodian = { custodian: string; employeeId?: number };
export type NewCashbook = Pick<Cashbook, 'name' | 'openedOn' | 'openingCash'> & Custodian & { requestId: string };
export type NamedKind = 'employee' | 'bank';
export type NamedAccount = Account & { role: string; number: string };
export type NamedAccountDetails = Pick<NamedAccount, 'name' | 'role' | 'number'> & { id: number | null; kind: NamedKind };
export const EMPLOYEE_ACTIONS = ['Salary earned', 'Salary payment', 'Salary advance', 'Apply advance',
  'Advance repayment', 'Reimbursement', 'Manual adjustment'] as const;
export type EmployeeAction = typeof EMPLOYEE_ACTIONS[number];
export type EmployeeEntry = {
  accountId: number; action: EmployeeAction; requestId: string; day: string; memo: string; amount: number;
  offsetId?: number; fundingId?: number; reducePayable?: boolean;
};
export const STATEMENT_FILE_LIMIT = 8 * 1024 * 1024;
export type StatementFile = { filename: string; bytes: ArrayBuffer; sheet?: string };
export type StatementPreview = { sheet: string; sheets: string[]; header: string[]; rows: string[][]; count: number };
export type StatementMapping = { date: number; description: number; reference?: number } &
  ({ amount: number } | { debit: number; credit: number });
export type StatementImport = StatementFile & { accountId: number; mapping: StatementMapping };
export type StatementRow = {
  id: number; day: string; description: string; reference: string; value: number; voucherId: number | null;
  filename: string; sheet: string; rowNumber: number;
};
type BankDirection = { accountId: number; siteId: number | null };
export type BankEntry = BankDirection & { bankId: number; requestId: string; day: string; memo: string; value: number };
export type StatementReview = { bankId: number; rowId: number };
export type StatementConfirmation = StatementReview & BankDirection & { page?: number };
type Payee = { kind: 'Person'; name: string } | { kind: 'Firm'; firmId: number };
export type VoucherPayee = Extract<Payee, { kind: 'Person' }> |
  (Extract<Payee, { kind: 'Firm' }> & { name: string; owner: string });
export type Line = { accountId: number; siteId: number | null; value: number };
export type Voucher = {
  id: number; day: string; kind: string; memo: string; amount: number;
  reversesId: number | null; reversedById: number | null;
};
export type VoucherDetail = Voucher & { lines: Line[]; payee: VoucherPayee | null; employee?: { id: number; name: string }; invoiceId?: number };
export type PostVoucher = {
  requestId: string; day: string; memo: string;
} & ({ kind: 'Opening balance'; accountId: number; value: number }
  | { kind: Exclude<VoucherKind, 'Opening balance'>; lines: Line[]; payee?: Payee });
export type ReverseVoucher = { requestId: string; day: string; memo: string; voucherId: number };
export type Period = { from?: string; to?: string };
export type DayBookQuery = Period & { page?: number };
export type LedgerQuery = DayBookQuery & { accountId: number; siteId?: number };
export type Paged<Row> = { rows: Row[]; hasNext: boolean };
export type Ledger = Paged<{
  lineId: number; voucherId: number; day: string; kind: string; memo: string;
  siteId: number | null; value: number; running: bigint;
}> & { opening: bigint; closing: bigint };
export type EmployeeLedger = { personal: Omit<Ledger, 'rows'> & {
  rows: (Ledger['rows'][number] & { reimbursement?: number })[];
}; advances: Ledger | null };
export type ContractorTotals = { given: bigint; received: bigint; balance: bigint };
export type ContractorLedger = Omit<Ledger, 'rows'> & {
  rows: (Ledger['rows'][number] & { method: string; given: number; received: number })[];
  money: ContractorTotals;
  sites: (ContractorTotals & { siteId: number | null })[];
};
export type CashbookQuery = { accountId: number; to?: string; page?: number };
export type CashbookLedger = Omit<Ledger, 'rows'> & {
  cashbook: Cashbook;
  totalCash: bigint;
  rows: (Ledger['rows'][number] & { payee: VoucherPayee | null; offsets: string })[];
};
export type TrialBalance = { rows: (Account & { balance: bigint })[]; debit: bigint; credit: bigint };

type BookOperations = {
  getChart: [undefined, Chart];
  getReport: [ReportQuery, Report];
  createAccount: [{ name: string; kind: AccountKind }, Account];
  getContractors: [undefined, ContractorDirectory];
  saveContractor: [ContractorDetails, Account];
  removeContractor: [{ accountId: number }, { archived: boolean }];
  getContractorLedger: [LedgerQuery, ContractorLedger];
  getCashbooks: [undefined, Cashbook[]];
  createCashbook: [NewCashbook, Cashbook];
  saveCashbookCustodian: [Custodian & { accountId: number }, Cashbook];
  removeCashbook: [{ accountId: number }, { archived: boolean }];
  getCashbookLedger: [CashbookQuery, CashbookLedger];
  getNamedAccounts: [{ kind: NamedKind }, NamedAccount[]];
  saveNamedAccount: [NamedAccountDetails, NamedAccount];
  removeNamedAccount: [{ kind: NamedKind; accountId: number }, { archived: boolean }];
  getEmployeeLedger: [DayBookQuery & { accountId: number; advancePage?: number }, EmployeeLedger];
  postEmployee: [EmployeeEntry, VoucherDetail];
  postBank: [BankEntry, VoucherDetail];
  previewStatement: [StatementFile, StatementPreview];
  importStatement: [StatementImport, { added: number; existing: number }];
  getStatements: [{ accountId: number; page?: number; pending?: boolean }, Paged<StatementRow>];
  getStatement: [StatementReview, StatementRow];
  getStatementMatches: [StatementConfirmation, Paged<Voucher>];
  confirmStatement: [StatementConfirmation & { voucherId: number | null; requestId: string }, VoucherDetail];
  postVoucher: [PostVoucher, VoucherDetail];
  reverseVoucher: [ReverseVoucher, VoucherDetail];
  getVoucher: [{ voucherId: number }, VoucherDetail];
  getDayBook: [DayBookQuery, Paged<Voucher>];
  getLedger: [LedgerQuery, Ledger];
  getTrialBalance: [{ to?: string }, TrialBalance];
  postInvoice: [InvoiceEntry, IssuedInvoice];
  getInvoice: [{ voucherId: number }, IssuedInvoice];
  getInvoices: [InvoiceQuery, Paged<InvoiceRow>];
  applyBillPayment: [BillPayment, VoucherDetail];
};

export const BOOK_OPERATIONS = [
  'getChart', 'getReport', 'createAccount', 'getContractors', 'saveContractor', 'removeContractor', 'getContractorLedger',
  'getCashbooks', 'createCashbook', 'saveCashbookCustodian', 'removeCashbook', 'getCashbookLedger',
  'getNamedAccounts', 'saveNamedAccount', 'removeNamedAccount', 'getEmployeeLedger', 'postEmployee', 'postBank',
  'previewStatement', 'importStatement', 'getStatements', 'getStatement', 'getStatementMatches', 'confirmStatement',
  'postVoucher', 'reverseVoucher', 'getVoucher', 'getDayBook', 'getLedger', 'getTrialBalance', 'postInvoice', 'getInvoice', 'getInvoices', 'applyBillPayment',
] as const satisfies readonly (keyof BookOperations)[];

export type BookOperation = keyof BookOperations;
export type BookResult = BookOperations[BookOperation][1];
export type BookCommand = { operation: BookOperation; kind: WorkspaceKind; firmId: unknown; input: unknown };
export type BooksBridge = {
  [K in BookOperation]: (
    kind: WorkspaceKind, firmId: number, ...input: BookOperations[K][0] extends undefined ? [] : [BookOperations[K][0]]
  ) => Promise<BookOperations[K][1]>;
};
