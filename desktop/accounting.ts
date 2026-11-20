import type { DatabaseSync } from 'node:sqlite';
import { ACCOUNT_KINDS, EMPLOYEE_ACTIONS, PAGE_SIZE, VOUCHER_KINDS } from './books';
import type { Account, BookCommand, BookResult, Cashbook, CashbookLedger, Chart, ContractorDirectory, ContractorLedger,
  Ledger, Line, NamedAccount, NamedKind, Site, StatementRow, TrialBalance, Voucher, VoucherDetail, VoucherPayee } from './books';
import { mapStatement, previewStatement } from './statement-file';

export const accountingSchema = `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_id INTEGER NOT NULL REFERENCES firms(id),
    name TEXT NOT NULL COLLATE NOCASE,
    kind TEXT NOT NULL CHECK (kind IN ('${ACCOUNT_KINDS.join("','")}')),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    system TEXT,
    detail TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail)),
    UNIQUE (firm_id, id), UNIQUE (firm_id, kind, name), UNIQUE (firm_id, system)
  ) STRICT;
  CREATE TABLE sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_id INTEGER NOT NULL REFERENCES firms(id),
    name TEXT NOT NULL COLLATE NOCASE,
    UNIQUE (firm_id, id), UNIQUE (firm_id, name)
  ) STRICT;
  CREATE TABLE site_assignments (
    firm_id INTEGER NOT NULL REFERENCES firms(id),
    account_id INTEGER NOT NULL,
    site_id INTEGER NOT NULL,
    PRIMARY KEY (account_id, site_id),
    FOREIGN KEY (firm_id, account_id) REFERENCES accounts(firm_id, id),
    FOREIGN KEY (firm_id, site_id) REFERENCES sites(firm_id, id)
  ) STRICT;
  CREATE TABLE vouchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_id INTEGER NOT NULL REFERENCES firms(id),
    request_id TEXT NOT NULL,
    day TEXT NOT NULL,
    kind TEXT NOT NULL,
    memo TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    document TEXT CHECK (document IS NULL OR json_valid(document)),
    reverses_id INTEGER UNIQUE,
    UNIQUE (firm_id, id), UNIQUE (firm_id, request_id),
    FOREIGN KEY (firm_id, reverses_id) REFERENCES vouchers(firm_id, id)
  ) STRICT;
  CREATE INDEX vouchers_by_day ON vouchers(firm_id, day, id);
  CREATE TABLE posting_lines (
    id INTEGER PRIMARY KEY,
    firm_id INTEGER NOT NULL REFERENCES firms(id),
    voucher_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    site_id INTEGER,
    value INTEGER NOT NULL CHECK (value <> 0),
    FOREIGN KEY (firm_id, voucher_id) REFERENCES vouchers(firm_id, id),
    FOREIGN KEY (firm_id, account_id) REFERENCES accounts(firm_id, id),
    FOREIGN KEY (firm_id, site_id) REFERENCES sites(firm_id, id)
  ) STRICT;
  CREATE INDEX postings_by_voucher ON posting_lines(firm_id, voucher_id);
  CREATE INDEX postings_by_account ON posting_lines(firm_id, account_id, site_id);
`;

export class BookInputError extends Error {}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BookInputError(message);
}

function fields(input: unknown): Record<string, unknown> {
  check(input && typeof input === 'object' && !Array.isArray(input), 'Enter valid accounting details.');
  return input as Record<string, unknown>;
}

function transaction<T>(db: DatabaseSync, write: () => T) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = write();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function id(value: unknown, label: string) {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value > 0, `Choose an existing ${label}.`);
  return value;
}

function day(value: unknown) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value.slice(0, 4) !== '0000',
    'Enter a valid date.');
  const date = new Date(`${value}T00:00:00Z`);
  check(Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value, 'Enter a valid date.');
  return value;
}

function text(value: unknown, label: string, limit: number, required = false) {
  check(typeof value === 'string' && value.length <= limit && (!required || value.trim()),
    `${label} must have ${required ? '1 to' : 'at most'} ${limit} characters.`);
  return value.trim();
}

function paise(value: unknown) {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value !== 0, 'Enter a non-zero amount in integer paise.');
  return value;
}

function requestKey(value: unknown) {
  check(typeof value === 'string' && value.length >= 1 && value.length <= 128 && !/[^A-Za-z0-9_-]/.test(value),
    'Enter a valid request ID.');
  return value;
}

const accountColumns = 'id, name, kind, archived, system';

function getAccount(db: DatabaseSync, firmId: number, value: unknown, active = false) {
  const account = db.prepare(`SELECT ${accountColumns} FROM accounts WHERE firm_id = ? AND id = ?`)
    .get(firmId, id(value, 'account')) as Account | undefined;
  check(account && (!active || !account.archived), 'Choose an available account in this firm.');
  return account;
}

function getSite(db: DatabaseSync, firmId: number, value: unknown) {
  const siteId = id(value, 'site');
  check(db.prepare('SELECT 1 FROM sites WHERE firm_id = ? AND id = ?').get(firmId, siteId), 'Choose a site in this firm.');
  return siteId;
}

function getChart(db: DatabaseSync, firmId: number): Chart {
  return {
    accounts: db.prepare(`SELECT ${accountColumns} FROM accounts WHERE firm_id = ? ORDER BY name, id`).all(firmId) as Account[],
    sites: db.prepare('SELECT id, name FROM sites WHERE firm_id = ? ORDER BY name, id').all(firmId) as Site[],
  };
}

const voucherColumns = `v.id, v.day, v.kind, v.memo, v.amount, v.reverses_id AS reversesId, r.id AS reversedById`;
const voucherReversal = 'LEFT JOIN vouchers r ON r.firm_id = v.firm_id AND r.reverses_id = v.id';
const payeeColumns = 'v.payee_person AS person, f.id AS payeeFirmId, f.name AS firmName, f.owner AS owner';
const payeeJoin = 'LEFT JOIN firms f ON f.id = v.payee_firm_id';
type PayeeColumns = { person: string | null; payeeFirmId: number | null; firmName: string; owner: string };

function voucherPayee(row: PayeeColumns): VoucherPayee | null {
  if (row.payeeFirmId !== null) return { kind: 'Firm', firmId: row.payeeFirmId, name: row.firmName, owner: row.owner };
  return row.person === null ? null : { kind: 'Person', name: row.person };
}

function getVoucher(db: DatabaseSync, firmId: number, value: unknown): VoucherDetail {
  const voucherId = id(value, 'voucher');
  const row = db.prepare(`SELECT ${voucherColumns}, ${payeeColumns}, e.id AS employeeId, e.name AS employeeName
    FROM vouchers v ${voucherReversal} ${payeeJoin}
    LEFT JOIN accounts e ON e.firm_id = v.firm_id AND e.id = v.employee_id
    WHERE v.firm_id = ? AND v.id = ?`).get(firmId, voucherId) as
    (Voucher & PayeeColumns & { employeeId: number | null; employeeName: string }) | undefined;
  check(row, 'Choose a voucher in this firm.');
  const { person, payeeFirmId, firmName, owner, employeeId, employeeName, ...voucher } = row;
  const lines = db.prepare(`SELECT account_id AS accountId, site_id AS siteId, value FROM posting_lines
    WHERE firm_id = ? AND voucher_id = ? ORDER BY id`).all(firmId, voucherId) as Line[];
  return { ...voucher, lines, payee: voucherPayee({ person, payeeFirmId, firmName, owner }),
    ...(employeeId === null ? {} : { employee: { id: employeeId, name: employeeName } }),
  };
}

function createAccount(db: DatabaseSync, firmId: number, input: Record<string, unknown>) {
  const name = text(input.name, 'Account name', 180, true);
  const kind = ACCOUNT_KINDS.find(kind => kind === input.kind);
  check(kind, 'Choose an account type.');
  check(kind !== 'equity' || name.toLowerCase() !== 'opening capital', 'Opening capital is created when an opening balance is posted.');
  const inserted = db.prepare(`INSERT INTO accounts (firm_id, name, kind) VALUES (?, ?, ?)
    ON CONFLICT (firm_id, kind, name) DO NOTHING RETURNING ${accountColumns}`).get(firmId, name, kind) as Account | undefined;
  check(inserted, 'An account with that name and type already exists in this firm.');
  return inserted;
}

function namedKind(value: unknown) {
  check(value === 'employee' || value === 'bank', 'Choose Employees or Bank.');
  return value;
}

function getNamedAccount(db: DatabaseSync, firmId: number, value: unknown, kind: NamedKind, active = false) {
  const account = getAccount(db, firmId, value, active);
  check(account.kind === kind, kind === 'bank' ? 'Choose a bank account in this firm.' : 'Choose an employee in this firm.');
  return account;
}

function getNamedAccounts(db: DatabaseSync, firmId: number, kind: NamedKind) {
  return db.prepare(`SELECT ${accountColumns}, COALESCE(detail ->> '$.role', '') AS role,
    COALESCE(detail ->> '$.number', '') AS number FROM accounts WHERE firm_id = ? AND kind = ? ORDER BY name, id`)
    .all(firmId, kind) as NamedAccount[];
}

const advanceSystem = (employeeId: number) => 'employee-advance:' + employeeId;

function getAdvanceAccount(db: DatabaseSync, firmId: number, employeeId: number) {
  return db.prepare('SELECT id FROM accounts WHERE firm_id = ? AND system = ?')
    .get(firmId, advanceSystem(employeeId))?.id as number | undefined;
}

function saveNamedAccount(db: DatabaseSync, firmId: number, input: Record<string, unknown>) {
  const kind = namedKind(input.kind);
  const name = text(input.name, kind === 'bank' ? 'Bank account name' : 'Employee name', 180, true);
  const role = text(input.role, kind === 'bank' ? 'Account type' : 'Role', 180);
  const number = kind === 'bank' ? text(input.number, 'Account number', 80) : '';
  try {
    return transaction(db, () => {
      const account = input.id === null ? createAccount(db, firmId, { name, kind })
        : getNamedAccount(db, firmId, input.id, kind, true);
      db.prepare(`UPDATE accounts SET name = ?, detail = json_set(detail, '$.role', ?, '$.number', ?)
        WHERE firm_id = ? AND id = ?`).run(name, role, number, firmId, account.id);
      if (kind === 'employee' && name !== account.name) {
        db.prepare('UPDATE accounts SET name = ? WHERE firm_id = ? AND system = ?')
          .run(name + ' · Salary advances', firmId, advanceSystem(account.id));
      }
      return { ...account, name, role, number };
    });
  } catch (error) {
    if (error instanceof Error && 'errcode' in error && error.errcode === 2067) {
      throw new BookInputError('An account with that name already exists in this firm.');
    }
    throw error;
  }
}

function removeNamedAccount(db: DatabaseSync, firmId: number, input: Record<string, unknown>) {
  const kind = namedKind(input.kind);
  return transaction(db, () => {
    const account = getNamedAccount(db, firmId, input.accountId, kind, true);
    const advanceId = kind === 'employee' ? getAdvanceAccount(db, firmId, account.id) : undefined;
    const archived = !!db.prepare(`SELECT 1 FROM posting_lines WHERE firm_id = $firm AND account_id IN ($account, $advance)
      UNION ALL SELECT 1 FROM cashbooks WHERE firm_id = $firm AND employee_id = $account
      UNION ALL SELECT 1 FROM vouchers WHERE firm_id = $firm AND employee_id = $account
      UNION ALL SELECT 1 FROM statement_rows WHERE firm_id = $firm AND bank_id = $account LIMIT 1`)
      .get({ firm: firmId, account: account.id, advance: advanceId ?? null });
    if (archived) db.prepare('UPDATE accounts SET archived = 1 WHERE firm_id = ? AND id IN (?, ?)')
      .run(firmId, account.id, advanceId ?? null);
    else db.prepare('DELETE FROM accounts WHERE firm_id = ? AND id IN (?, ?)')
      .run(firmId, account.id, advanceId ?? null);
    return { archived };
  });
}

function getContractor(db: DatabaseSync, firmId: number, value: unknown, active = false) {
  const account = getAccount(db, firmId, value, active);
  check(account.kind === 'contractor', 'Choose a contractor in this firm.');
  return account;
}

function getContractors(db: DatabaseSync, firmId: number): ContractorDirectory {
  const { accounts, sites } = getChart(db, firmId);
  const contractors = accounts.filter(account => account.kind === 'contractor').map(account => ({ ...account, siteIds: [] as number[] }));
  const byId = new Map(contractors.map(account => [account.id, account]));
  for (const { accountId, siteId } of db.prepare(`SELECT account_id AS accountId, site_id AS siteId
    FROM site_assignments WHERE firm_id = ? ORDER BY site_id`).all(firmId) as { accountId: number; siteId: number }[]) {
    byId.get(accountId)?.siteIds.push(siteId);
  }
  return { contractors, sites };
}

function saveContractor(db: DatabaseSync, firmId: number, input: Record<string, unknown>) {
  const name = text(input.name, 'Contractor name', 180, true);
  check(Array.isArray(input.siteIds) && Array.isArray(input.newSites), 'Enter valid site assignments.');
  const names = input.newSites.map(value => text(value, 'Site name', 180, true));
  db.exec('BEGIN IMMEDIATE');
  try {
    const sites = new Set(input.siteIds.map(value => getSite(db, firmId, value)));
    const account = input.id === null ? createAccount(db, firmId, { name, kind: 'contractor' })
      : getContractor(db, firmId, input.id, true);
    if (account.name !== name) db.prepare('UPDATE accounts SET name = ? WHERE firm_id = ? AND id = ?').run(name, firmId, account.id);
    const createSite = db.prepare('INSERT INTO sites (firm_id, name) VALUES (?, ?) ON CONFLICT (firm_id, name) DO NOTHING');
    const findSite = db.prepare('SELECT id FROM sites WHERE firm_id = ? AND name = ?');
    for (const siteName of names) {
      createSite.run(firmId, siteName);
      sites.add(findSite.get(firmId, siteName)!.id as number);
    }
    db.prepare('DELETE FROM site_assignments WHERE firm_id = ? AND account_id = ?').run(firmId, account.id);
    const assign = db.prepare('INSERT INTO site_assignments (firm_id, account_id, site_id) VALUES (?, ?, ?)');
    for (const siteId of sites) assign.run(firmId, account.id, siteId);
    db.exec('COMMIT');
    return { ...account, name };
  } catch (error) {
    db.exec('ROLLBACK');
    if (error instanceof Error && 'errcode' in error && error.errcode === 2067) {
      throw new BookInputError('A contractor with that name already exists in this firm.');
    }
    throw error;
  }
}

function removeContractor(db: DatabaseSync, firmId: number, value: unknown) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const { id } = getContractor(db, firmId, value, true);
    const archived = !!db.prepare('SELECT 1 FROM posting_lines WHERE firm_id = ? AND account_id = ? LIMIT 1').get(firmId, id);
    if (archived) {
      db.prepare('UPDATE accounts SET archived = 1 WHERE firm_id = ? AND id = ?').run(firmId, id);
    } else {
      db.prepare('DELETE FROM site_assignments WHERE firm_id = ? AND account_id = ?').run(firmId, id);
      db.prepare('DELETE FROM accounts WHERE firm_id = ? AND id = ?').run(firmId, id);
    }
    db.exec('COMMIT');
    return { archived };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const cashbookRows = `SELECT a.id, a.name, a.archived, COALESCE(e.name, c.custodian) AS custodian,
    c.employee_id AS employeeId, c.opened_on AS openedOn,
    COALESCE(v.amount, 0) AS openingCash
  FROM cashbooks c JOIN accounts a ON a.firm_id = c.firm_id AND a.id = c.account_id
    LEFT JOIN accounts e ON e.firm_id = c.firm_id AND e.id = c.employee_id
    LEFT JOIN vouchers v ON v.firm_id = c.firm_id AND v.id = c.opening_voucher_id
  WHERE c.firm_id = ?`;

function getCashbook(db: DatabaseSync, firmId: number, value: unknown) {
  const cashbook = db.prepare(cashbookRows + ' AND c.account_id = ?').get(firmId, id(value, 'cashbook')) as Cashbook | undefined;
  check(cashbook, 'Choose a cashbook in this firm.');
  return cashbook;
}

function cashbookCustodian(db: DatabaseSync, firmId: number, input: Record<string, unknown>, active: boolean) {
  if (input.employeeId === undefined) return { employeeId: null, custodian: text(input.custodian, 'Custodian', 180, true) };
  const employee = getNamedAccount(db, firmId, input.employeeId, 'employee', active);
  return { employeeId: employee.id, custodian: employee.name };
}

function saveCashbookCustodian(db: DatabaseSync, firmId: number, input: Record<string, unknown>) {
  return transaction(db, () => {
    const book = getCashbook(db, firmId, input.accountId);
    check(!book.archived, 'Choose an active cashbook.');
    const { employeeId, custodian } = cashbookCustodian(db, firmId, input, input.employeeId !== book.employeeId);
    db.prepare('UPDATE cashbooks SET custodian = ?, employee_id = ? WHERE firm_id = ? AND account_id = ?')
      .run(custodian, employeeId, firmId, book.id);
    return getCashbook(db, firmId, book.id);
  });
}

function createCashbook(db: DatabaseSync, firm: { id: number; archived: boolean }, input: Record<string, unknown>) {
  const firmId = firm.id;
  const requestId = requestKey(input.requestId);
  const name = text(input.name, 'Cashbook name', 180, true);
  const openedOn = day(input.openedOn);
  const openingCash = input.openingCash === 0 ? 0 : paise(input.openingCash);
  check(openingCash >= 0, 'Enter opening cash of zero or more.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const prior = db.prepare(cashbookRows + ' AND c.request_id = ?').get(firmId, requestId) as Cashbook | undefined;
    const { employeeId, custodian } = cashbookCustodian(db, firmId, input, !prior);
    let cashbook: Cashbook;
    if (prior) {
      check(prior.name === name && prior.employeeId === employeeId && prior.custodian === custodian &&
        prior.openedOn === openedOn && prior.openingCash === openingCash,
        'This request ID is already used by a different cashbook.');
      cashbook = prior;
    } else {
      check(!firm.archived, 'Choose an active funding firm to create a cashbook.');
      const account = createAccount(db, firmId, { name, kind: 'cash' });
      const openingVoucher = openingCash === 0 ? null : writeVoucher(db, firmId, 'cashbook:' + requestId, {
        day: openedOn, kind: 'Opening balance', memo: 'Cashbook opening cash',
        lines: openingLines(db, firmId, account, openingCash),
      });
      db.prepare(`INSERT INTO cashbooks (firm_id, account_id, custodian, opened_on, request_id, opening_voucher_id, employee_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(firmId, account.id, custodian, openedOn, requestId, openingVoucher, employeeId);
      cashbook = getCashbook(db, firmId, account.id);
    }
    db.exec('COMMIT');
    return cashbook;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function removeCashbook(db: DatabaseSync, firmId: number, value: unknown) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const cashbook = getCashbook(db, firmId, value);
    check(!cashbook.archived, 'This cashbook is already archived.');
    const archived = !!db.prepare('SELECT 1 FROM posting_lines WHERE firm_id = ? AND account_id = ? LIMIT 1').get(firmId, cashbook.id);
    if (archived) {
      db.prepare('UPDATE accounts SET archived = 1 WHERE firm_id = ? AND id = ?').run(firmId, cashbook.id);
    } else {
      db.prepare('DELETE FROM cashbooks WHERE firm_id = ? AND account_id = ?').run(firmId, cashbook.id);
      db.prepare('DELETE FROM accounts WHERE firm_id = ? AND id = ?').run(firmId, cashbook.id);
    }
    db.exec('COMMIT');
    return { archived };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function openingLines(db: DatabaseSync, firmId: number, account: Account, value: number): Line[] {
  check(account.system !== 'capital', 'Choose the account to open.');
  const capital = db.prepare("SELECT id FROM accounts WHERE firm_id = ? AND system = 'capital'").get(firmId)
    ?? db.prepare(`INSERT INTO accounts (firm_id, name, kind, system)
      VALUES (?, 'Opening capital', 'equity', 'capital') RETURNING id`).get(firmId)!;
  return [{ accountId: account.id, siteId: null, value }, { accountId: capital.id as number, siteId: null, value: -value }];
}

function paymentPayee(db: DatabaseSync, value: unknown, active: boolean): VoucherPayee {
  const payee = fields(value);
  if (payee.kind === 'Person') return { kind: 'Person', name: text(payee.name, 'Payee name', 180, true) };
  check(payee.kind === 'Firm', 'Choose a person or a firm as payee.');
  const firmId = id(payee.firmId, 'payee firm');
  const firm = db.prepare('SELECT name, owner, archived FROM firms WHERE id = ?')
    .get(firmId) as { name: string; owner: string; archived: number } | undefined;
  check(firm && (!active || !firm.archived), 'Choose an available payee firm.');
  return { kind: 'Firm', firmId, name: firm.name, owner: firm.owner };
}

type Posting = { day: string; kind: string; memo: string; lines: Line[]; reversesId?: number | null;
  sourceId?: number; sourceAmount?: number; document?: unknown; payee?: VoucherPayee | null; employeeId?: number };

// The caller owns the transaction so related records can commit with the posting.
function writeVoucher(db: DatabaseSync, firmId: number, requestId: string, posting: Posting) {
  const voucherDay = day(posting.day);
  check(new Set(posting.lines.map(line => line.accountId)).size >= 2, 'Choose at least two different accounts.');
  let debit = 0n;
  let credit = 0n;
  let liquid = 0n;
  let allLiquid = true;
  for (const line of posting.lines) {
    const account = getAccount(db, firmId, line.accountId, !posting.reversesId && !posting.sourceId);
    const value = BigInt(paise(line.value));
    if (value > 0n) debit += value;
    else credit -= value;
    if (account.kind === 'bank' || account.kind === 'cash') liquid += value;
    else allLiquid = false;

    if (account.kind === 'cash') {
      const book = db.prepare('SELECT opened_on AS openedOn FROM cashbooks WHERE firm_id = ? AND account_id = ?')
        .get(firmId, account.id) as { openedOn: string } | undefined;
      check(!book || voucherDay >= book.openedOn, 'The voucher date must be on or after the cashbook opening date.');
    }
    if (line.siteId !== null) getSite(db, firmId, line.siteId);
    if (account.kind === 'contractor' && !posting.reversesId) {
      check(line.siteId !== null && db.prepare(`SELECT 1 FROM site_assignments
        WHERE firm_id = ? AND account_id = ? AND site_id = ?`).get(firmId, line.accountId, line.siteId),
      'Choose an assigned site for every contractor line.');
    }
  }
  check(debit === credit, 'Debits and credits must balance.');
  check(debit <= BigInt(Number.MAX_SAFE_INTEGER), 'The voucher total is too large.');
  check(posting.kind !== 'Payment' || liquid < 0n, 'A payment must decrease bank or cash.');
  check(posting.kind !== 'Receipt' || liquid > 0n, 'A receipt must increase bank or cash.');
  check(posting.kind !== 'Contra' || allLiquid, 'A contra uses only bank and cash accounts.');
  check(posting.sourceAmount === undefined || debit === BigInt(posting.sourceAmount), 'The sample voucher total differs from its lines.');

  const { lastInsertRowid } = db.prepare(`INSERT INTO vouchers
    (id, firm_id, request_id, day, kind, memo, amount, document, reverses_id, payee_person, payee_firm_id, employee_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(posting.sourceId ?? null, firmId, requestId, voucherDay, posting.kind, posting.memo, Number(debit),
      posting.document == null ? null : JSON.stringify(posting.document), posting.reversesId ?? null,
      posting.payee?.kind === 'Person' ? posting.payee.name : null, posting.payee?.kind === 'Firm' ? posting.payee.firmId : null,
      posting.employeeId ?? null);
  const insert = db.prepare('INSERT INTO posting_lines (firm_id, voucher_id, account_id, site_id, value) VALUES (?, ?, ?, ?, ?)');
  for (const line of posting.lines) insert.run(firmId, lastInsertRowid, line.accountId, line.siteId, line.value);
  return Number(lastInsertRowid);
}

function employeeLines(db: DatabaseSync, firmId: number, input: Record<string, unknown>, voucherDay: string, prior: boolean) {
  const employee = getNamedAccount(db, firmId, input.accountId, 'employee', !prior);
  const amount = paise(input.amount);
  check(amount > 0, 'Enter a positive amount.');
  const action = EMPLOYEE_ACTIONS.find(action => action === input.action);
  check(action, 'Choose an employee transaction.');
  const line = (accountId: number, value: number): Line => ({ accountId, siteId: null, value });
  const personal = (value: number) => line(employee.id, value);
  const funding = () => {
    const account = getAccount(db, firmId, input.fundingId, !prior);
    check(account.kind === 'bank' || account.kind === 'cash', 'Choose a bank or cash account.');
    return account.id;
  };
  const advance = () => {
    const accountId = getAdvanceAccount(db, firmId, employee.id);
    if (accountId !== undefined) return accountId;
    check(action === 'Salary advance', 'This employee has no salary advances.');
    const account = db.prepare(`INSERT INTO accounts (firm_id, name, kind, system) VALUES (?, ?, 'asset', ?)
      ON CONFLICT (firm_id, kind, name) DO NOTHING RETURNING id`)
      .get(firmId, employee.name + ' · Salary advances', advanceSystem(employee.id));
    check(account, 'Rename the existing asset account with the same name to record this advance.');
    return account.id as number;
  };
  const balance = (accountId: number) => getLedger(db, firmId, { accountId, to: voucherDay }).closing;
  switch (action) {
    case 'Salary earned': {
      const salary = db.prepare("SELECT id FROM accounts WHERE firm_id = ? AND system = 'salary'").get(firmId)
        ?? db.prepare(`INSERT INTO accounts (firm_id, name, kind, system) VALUES (?, 'Salaries', 'expense', 'salary')
          ON CONFLICT (firm_id, kind, name) DO UPDATE SET system = excluded.system WHERE accounts.system IS NULL RETURNING id`).get(firmId);
      check(salary, 'The Salaries expense account is already in use.');
      return [line(salary.id as number, amount), personal(-amount)];
    }
    case 'Salary payment':
      check(prior || -balance(employee.id) >= BigInt(amount), 'The payment exceeds salary payable on this date.');
      return [personal(amount), line(funding(), -amount)];
    case 'Salary advance':
      return [line(advance(), amount), line(funding(), -amount)];
    case 'Apply advance': {
      const accountId = advance();
      check(prior || (-balance(employee.id) >= BigInt(amount) && balance(accountId) >= BigInt(amount)),
        'The application exceeds salary payable or the outstanding advance on this date.');
      return [personal(amount), line(accountId, -amount)];
    }
    case 'Advance repayment': {
      const accountId = advance();
      check(prior || balance(accountId) >= BigInt(amount), 'The repayment exceeds the outstanding advance on this date.');
      return [line(funding(), amount), line(accountId, -amount)];
    }
    case 'Reimbursement': {
      const expense = getAccount(db, firmId, input.offsetId, !prior);
      check(expense.kind === 'expense' && expense.system !== 'salary', 'Choose a reimbursement expense account.');
      return [line(expense.id, amount), line(funding(), -amount)];
    }
    case 'Manual adjustment': {
      const offset = getAccount(db, firmId, input.offsetId, !prior);
      check(!['cash', 'bank', 'contractor'].includes(offset.kind) && offset.id !== employee.id,
        'Choose another non-cash account for the adjustment.');
      check(typeof input.reducePayable === 'boolean', 'Choose whether the adjustment increases or reduces payable.');
      const value = input.reducePayable ? amount : -amount;
      return [personal(value), line(offset.id, -value)];
    }
  }
}

function post(db: DatabaseSync, firm: { id: number; archived: boolean }, input: Record<string, unknown>,
  mode: 'voucher' | 'reversal' | 'employee' | 'bank') {
  const firmId = firm.id;
  const requestId = requestKey(input.requestId);
  const reversal = mode === 'reversal';
  return transaction(db, () => {
    const prior = db.prepare('SELECT id, employee_id AS employeeId FROM vouchers WHERE firm_id = ? AND request_id = ?')
      .get(firmId, requestId);
    check(prior || !firm.archived, 'Choose an active firm to post vouchers.');
    const voucherDay = day(input.day);
    const bank = mode === 'bank' ? bankPosting(db, firmId, input, paise(input.value), !prior) : undefined;
    let kind: string | undefined;
    if (reversal) kind = 'Reversal';
    else if (mode === 'employee') kind = EMPLOYEE_ACTIONS.find(action => action === input.action);
    else if (bank) kind = bank.kind;
    else kind = VOUCHER_KINDS.find(kind => kind === input.kind);
    check(kind, 'Choose a voucher type.');
    const memo = text(input.memo, reversal ? 'Reversal reason' : 'Narration', 500, reversal);
    check(input.payee === undefined || kind === 'Payment', 'A payee can be recorded on a payment.');
    let payee = input.payee === undefined ? null : paymentPayee(db, input.payee, !prior);
    let lines: Line[];
    let reversesId: number | null = null;
    let employeeId: number | undefined;

    if (reversal) {
      const original = getVoucher(db, firmId, input.voucherId);
      check(original.kind !== 'Reversal', 'Choose an original voucher.');
      check(original.reversedById === null || original.reversedById === prior?.id, 'This voucher already has a reversal.');
      check(voucherDay >= original.day, 'The reversal date must be on or after the original date.');
      reversesId = original.id;
      employeeId = original.employee?.id;
      payee = original.payee;
      lines = original.lines.map(line => ({ ...line, value: -line.value }));
    } else if (mode === 'employee') {
      lines = employeeLines(db, firmId, input, voucherDay, !!prior);
      if (kind === 'Reimbursement') employeeId = id(input.accountId, 'employee');
    } else if (bank) {
      lines = bank.lines;
    } else if (kind === 'Opening balance') {
      lines = openingLines(db, firmId, getAccount(db, firmId, input.accountId), paise(input.value));
    } else {
      check(Array.isArray(input.lines) && input.lines.length >= 2, 'Enter at least two posting lines.');
      lines = input.lines.map(value => {
        const line = fields(value);
        return { accountId: id(line.accountId, 'account'), siteId: line.siteId === null ? null : id(line.siteId, 'site'), value: paise(line.value) };
      });
    }

    let voucher: VoucherDetail;
    if (prior) {
      voucher = getVoucher(db, firmId, prior.id);
      check(voucher.kind === kind && voucher.day === voucherDay && voucher.memo === memo && voucher.reversesId === reversesId &&
        prior.employeeId === (employeeId ?? null) &&
        voucher.payee?.kind === payee?.kind && (payee?.kind === 'Firm'
          ? voucher.payee?.kind === 'Firm' && voucher.payee.firmId === payee.firmId : voucher.payee?.name === payee?.name) &&
        voucher.lines.length === lines.length && voucher.lines.every((line, index) => {
          const submitted = lines[index];
          return line.accountId === submitted.accountId && line.siteId === submitted.siteId && line.value === submitted.value;
        }), 'This request ID is already used by a different voucher.');
    } else {
      const voucherId = writeVoucher(db, firmId, requestId, { day: voucherDay, kind, memo, reversesId, lines, payee, employeeId });
      if (reversesId !== null) db.prepare('UPDATE statement_rows SET voucher_id = NULL WHERE firm_id = ? AND voucher_id = ?')
        .run(firmId, reversesId);
      voucher = getVoucher(db, firmId, voucherId);
    }
    return voucher;
  });
}

function period(input: Record<string, unknown>) {
  const from = input.from === undefined ? null : day(input.from);
  const to = input.to === undefined ? null : day(input.to);
  check(!from || !to || from <= to, 'The end date must be on or after the start date.');
  return { from, to };
}

function pageOffset(value: unknown) {
  if (value === undefined) return 0;
  check(typeof value === 'number' && Number.isSafeInteger(value * PAGE_SIZE) && Number.isInteger(value) && value >= 0,
    'Choose a valid page.');
  return value * PAGE_SIZE;
}

function getDayBook(db: DatabaseSync, firmId: number, input: Record<string, unknown>) {
  const { from, to } = period(input);
  const rows = db.prepare(`SELECT ${voucherColumns} FROM vouchers v ${voucherReversal}
    WHERE v.firm_id = $firm AND ($from IS NULL OR v.day >= $from) AND ($to IS NULL OR v.day <= $to)
    ORDER BY v.day DESC, v.id DESC LIMIT $limit OFFSET $offset`)
    .all({ firm: firmId, from, to, limit: PAGE_SIZE + 1, offset: pageOffset(input.page) }) as Voucher[];
  return { rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

function getLedger(db: DatabaseSync, firmId: number, input: Record<string, unknown>, contractor: true): ContractorLedger;
function getLedger(db: DatabaseSync, firmId: number, input: Record<string, unknown>): Ledger;
function getLedger(db: DatabaseSync, firmId: number, input: Record<string, unknown>, contractor = false): Ledger | ContractorLedger {
  const account = contractor ? getContractor(db, firmId, input.accountId) : getAccount(db, firmId, input.accountId);
  const site = input.siteId === undefined ? null : getSite(db, firmId, input.siteId);
  const { from, to } = period(input);
  const scope = `FROM posting_lines l JOIN vouchers v ON v.firm_id = l.firm_id AND v.id = l.voucher_id
    WHERE l.firm_id = $firm AND l.account_id = $account AND ($site IS NULL OR l.site_id = $site)
      AND ($to IS NULL OR v.day <= $to)`;
  const params = { firm: firmId, account: account.id, site, to, from };
  // A shared voucher can have cash and noncash offsets with no link from a specific line to either.
  const method = `(SELECT CASE
      WHEN COUNT(*) FILTER (WHERE a.kind IN ('bank', 'cash')) = 0 THEN 'Noncash'
      WHEN COUNT(*) FILTER (WHERE a.kind NOT IN ('bank', 'cash')) > 0 THEN 'Mixed offsets'
      WHEN COUNT(DISTINCT a.kind) = 2 THEN 'Bank and cash'
      WHEN MAX(a.kind) = 'bank' THEN 'Bank' ELSE 'Cash' END
    FROM posting_lines p JOIN accounts a ON a.firm_id = p.firm_id AND a.id = p.account_id
    WHERE p.firm_id = l.firm_id AND p.voucher_id = l.voucher_id AND (p.value > 0) <> (l.value > 0))`;
  const cashMovement = "method IN ('Bank', 'Cash', 'Bank and cash')";
  // The window includes earlier lines so period and page changes preserve the running balance.
  const rows = db.prepare(`WITH entries AS (
    SELECT l.id AS lineId, v.id AS voucherId, v.day, v.kind, v.memo, l.site_id AS siteId, l.value, NULL AS reimbursement
      ${contractor ? `, ${method} AS method, v.reverses_id IS NOT NULL AS reversal` : ''} ${scope}
    ${account.kind === 'employee' ? `UNION ALL
      SELECT -v.id, v.id, v.day, v.kind, v.memo, NULL, 0, CASE WHEN v.reverses_id IS NULL THEN v.amount ELSE -v.amount END
      FROM vouchers v WHERE v.firm_id = $firm AND v.employee_id = $account
        AND $site IS NULL AND ($to IS NULL OR v.day <= $to)` : ''}
  ), movements AS (
    SELECT *, CAST(SUM(value) OVER (ORDER BY day, voucherId, lineId ROWS UNBOUNDED PRECEDING) AS TEXT) AS running
    FROM entries
    )
    SELECT * FROM movements WHERE $from IS NULL OR day >= $from
    ORDER BY day, voucherId, lineId LIMIT $limit OFFSET $offset`)
    .all({ ...params, limit: PAGE_SIZE + 1, offset: pageOffset(input.page) }) as
    (Omit<Ledger['rows'][number], 'running'> & { running: string; method: string; reversal: number; reimbursement: number | null })[];
  const totals = db.prepare(`SELECT CAST(COALESCE(SUM(l.value) FILTER (WHERE v.day < $from), 0) AS TEXT) AS opening,
    CAST(COALESCE(SUM(l.value), 0) AS TEXT) AS closing ${scope}`).get(params) as { opening: string; closing: string };
  const ledger = {
    opening: BigInt(totals.opening), closing: BigInt(totals.closing),
    rows: rows.slice(0, PAGE_SIZE).map(({ method, reversal, reimbursement, ...row }) => ({
      ...row, running: BigInt(row.running), ...(reimbursement === null ? {} : { reimbursement }),
    })),
    hasNext: rows.length > PAGE_SIZE,
  };
  if (!contractor) return ledger;

  const siteTotals = db.prepare(`WITH movements AS (
      SELECT l.site_id AS siteId, l.value, v.day, ${method} AS method,
        (l.value > 0) = (v.reverses_id IS NULL) AS wasGiven ${scope}
    ) SELECT siteId, CAST(SUM(value) AS TEXT) AS balance,
      CAST(COALESCE(SUM(value) FILTER (WHERE ${cashMovement} AND wasGiven AND ($from IS NULL OR day >= $from)), 0) AS TEXT) AS given,
      CAST(COALESCE(SUM(-value) FILTER (WHERE ${cashMovement} AND NOT wasGiven AND ($from IS NULL OR day >= $from)), 0) AS TEXT) AS received
    FROM movements GROUP BY siteId`).all(params) as { siteId: number | null; balance: string; given: string; received: string }[];
  const sites = siteTotals.map(({ siteId, balance, given, received }) => ({
    siteId, balance: BigInt(balance), given: BigInt(given), received: BigInt(received),
  }));
  const money = sites.reduce((sum, site) => ({
    balance: sum.balance + site.balance, given: sum.given + site.given, received: sum.received + site.received,
  }), { balance: 0n, given: 0n, received: 0n });
  return {
    ...ledger, money, sites,
    rows: ledger.rows.map((row, index) => {
      const { method, reversal } = rows[index];
      const cash = method === 'Bank' || method === 'Cash' || method === 'Bank and cash';
      const wasGiven = (row.value > 0) !== Boolean(reversal);
      return { ...row, method, given: cash && wasGiven ? row.value : 0, received: cash && !wasGiven ? -row.value : 0 };
    }),
  };
}

function getEmployeeLedger(db: DatabaseSync, firmId: number, input: Record<string, unknown>) {
  const employee = getNamedAccount(db, firmId, input.accountId, 'employee');
  const advance = getAdvanceAccount(db, firmId, employee.id);
  return {
    personal: getLedger(db, firmId, input),
    advances: advance === undefined ? null : getLedger(db, firmId, {
      accountId: advance, from: input.from, to: input.to, page: input.advancePage,
    }),
  };
}

function getTrialBalance(db: DatabaseSync, firmId: number, input: Record<string, unknown>): TrialBalance {
  const { to } = period(input);
  const rows = db.prepare(`WITH balances AS (
      SELECT l.account_id, SUM(l.value) AS balance
      FROM vouchers v JOIN posting_lines l ON l.firm_id = v.firm_id AND l.voucher_id = v.id
      WHERE v.firm_id = $firm AND ($to IS NULL OR v.day <= $to)
      GROUP BY l.account_id
    )
    SELECT ${accountColumns}, CAST(COALESCE(b.balance, 0) AS TEXT) AS balance
    FROM accounts a LEFT JOIN balances b ON b.account_id = a.id WHERE a.firm_id = $firm ORDER BY a.name, a.id`)
    .all({ firm: firmId, to }) as (Account & { balance: string })[];
  let debit = 0n;
  let credit = 0n;
  const accounts = rows.map(row => {
    const balance = BigInt(row.balance);
    if (balance > 0n) debit += balance;
    else credit -= balance;
    return { ...row, balance };
  });
  return { rows: accounts, debit, credit };
}

function getCashbookLedger(db: DatabaseSync, firmId: number, input: Record<string, unknown>): CashbookLedger {
  const cashbook = getCashbook(db, firmId, input.accountId);
  const { to } = period({ to: input.to });
  const ledger = getLedger(db, firmId, { accountId: cashbook.id, to: to ?? undefined, page: input.page });
  const { total } = db.prepare(`SELECT CAST(COALESCE(SUM(l.value), 0) AS TEXT) AS total
    FROM posting_lines l JOIN vouchers v ON v.firm_id = l.firm_id AND v.id = l.voucher_id
    JOIN accounts a ON a.firm_id = l.firm_id AND a.id = l.account_id
    WHERE l.firm_id = $firm AND a.kind = 'cash' AND ($to IS NULL OR v.day <= $to)`)
    .get({ firm: firmId, to }) as { total: string };
  const counterparty = db.prepare(`SELECT ${payeeColumns}, COALESCE((
    SELECT group_concat(name, ', ') FROM (
      SELECT DISTINCT a.name FROM posting_lines p
      JOIN accounts a ON a.firm_id = p.firm_id AND a.id = p.account_id
      WHERE p.firm_id = v.firm_id AND p.voucher_id = v.id AND p.account_id <> $account
        AND (p.value > 0) <> $debit ORDER BY a.name
    )), '') AS offsets
    FROM vouchers v ${payeeJoin} WHERE v.firm_id = $firm AND v.id = $voucher`);
  return {
    ...ledger, cashbook, totalCash: BigInt(total),
    rows: ledger.rows.map(row => {
      const detail = counterparty.get({
        firm: firmId, voucher: row.voucherId, account: cashbook.id, debit: Number(row.value > 0),
      }) as PayeeColumns & { offsets: string };
      return { ...row, payee: voucherPayee(detail), offsets: detail.offsets };
    }),
  };
}

const statementColumns = `id, day, description, reference, value, voucher_id AS voucherId,
  filename, sheet, row_number AS rowNumber`;

function importStatement(db: DatabaseSync, firmId: number, input: Record<string, unknown>) {
  const bank = getNamedAccount(db, firmId, input.accountId, 'bank', true);
  const { filename, sheet, rows } = mapStatement(input, day);
  const insert = db.prepare(`INSERT INTO statement_rows
    (firm_id, bank_id, day, description, reference, value, occurrence, filename, sheet, row_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (bank_id, day, description, reference, value, occurrence) DO NOTHING`);
  return transaction(db, () => {
    let added = 0;
    const occurrences = new Map<string, number>();
    for (const row of rows) {
      const key = JSON.stringify([row.day, row.description, row.reference, row.value]);
      // shortcut: overlapping exports need stable row contents and multiplicity, use bank transaction IDs when available.
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      added += Number(insert.run(firmId, bank.id, row.day, row.description, row.reference, row.value,
        occurrence, filename, sheet, row.rowNumber).changes);
    }
    return { added, existing: rows.length - added };
  });
}

function getStatements(db: DatabaseSync, firmId: number, input: Record<string, unknown>) {
  const bank = getNamedAccount(db, firmId, input.accountId, 'bank');
  check(input.pending === undefined || typeof input.pending === 'boolean', 'Choose a statement status.');
  const rows = db.prepare(`SELECT ${statementColumns} FROM statement_rows WHERE firm_id = ? AND bank_id = ?
    AND (? = 0 OR voucher_id IS NULL) ORDER BY day DESC, id DESC LIMIT ? OFFSET ?`)
    .all(firmId, bank.id, Number(input.pending === true), PAGE_SIZE + 1, pageOffset(input.page)) as StatementRow[];
  return { rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

function getStatement(db: DatabaseSync, firmId: number, input: Record<string, unknown>) {
  const bank = getNamedAccount(db, firmId, input.bankId, 'bank');
  const row = db.prepare(`SELECT ${statementColumns} FROM statement_rows WHERE firm_id = ? AND bank_id = ? AND id = ?`)
    .get(firmId, bank.id, id(input.rowId, 'statement row')) as StatementRow | undefined;
  check(row, 'Choose a statement row for this bank account.');
  return row;
}

function bankPosting(db: DatabaseSync, firmId: number, input: Record<string, unknown>, value: number, active: boolean) {
  const bank = getNamedAccount(db, firmId, input.bankId, 'bank', active);
  const offset = getAccount(db, firmId, input.accountId, active);
  check(bank.id !== offset.id, 'Choose a different account on the other side of this bank movement.');
  const siteId = input.siteId === null ? null : getSite(db, firmId, input.siteId);
  const kind = offset.kind === 'bank' || offset.kind === 'cash' ? 'Contra' : value > 0 ? 'Receipt' : 'Payment';
  return { kind, lines: [
    { accountId: bank.id, siteId, value },
    { accountId: offset.id, siteId, value: -value },
  ] };
}

function statementMatches(db: DatabaseSync, firmId: number, bankId: number, row: StatementRow, offset: Line,
  page: unknown, voucherId: number | null = null) {
  const rows = db.prepare(`SELECT ${voucherColumns} FROM vouchers v ${voucherReversal}
    WHERE v.firm_id = $firm AND v.day = $day AND v.reverses_id IS NULL AND v.kind <> 'Opening balance'
      AND r.id IS NULL AND ($voucher IS NULL OR v.id = $voucher)
      AND NOT EXISTS (SELECT 1 FROM statement_rows s
        WHERE s.firm_id = v.firm_id AND s.bank_id = $bank AND s.voucher_id = v.id AND s.id <> $row)
      AND EXISTS (
        SELECT SUM(l.value) FROM posting_lines l WHERE l.firm_id = v.firm_id AND l.voucher_id = v.id
        HAVING SUM(l.value) FILTER (WHERE l.account_id = $bank) = -$offsetValue
          AND SUM(l.value) FILTER (WHERE l.account_id = $offsetAccount AND l.site_id IS $site) = $offsetValue
          AND COUNT(*) FILTER (WHERE l.account_id = $bank AND l.site_id IS NOT NULL AND l.site_id IS NOT $site) = 0
      )
    ORDER BY v.id DESC LIMIT $limit OFFSET $skip`).all({
      firm: firmId, day: row.day, bank: bankId, row: row.id, offsetAccount: offset.accountId,
      offsetValue: offset.value, site: offset.siteId, voucher: voucherId, limit: PAGE_SIZE + 1, skip: pageOffset(page),
    }) as Voucher[];
  return { rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

function getStatementMatches(db: DatabaseSync, firmId: number, input: Record<string, unknown>) {
  const row = getStatement(db, firmId, input);
  const { lines: [bank, offset] } = bankPosting(db, firmId, input, row.value, false);
  return statementMatches(db, firmId, bank.accountId, row, offset, input.page);
}

function confirmStatement(db: DatabaseSync, firmId: number, input: Record<string, unknown>) {
  const requestId = requestKey(input.requestId);
  const chosen = input.voucherId === null ? null : id(input.voucherId, 'voucher');
  return transaction(db, () => {
    const row = getStatement(db, firmId, input);
    const key = 'statement:' + row.id + ':' + requestId;
    const { kind, lines } = bankPosting(db, firmId, input, row.value, chosen === null && row.voucherId === null);
    const [bank, offset] = lines;
    const prior = chosen === null ? db.prepare('SELECT id FROM vouchers WHERE firm_id = ? AND request_id = ?')
      .get(firmId, key)?.id : chosen;
    if (row.voucherId !== null) {
      check(prior === row.voucherId &&
        statementMatches(db, firmId, bank.accountId, row, offset, undefined, row.voucherId).rows.length === 1,
      'This statement row is already linked to a voucher.');
      return getVoucher(db, firmId, row.voucherId);
    }
    check(chosen !== null || prior === undefined, 'The previous posting was reversed. Reopen this row to post it again.');
    if (chosen !== null) {
      check(statementMatches(db, firmId, bank.accountId, row, offset, undefined, chosen).rows.length === 1,
        'That voucher is unavailable or does not match this bank movement, account and site.');
    }
    check(!getNamedAccount(db, firmId, bank.accountId, 'bank').archived, 'Choose an active bank account to review rows.');
    const voucherId = chosen ?? writeVoucher(db, firmId, key, { kind, day: row.day, memo: row.description, lines });
    db.prepare('UPDATE statement_rows SET voucher_id = ? WHERE firm_id = ? AND id = ?').run(voucherId, firmId, row.id);
    return getVoucher(db, firmId, voucherId);
  });
}

export function runAccountingCommand(db: DatabaseSync, firm: { id: number; archived: boolean }, command: BookCommand): BookResult {
  const firmId = firm.id;
  if (command.operation === 'getChart') return getChart(db, firmId);
  if (command.operation === 'getContractors') return getContractors(db, firmId);
  if (command.operation === 'getCashbooks') {
    return db.prepare(cashbookRows + ' ORDER BY a.name, a.id').all(firmId) as Cashbook[];
  }
  const input = fields(command.input);
  switch (command.operation) {
    case 'createAccount':
      check(!firm.archived, 'Choose an active firm to create accounts.');
      return createAccount(db, firmId, input);
    case 'saveContractor':
      check(!firm.archived, 'Choose an active firm to save contractors.');
      return saveContractor(db, firmId, input);
    case 'removeContractor':
      check(!firm.archived, 'Choose an active firm to remove contractors.');
      return removeContractor(db, firmId, input.accountId);
    case 'getContractorLedger': return getLedger(db, firmId, input, true);
    case 'createCashbook': return createCashbook(db, firm, input);
    case 'removeCashbook':
      check(!firm.archived, 'Choose an active funding firm to remove cashbooks.');
      return removeCashbook(db, firmId, input.accountId);
    case 'getCashbookLedger': return getCashbookLedger(db, firmId, input);
    case 'saveCashbookCustodian':
      check(!firm.archived, 'Choose an active funding firm to change custodians.');
      return saveCashbookCustodian(db, firmId, input);
    case 'getNamedAccounts': return getNamedAccounts(db, firmId, namedKind(input.kind));
    case 'saveNamedAccount':
    case 'removeNamedAccount':
      check(!firm.archived, 'Choose an active firm to manage its accounts.');
      return command.operation === 'saveNamedAccount' ? saveNamedAccount(db, firmId, input) : removeNamedAccount(db, firmId, input);
    case 'getEmployeeLedger': return getEmployeeLedger(db, firmId, input);
    case 'postEmployee': return post(db, firm, input, 'employee');
    case 'postBank': return post(db, firm, input, 'bank');
    case 'previewStatement': return previewStatement(input);
    case 'importStatement':
    case 'confirmStatement':
      check(!firm.archived, 'Choose an active firm to review bank statements.');
      return command.operation === 'importStatement' ? importStatement(db, firmId, input) : confirmStatement(db, firmId, input);
    case 'getStatements': return getStatements(db, firmId, input);
    case 'getStatement': return getStatement(db, firmId, input);
    case 'getStatementMatches': return getStatementMatches(db, firmId, input);
    case 'postVoucher': return post(db, firm, input, 'voucher');
    case 'reverseVoucher': return post(db, firm, input, 'reversal');
    case 'getVoucher': return getVoucher(db, firmId, input.voucherId);
    case 'getDayBook': return getDayBook(db, firmId, input);
    case 'getLedger': return getLedger(db, firmId, input);
    case 'getTrialBalance': return getTrialBalance(db, firmId, input);
  }
}

export function replayDemo(db: DatabaseSync, firmId: number, snapshot: string) {
  const fixture = JSON.parse(snapshot) as {
    accounts: (Account & { detail: object })[];
    sites: Site[];
    assigned: { account: number; site: number }[];
    vouchers: { id: number; day: string; kind: string; memo: string; amount: number; document: unknown;
      reverses: number | null; lines: { account: number; site: number | null; value: number }[] }[];
  };
  const account = db.prepare('INSERT INTO accounts (id, firm_id, name, kind, archived, system, detail) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const row of fixture.accounts) account.run(row.id, firmId, row.name, row.kind, row.archived, row.system, JSON.stringify(row.detail));
  const site = db.prepare('INSERT INTO sites (id, firm_id, name) VALUES (?, ?, ?)');
  for (const row of fixture.sites) site.run(row.id, firmId, row.name);
  const assignment = db.prepare('INSERT INTO site_assignments VALUES (?, ?, ?)');
  for (const row of fixture.assigned) assignment.run(firmId, row.account, row.site);
  for (const voucher of fixture.vouchers.sort((a, b) => a.id - b.id)) {
    writeVoucher(db, firmId, `prototype:${voucher.id}`, {
      day: voucher.day, kind: voucher.kind, memo: voucher.memo, document: voucher.document,
      sourceId: voucher.id, sourceAmount: voucher.amount, reversesId: voucher.reverses,
      lines: voucher.lines.map(line => ({ accountId: line.account, siteId: line.site, value: line.value })),
    });
  }
}
