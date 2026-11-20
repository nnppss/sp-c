import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { BookOperation, BooksBridge, PostVoucher } from '../desktop/books';
import type { WorkspaceKind } from '../desktop/workspace';
import baseline from '../fixtures/prototype-2026-11-20.json';

const require = createRequire(import.meta.url);
const { openWorkspace, readWorkspace, runBookCommand, runWorkspaceCommand } =
  require('../dist/desktop/database.js') as typeof import('../desktop/database');

const fixture = resolve('fixtures/prototype-2026-11-20.json');
const today = baseline.seedDate;
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'sp-accounting-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

function books(db: DatabaseSync, kind: WorkspaceKind, firmId: number) {
  return <K extends BookOperation>(operation: K, ...args: Parameters<BooksBridge[K]> extends
    [WorkspaceKind, number, ...infer Input] ? Input : never) =>
    runBookCommand(db, { operation, kind, firmId, input: args[0] }) as Awaited<ReturnType<BooksBridge[K]>>;
}

function firm(db: DatabaseSync, kind: WorkspaceKind, name: string) {
  return runWorkspaceCommand(db, { kind, operation: 'saveFirm', id: null, details: { name, owner: '', address: '', gstin: '' } })
    .firms.find(firm => firm.name === name)!.id;
}

test('cashbooks reconcile dated custody transfers, expenses and payees to shared vouchers after reopening', () => {
  const db = openWorkspace(directory, 'live', fixture);
  const company = firm(db, 'live', 'Sample construction');
  const vendor = runWorkspaceCommand(db, {
    kind: 'live', operation: 'saveFirm', id: null,
    details: { name: 'Vikram Enterprises', owner: 'Vikram', address: '', gstin: '' },
  }).firms.find(firm => firm.name === 'Vikram Enterprises')!.id;
  const run = books(db, 'live', company);
  const openingDate = '2026-11-17';
  const handoverDate = '2026-11-18';
  const expenseDate = '2026-11-19';
  const returnDate = '2026-11-20';
  let siteId: number;
  let paymentId: number;
  try {
    const expense = run('createAccount', { kind: 'expense', name: 'Site expense' });
    const bank = run('createAccount', { kind: 'bank', name: 'Main bank' });
    run('postVoucher', { kind: 'Opening balance', accountId: bank.id, value: 100_000, requestId: 'bank', day: openingDate, memo: '' });
    const officeDraft = { name: 'Office cash', custodian: 'Office accountant', openedOn: openingDate, openingCash: 2_000_000, requestId: 'office' };
    expect(() => run('createCashbook', { ...officeDraft, openingCash: -1 })).toThrow(/zero or more/);
    const office = run('createCashbook', officeDraft);
    expect(run('createCashbook', officeDraft)).toEqual(office);
    expect(() => run('createCashbook', { ...officeDraft, openingCash: 100 })).toThrow(/different cashbook/);
    const blank = { name: 'Site cash', custodian: 'Vikram', openedOn: openingDate, openingCash: 0, requestId: 'site' };
    siteId = run('createCashbook', blank).id;
    expect(run('createCashbook', blank).id).toBe(siteId);
    const site = (to?: string) => run('getCashbookLedger', { accountId: siteId, to });
    const initial = run('getCashbookLedger', { accountId: office.id, to: openingDate });
    expect(initial).toMatchObject({ closing: 2_000_000n, totalCash: 2_000_000n, rows: [{ kind: 'Opening balance', day: openingDate }] });
    expect(site(openingDate)).toMatchObject({ cashbook: { custodian: 'Vikram', openedOn: openingDate, openingCash: 0 },
      closing: 0n, totalCash: 2_000_000n, rows: [] });
    expect(site('2026-11-16')).toMatchObject({ closing: 0n, totalCash: 0n, rows: [] });
    expect(books(db, 'live', vendor)('getCashbooks')).toEqual([]);
    expect(() => books(db, 'live', vendor)('getCashbookLedger', { accountId: siteId })).toThrow(/in this firm/);

    const transfer = {
      kind: 'Contra', requestId: 'handover', day: handoverDate, memo: 'Cash for site work',
      lines: [line(siteId, 1_000_000), line(office.id, -1_000_000)],
    } satisfies PostVoucher;
    expect(() => run('postVoucher', { ...transfer, day: '2026-11-16' })).toThrow(/cashbook opening date/);
    const handover = run('postVoucher', transfer);
    expect(site(handoverDate)).toMatchObject({ closing: 1_000_000n, totalCash: 2_000_000n,
      rows: [{ voucherId: handover.id, offsets: 'Office cash', running: 1_000_000n }] });
    const payment = {
      kind: 'Payment', requestId: 'expense', day: expenseDate, memo: 'Site supplies',
      lines: [line(expense.id, 650_000), line(siteId, -650_000)],
      payee: { kind: 'Firm', firmId: vendor },
    } satisfies PostVoucher;
    const paid = run('postVoucher', payment);
    paymentId = paid.id;
    expect(run('postVoucher', payment)).toEqual(paid);
    expect(() => run('postVoucher', { ...payment, payee: { kind: 'Person', name: 'Vikram' } })).toThrow(/different voucher/);
    expect(() => run('postVoucher', { ...payment, requestId: 'missing-payee', payee: { kind: 'Firm', firmId: 999 } }))
      .toThrow(/available payee firm/);
    expect(site(expenseDate)).toMatchObject({ closing: 350_000n, totalCash: 1_350_000n });
    const returned = run('postVoucher', { ...transfer, requestId: 'return', day: returnDate, memo: 'Unused cash returned',
      lines: [line(siteId, -100_000), line(office.id, 100_000)] });
    const payee = { kind: 'Firm', firmId: vendor, name: 'Vikram Enterprises', owner: 'Vikram' };
    expect(site(returnDate)).toMatchObject({ closing: 250_000n, totalCash: 1_350_000n, rows: [
      { voucherId: handover.id, running: 1_000_000n },
      { voucherId: paid.id, running: 350_000n, payee, offsets: 'Site expense' },
      { voucherId: returned.id, running: 250_000n },
    ] });
    expect(run('getVoucher', { voucherId: paid.id })).toMatchObject({ payee, lines: payment.lines });
    const officeLedger = run('getCashbookLedger', { accountId: office.id });
    expect(officeLedger.closing).toBe(1_100_000n);
    expect(officeLedger.rows.map(row => row.voucherId)).toEqual([initial.rows[0].voucherId, handover.id, returned.id]);
    expect(run('getTrialBalance', {}).rows.find(row => row.id === expense.id)?.balance).toBe(650_000n);

    const person = run('postVoucher', { ...payment, day: '2026-11-21', requestId: 'person', payee: { kind: 'Person', name: 'Meena' },
      lines: [line(expense.id, 100), line(siteId, -100)] });
    expect(site().rows.at(-1)?.payee).toEqual({ kind: 'Person', name: 'Meena' });
    const reversal = run('reverseVoucher', { requestId: 'reverse-person', voucherId: person.id, day: '2026-11-21', memo: 'Correct duplicate payment' });
    expect(reversal.payee).toEqual(person.payee);
    expect(site()).toMatchObject({ closing: 250_000n, totalCash: 1_350_000n });
    const unused = run('createCashbook', { ...blank, name: 'Unused cashbook', requestId: 'unused' });
    expect(run('removeCashbook', { accountId: unused.id })).toEqual({ archived: false });
    expect(run('getCashbooks')).toHaveLength(2);
    expect(run('removeCashbook', { accountId: siteId })).toEqual({ archived: true });
    expect(run('getCashbookLedger', { accountId: siteId }).cashbook.archived).toBe(1);
    runWorkspaceCommand(db, { kind: 'live', operation: 'removeFirm', id: vendor });
    expect(readWorkspace(db).firms.find(firm => firm.id === vendor)?.archived).toBe(true);
    expect(run('postVoucher', payment)).toEqual(paid);
  } finally {
    db.close();
  }
  const reopened = openWorkspace(directory, 'live', fixture);
  try {
    const saved = books(reopened, 'live', company);
    expect(saved('getCashbookLedger', { accountId: siteId, to: returnDate })).toMatchObject({
      cashbook: { custodian: 'Vikram', archived: 1 }, closing: 250_000n, totalCash: 1_350_000n,
    });
    expect(saved('getVoucher', { voucherId: paymentId }).payee).toMatchObject({ firmId: vendor, owner: 'Vikram' });
  } finally {
    reopened.close();
  }
});

function line(accountId: number, value: number, siteId: number | null = null) {
  return { accountId, siteId, value };
}

test('replays every fixture voucher through the desktop ledger and reconciles each account and site', () => {
  const db = openWorkspace(directory, 'demo', fixture);
  const run = books(db, 'demo', 1);
  try {
    const firstPage = run('getDayBook', {});
    const lastPage = run('getDayBook', { page: 1 });
    const vouchers = [...firstPage.rows, ...lastPage.rows];
    expect(firstPage.hasNext).toBe(true);
    expect(lastPage.hasNext).toBe(false);
    expect(vouchers.map(({ id }) => id)).toEqual(baseline.vouchers.map(({ id }) => id));
    for (const original of baseline.vouchers) {
      expect(run('getVoucher', { voucherId: original.id })).toMatchObject({
        day: original.day, kind: original.kind, memo: original.memo, amount: original.amount,
        reversesId: original.reverses, lines: original.lines.map(item => line(item.account, item.value, item.site)),
      });
      if (original.document) {
        const row = db.prepare('SELECT document FROM vouchers WHERE id = ?').get(original.id);
        expect(JSON.parse(String(row?.document))).toEqual(original.document);
      }
    }
    const trial = run('getTrialBalance', {});
    expect(trial.debit).toBe(219_800_000n);
    expect(trial.credit).toBe(219_800_000n);
    expect(trial.rows.map(({ id, balance }) => ({ account: id, value: Number(balance) })).sort((a, b) => a.account - b.account))
      .toEqual(baseline.balances);
    const actualSiteBalances: typeof baseline.siteBalances = [];
    for (const { account, value } of baseline.balances) {
      expect(run('getLedger', { accountId: account }).closing).toBe(BigInt(value));
      for (const { id: site } of baseline.sites) {
        const report = run('getLedger', { accountId: account, siteId: site });
        if (report.rows.length) actualSiteBalances.push({ account, site, value: Number(report.closing) });
      }
    }
    expect(actualSiteBalances).toHaveLength(baseline.siteBalances.length);
    expect(actualSiteBalances).toEqual(expect.arrayContaining(baseline.siteBalances));
    expect(db.prepare('SELECT COUNT(*) AS count FROM site_assignments').get()).toEqual({ count: baseline.assigned.length });

    const period = run('getLedger', { accountId: 13, from: today, to: today });
    expect(period.opening).toBe(92_450_000n);
    expect(period.rows).toMatchObject([{ voucherId: 40, running: 89_450_000n }]);
    expect(period.closing).toBe(89_450_000n);
    expect(run('getTrialBalance', { to: '2026-11-19' }).rows.find(({ id }) => id === 13)?.balance).toBe(period.opening);
  } finally {
    db.close();
  }
  const reopened = openWorkspace(directory, 'demo', join(directory, 'missing.json'));
  try {
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM vouchers').get()).toEqual({ count: 40 });
  } finally {
    reopened.close();
  }
});

test('posts openings, payments, receipts, contra and journals in exact paise and rejects invalid lines', () => {
  const db = openWorkspace(directory, 'live', fixture);
  const run = books(db, 'live', firm(db, 'live', 'Firm A'));
  try {
    const bank = run('createAccount', { kind: 'bank', name: 'Main bank' });
    const cash = run('createAccount', { kind: 'cash', name: 'Office cash' });
    const expense = run('createAccount', { kind: 'expense', name: 'Supplies' });
    expect(() => run('createAccount', { kind: 'bank', name: ' main Bank ' })).toThrow(/already exists/);
    const opening = { requestId: 'opening', day: today, memo: '', kind: 'Opening balance', accountId: bank.id, value: 200_001 } as const;
    const opened = run('postVoucher', opening);
    expect(run('postVoucher', opening)).toEqual(opened);
    expect(opened.lines[1].value).toBe(-200_001);
    const payment = { requestId: 'payment', day: today, memo: 'Supplies', kind: 'Payment', lines: [line(expense.id, 9_975), line(bank.id, -9_975)] } satisfies PostVoucher;
    expect(() => run('postVoucher', { ...payment, day: '2026-11-31' })).toThrow(/valid date/);
    expect(() => run('postVoucher', { ...payment, lines: [line(expense.id, 1.2), line(bank.id, -1.2)] })).toThrow(/integer paise/);
    expect(() => run('postVoucher', { ...payment, lines: [line(expense.id, 101), line(bank.id, -100)] })).toThrow(/balance/);
    expect(() => run('postVoucher', { ...payment, kind: 'Receipt' })).toThrow(/must increase/);
    expect(() => run('postVoucher', { ...payment, kind: 'Contra' })).toThrow(/only bank and cash/);
    expect(() => run('postVoucher', { ...payment, lines: [line(bank.id, 1), line(bank.id, -1)] })).toThrow(/different accounts/);
    const paid = run('postVoucher', payment);
    expect(run('postVoucher', payment)).toEqual(paid);
    expect(() => run('postVoucher', { ...payment, memo: 'Different memo' })).toThrow(/request ID.+different voucher/);
    run('postVoucher', { ...payment, kind: 'Receipt', requestId: 'receipt', lines: [line(cash.id, 4_500), line(expense.id, -4_500)] });
    run('postVoucher', { ...payment, kind: 'Contra', requestId: 'contra', lines: [line(cash.id, 10_000), line(bank.id, -10_000)] });
    run('postVoucher', { ...payment, kind: 'Journal', requestId: 'journal', lines: [line(expense.id, 25), line(cash.id, -25)] });
    const trial = run('getTrialBalance', {});
    expect(trial.rows.find(row => row.id === bank.id)?.balance).toBe(180_026n);
    expect(trial.rows.find(row => row.id === cash.id)?.balance).toBe(14_475n);
    expect(trial.rows.find(row => row.id === expense.id)?.balance).toBe(5_500n);
    expect([trial.debit, trial.credit]).toEqual([200_001n, 200_001n]);
    expect(run('getDayBook', {}).rows).toHaveLength(5);
  } finally {
    db.close();
  }
});

test('rejects cross-firm accounts, sites, reads and reversals and reverses assigned lines only once', () => {
  const db = openWorkspace(directory, 'demo', fixture);
  const run = books(db, 'demo', 1);
  const otherFirm = firm(db, 'demo', 'Firm B');
  const other = books(db, 'demo', otherFirm);
  try {
    const bank = other('createAccount', { kind: 'bank', name: 'Bank B' });
    const cash = other('createAccount', { kind: 'cash', name: 'Cash B' });
    const payment: PostVoucher = { requestId: 'payment', day: today, memo: 'Yamuna', kind: 'Payment', lines: [
      line(17, 500_025, 1), line(13, -500_025, 1),
    ] };
    expect(() => run('postVoucher', { ...payment, lines: [line(17, 500_025, 1), line(bank.id, -500_025)] }))
      .toThrow(/account in this firm/);
    expect(() => other('postVoucher', { ...payment, kind: 'Contra', lines: [line(cash.id, 500_025, 1), line(bank.id, -500_025)] }))
      .toThrow(/site in this firm/);
    expect(() => run('postVoucher', { ...payment, lines: [line(18, 500_025, 2), line(13, -500_025, 2)] }))
      .toThrow(/assigned site/);
    expect(() => other('getLedger', { accountId: 13 })).toThrow(/account in this firm/);
    expect(other('getDayBook', {}).rows).toEqual([]);
    const original = run('postVoucher', payment);
    const reversal = { requestId: 'reversal', voucherId: original.id, day: '2026-11-21', memo: 'Incorrect beneficiary' };
    expect(() => other('getVoucher', { voucherId: original.id })).toThrow(/voucher in this firm/);
    expect(() => other('reverseVoucher', reversal)).toThrow(/voucher in this firm/);
    expect(() => run('reverseVoucher', { ...reversal, day: '2026-11-19' })).toThrow(/on or after/);
    expect(run('getLedger', { accountId: 17, siteId: 1 }).closing).toBe(-1_299_975n);
    const reversed = run('reverseVoucher', reversal);
    expect(reversed.reversesId).toBe(original.id);
    expect(reversed.lines).toEqual(original.lines.map(line => ({ ...line, value: -line.value })));
    expect(run('reverseVoucher', reversal)).toEqual(reversed);
    expect(() => run('reverseVoucher', { ...reversal, requestId: 'second' })).toThrow(/already has a reversal/);
    expect(() => run('reverseVoucher', { ...reversal, voucherId: reversed.id, requestId: 'third' })).toThrow(/original voucher/);
    expect(run('getVoucher', { voucherId: original.id }).reversedById).toBe(reversed.id);
    expect(run('getLedger', { accountId: 17, siteId: 1 }).closing).toBe(-1_800_000n);
    expect(run('getLedger', { accountId: 17, siteId: 1, to: today }).closing).toBe(-1_299_975n);

    runWorkspaceCommand(db, { kind: 'demo', operation: 'removeFirm', id: 1 });
    expect(readWorkspace(db).firms[0].archived).toBe(true);
    expect(run('getVoucher', { voucherId: original.id }).reversedById).toBe(reversed.id);
    expect(() => run('postVoucher', { ...payment, requestId: 'after-archive' })).toThrow(/active firm/);
  } finally {
    db.close();
  }
});

test('a process killed after the header and first line leaves no partial voucher and the same request can be retried', () => {
  const db = openWorkspace(directory, 'live', fixture);
  const a = firm(db, 'live', 'Interruption books');
  const run = books(db, 'live', a);
  const cash = run('createAccount', { kind: 'cash', name: 'Cash' });
  const expense = run('createAccount', { kind: 'expense', name: 'Expense' });
  const payment = { requestId: 'interrupted', kind: 'Payment', day: today, memo: '', lines: [line(expense.id, 100), line(cash.id, -100)] } satisfies PostVoucher;
  db.exec(`CREATE TRIGGER interrupt BEFORE INSERT ON posting_lines WHEN NEW.value < 0
    BEGIN SELECT kill_writer(); END;`);
  db.close();

  const child = spawnSync(process.execPath, ['-e', `
    const { openWorkspace, runBookCommand } = require(process.argv[1]);
    const db = openWorkspace(process.argv[2], 'live', process.argv[3]);
    db.function('kill_writer', () => {
      const header = db.prepare('SELECT COUNT(*) AS count FROM vouchers').get();
      const lines = db.prepare('SELECT COUNT(*) AS count FROM posting_lines').get();
      if (header.count !== 1 || lines.count !== 1) process.exit(3);
      if (process.platform === 'win32') process.exit(93);
      process.kill(process.pid, 'SIGKILL');
    });
    runBookCommand(db, JSON.parse(process.argv[4]));
  `, resolve('dist/desktop/database.js'), directory, fixture, JSON.stringify({
    operation: 'postVoucher', kind: 'live', firmId: a, input: payment,
  })], { encoding: 'utf8', timeout: 10_000 });
  if (process.platform === 'win32') expect(child.status, child.stderr).toBe(93);
  else expect(child.signal, child.stderr).toBe('SIGKILL');

  const reopened = openWorkspace(directory, 'live', fixture);
  const retry = books(reopened, 'live', a);
  let committedId: number;
  try {
    expect(retry('getDayBook', {}).rows).toEqual([]);
    expect(reopened.prepare('SELECT COUNT(*) AS count FROM posting_lines').get()).toEqual({ count: 0 });
    reopened.exec('DROP TRIGGER interrupt');
    const voucher = retry('postVoucher', payment);
    committedId = voucher.id;
    expect(retry('postVoucher', payment)).toEqual(voucher);
    expect(retry('getDayBook', {}).rows).toHaveLength(1);
    expect(voucher.lines).toEqual(payment.lines);
  } finally {
    reopened.close();
  }
  const restarted = openWorkspace(directory, 'live', fixture);
  try {
    expect(books(restarted, 'live', a)('postVoucher', payment).id).toBe(committedId);
    expect(restarted.prepare('SELECT COUNT(*) AS count FROM posting_lines').get()).toEqual({ count: 2 });
  } finally {
    restarted.close();
  }
});

test('contractors share sites and trace a split payment, refund, settlement and reversal through one ledger', () => {
  const db = openWorkspace(directory, 'live', fixture);
  const run = books(db, 'live', firm(db, 'live', 'Contractor sample'));
  const other = books(db, 'live', firm(db, 'live', 'Separate books'));
  try {
    const bank = run('createAccount', { kind: 'bank', name: 'Main bank' });
    const cash = run('createAccount', { kind: 'cash', name: 'Office cash' });
    const expense = run('createAccount', { kind: 'expense', name: 'Contract work' });
    const anuj = run('saveContractor', { id: null, name: 'Anuj', siteIds: [], newSites: ['Yamuna', 'Bodla'] });
    const { contractors, sites } = run('getContractors');
    const yamuna = sites.find(site => site.name === 'Yamuna')!.id;
    const bodla = sites.find(site => site.name === 'Bodla')!.id;
    expect(contractors).toMatchObject([{ id: anuj.id, siteIds: [yamuna, bodla] }]);
    expect(() => other('saveContractor', { id: null, name: 'Anuj', siteIds: [yamuna], newSites: ['Other site'] }))
      .toThrow(/site in this firm/);
    expect(other('getContractors')).toEqual({ contractors: [], sites: [] });

    const payment = { requestId: 'split', kind: 'Payment', day: today, memo: 'Two sites', lines: [
      line(anuj.id, 3_000_000, yamuna), line(anuj.id, 1_000_000, bodla), line(bank.id, -4_000_000),
    ] } satisfies PostVoucher;
    const paid = run('postVoucher', payment);
    expect(run('postVoucher', payment)).toEqual(paid);
    const refund = run('postVoucher', { requestId: 'return', kind: 'Receipt', day: today, memo: 'Bodla cash returned', lines: [
      line(anuj.id, -200_000, bodla), line(cash.id, 200_000),
    ] });
    expect(run('getLedger', { accountId: bank.id }).rows).toMatchObject([{ voucherId: paid.id, value: -4_000_000 }]);
    const ledger = () => run('getContractorLedger', { accountId: anuj.id });
    const before = ledger();
    expect(before.money).toEqual({ given: 4_000_000n, received: 200_000n, balance: 3_800_000n });
    expect(before.rows).toMatchObject([
      { voucherId: paid.id, siteId: yamuna, method: 'Bank', given: 3_000_000, received: 0, running: 3_000_000n },
      { voucherId: paid.id, siteId: bodla, method: 'Bank', given: 1_000_000, received: 0, running: 4_000_000n },
      { voucherId: refund.id, siteId: bodla, method: 'Cash', given: 0, received: 200_000, running: 3_800_000n },
    ]);
    expect(run('getContractorLedger', { accountId: anuj.id, siteId: yamuna }).closing).toBe(3_000_000n);
    expect(run('getContractorLedger', { accountId: anuj.id, siteId: bodla }).rows[1].running).toBe(800_000n);
    expect(run('getVoucher', { voucherId: before.rows[1].voucherId })).toEqual(paid);

    const ravi = run('saveContractor', { id: null, name: 'Ravi', siteIds: [], newSites: ['yamuna'] });
    expect(run('getContractors').contractors.find(account => account.id === ravi.id)?.siteIds).toEqual([yamuna]);
    expect(ledger()).toEqual(before);
    expect(() => run('saveContractor', { id: anuj.id, name: 'RAVI', siteIds: [], newSites: ['Unused site'] })).toThrow(/already exists/);
    expect(run('getContractors')).toMatchObject({ contractors: [{ name: 'Anuj', siteIds: [yamuna, bodla] }, { name: 'Ravi' }], sites });
    expect(run('removeContractor', { accountId: ravi.id })).toEqual({ archived: false });
    expect(run('getContractors').contractors).toHaveLength(1);

    const settled = run('postVoucher', { requestId: 'settle', day: '2026-11-21', kind: 'Journal', memo: 'Agreed work', lines: [
      line(anuj.id, -3_000_000, yamuna), line(expense.id, 3_000_000),
    ] });
    expect(ledger().money).toEqual({ given: 4_000_000n, received: 200_000n, balance: 800_000n });
    expect(ledger().rows.at(-1)).toMatchObject({ voucherId: settled.id, method: 'Noncash', given: 0, received: 0 });
    expect(run('saveContractor', { id: anuj.id, name: 'Anuj Kumar', siteIds: [bodla], newSites: [] }).id).toBe(anuj.id);
    expect(run('getContractorLedger', { accountId: anuj.id, siteId: yamuna }).rows).toHaveLength(2);
    expect(() => run('postVoucher', { ...payment, requestId: 'unassigned' })).toThrow(/assigned site/);
    expect(run('removeContractor', { accountId: anuj.id })).toEqual({ archived: true });
    expect(run('getContractors').contractors).toMatchObject([{ id: anuj.id, name: 'Anuj Kumar', archived: 1, siteIds: [bodla] }]);
    expect(() => run('postVoucher', { ...payment, requestId: 'archived' })).toThrow(/available account/);
    expect(() => other('getContractorLedger', { accountId: anuj.id })).toThrow(/account in this firm/);
    run('reverseVoucher', { requestId: 'reverse', day: '2026-11-22', voucherId: paid.id, memo: 'Correction' });
    expect(ledger().money).toEqual({ given: 0n, received: 200_000n, balance: -3_200_000n });
    expect(ledger().rows.at(-1)).toMatchObject({ kind: 'Reversal', given: -1_000_000, received: 0, method: 'Bank' });
  } finally {
    db.close();
  }
});

test('employee payroll and advances settle separately from cash custody and reimbursements', () => {
  const db = openWorkspace(directory, 'live', fixture);
  try {
    const company = firm(db, 'live', 'Payroll sample');
    const other = firm(db, 'live', 'Other firm');
    const run = books(db, 'live', company);
    const employee = run('saveNamedAccount', { id: null, kind: 'employee', name: 'Vikram', role: 'Site supervisor', number: '' });
    const bank = run('createAccount', { kind: 'bank', name: 'Bank' });
    const expense = run('createAccount', { kind: 'expense', name: 'Site supplies' });
    const office = run('createCashbook', { name: 'Office cash', custodian: 'Office', openedOn: today,
      openingCash: 2_000_000, requestId: 'office' });
    const cash = run('createCashbook', { name: 'Site cash', custodian: '', employeeId: employee.id, openedOn: today,
      openingCash: 0, requestId: 'site' });
    expect(() => books(db, 'live', other)('createCashbook', { name: 'Other cash', custodian: '', employeeId: employee.id,
      openedOn: today, openingCash: 0, requestId: 'other-cash' })).toThrow('available account');
    const handover = run('postVoucher', { kind: 'Contra', day: today, requestId: 'handover', memo: '',
      lines: [{ accountId: office.id, siteId: null, value: -250_000 }, { accountId: cash.id, siteId: null, value: 250_000 }] });
    const payroll = { day: today, accountId: employee.id, memo: '' };
    const advance = { ...payroll, action: 'Salary advance', amount: 200_000, fundingId: bank.id, requestId: 'advance' } as const;
    const originalAdvance = run('postEmployee', advance);
    expect(run('postEmployee', advance)).toEqual(originalAdvance);
    const ledger = () => run('getEmployeeLedger', { accountId: employee.id });
    expect(ledger().advances?.closing).toBe(200_000n);
    expect(ledger().personal.closing).toBe(0n);
    run('postEmployee', { ...payroll, action: 'Salary earned', amount: 2_400_000, requestId: 'salary' });
    const apply = { ...payroll, action: 'Apply advance', amount: 200_000, requestId: 'apply' } as const;
    expect(() => run('postEmployee', { ...apply, amount: 200_001 })).toThrow('exceeds');
    run('postEmployee', apply);
    expect(ledger().personal.closing).toBe(-2_200_000n);
    expect(ledger().advances?.closing).toBe(0n);
    run('postEmployee', { ...payroll, action: 'Salary payment', amount: 2_200_000, fundingId: bank.id, requestId: 'payment' });
    const repayment = { ...payroll, action: 'Advance repayment', amount: 10_000, fundingId: office.id, requestId: 'repayment' } as const;
    expect(() => run('postEmployee', repayment)).toThrow('exceeds');
    run('postEmployee', { ...advance, amount: 10_000, requestId: 'new-advance' });
    run('postEmployee', repayment);
    const reimbursement = run('postEmployee', { ...payroll, action: 'Reimbursement', amount: 50_000, offsetId: expense.id,
      fundingId: bank.id, requestId: 'reimbursement' });
    expect(reimbursement.amount).toBe(50_000);
    expect(ledger().personal.rows.find(row => row.voucherId === reimbursement.id)).toMatchObject({ value: 0, reimbursement: 50_000 });
    const reversal = run('reverseVoucher', { voucherId: reimbursement.id, requestId: 'reverse-reimbursement', day: today, memo: 'Correction' });
    expect(ledger().personal.rows.find(row => row.voucherId === reversal.id)).toMatchObject({ value: 0, reimbursement: -50_000 });
    const adjustment = { ...payroll, action: 'Manual adjustment', amount: 5_000, offsetId: expense.id } as const;
    run('postEmployee', { ...adjustment, reducePayable: false, requestId: 'adjust' });
    run('postEmployee', { ...adjustment, reducePayable: true, requestId: 'undo-adjustment' });
    expect(ledger().personal.closing).toBe(0n);
    expect(ledger().advances?.closing).toBe(0n);
    expect(run('getTrialBalance', {}).rows.find(row => row.system === 'salary')?.balance).toBe(2_400_000n);
    const renamed = run('saveNamedAccount', { ...employee, kind: 'employee', name: 'Vikram Sharma' });
    expect(renamed.id).toBe(employee.id);
    expect(run('getCashbooks').find(book => book.id === cash.id)).toMatchObject({ employeeId: employee.id, custodian: 'Vikram Sharma' });
    expect(run('getCashbookLedger', { accountId: cash.id })).toMatchObject({
      closing: 250_000n, rows: [{ voucherId: handover.id }],
    });
    expect(run('removeNamedAccount', { kind: 'employee', accountId: employee.id })).toEqual({ archived: true });
    expect(ledger().personal.closing).toBe(0n);
  } finally {
    db.close();
  }
});

test('statement imports preserve multiplicity and confirmation links exactly one eligible bank movement', async () => {
  const SheetJS = await import('xlsx');
  let db = openWorkspace(directory, 'live', fixture);
  try {
    const company = firm(db, 'live', 'Bank sample');
    const other = firm(db, 'live', 'Other bank firm');
    let run = books(db, 'live', company);
    const bank = run('saveNamedAccount', { id: null, name: 'HDFC Bank', role: 'Current', number: '004821', kind: 'bank' });
    const anuj = run('saveContractor', { id: null, name: 'Anuj', siteIds: [], newSites: ['Yamuna', 'Bodla'] });
    const site = run('getChart').sites.find(site => site.name === 'Yamuna')!;
    const bodla = run('getChart').sites.find(site => site.name === 'Bodla')!;
    const accountId = bank.id;
    const movement = { bankId: bank.id, accountId: anuj.id, day: today, siteId: site.id, value: -500_000 };
    const existing = run('postBank', { ...movement, memo: 'Existing payment', requestId: 'manual' });
    const wrongSite = run('postBank', { ...movement, siteId: bodla.id, memo: 'Bodla payment', requestId: 'wrong-site' });
    const signedMapping = { date: 0, description: 1, reference: 2, amount: 3 };
    const csv = (data: string) => ({ filename: 'statement.csv', bytes: new TextEncoder().encode(data).buffer as ArrayBuffer });
    const first = 'Date,Description,Reference,Amount\n20/11/2026,Anuj at Yamuna,0001,"(5,000.00)"\n';
    const initial = { ...csv(first), accountId, mapping: signedMapping };
    expect(run('previewStatement', initial).rows[0]).toEqual(['20/11/2026', 'Anuj at Yamuna', '0001', '(5,000.00)']);
    expect(run('importStatement', initial)).toEqual({ added: 1, existing: 0 });
    expect(run('importStatement', initial)).toEqual({ added: 0, existing: 1 });
    expect(() => run('importStatement', { ...initial, ...csv(first +
      '2026-11-19,Valid row,0002,-2\n2026-11-31,Malformed date,0003,1\n') })).toThrow('Row 4: Enter a valid date.');
    expect(run('getStatements', { accountId }).rows).toHaveLength(1);
    expect(() => books(db, 'live', other)('getStatements', { accountId })).toThrow('available account');

    const sheet = SheetJS.utils.aoa_to_sheet([
      ['Date', 'Description', 'Reference', 'Debit', 'Credit'],
      [new Date('2026-11-20T00:00:00Z'), 'Anuj at Yamuna', '0001', 5000, null],
      [new Date('2026-11-20T00:00:00Z'), 'Anuj at Yamuna', '0001', 5000, null],
      [new Date('2026-11-21T00:00:00Z'), 'Unreviewed receipt', '0002', null, 12.5],
    ], { UTC: true });
    const workbook = SheetJS.utils.book_new();
    SheetJS.utils.book_append_sheet(workbook, SheetJS.utils.aoa_to_sheet([['Info'], ['Read me']]), 'Info');
    SheetJS.utils.book_append_sheet(workbook, sheet, 'Movements');
    const overlap = { filename: 'overlap.xlsx', bytes: SheetJS.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
      sheet: 'Movements', accountId, mapping: { date: 0, description: 1, reference: 2, debit: 3, credit: 4 } };
    expect(run('previewStatement', overlap).sheets).toEqual(['Info', 'Movements']);
    expect(run('importStatement', overlap)).toEqual({ added: 2, existing: 1 });
    expect(run('importStatement', overlap)).toEqual({ added: 0, existing: 3 });
    expect(run('getLedger', { accountId }).closing).toBe(-1_000_000n);
    const payments = run('getStatements', { accountId }).rows.filter(row => row.value === -500_000);
    expect(payments).toHaveLength(2);
    const review = { bankId: accountId, rowId: payments[0].id, accountId: anuj.id, siteId: site.id };
    expect(run('getStatementMatches', review).rows.map(row => row.id)).toEqual([existing.id]);
    expect(() => run('confirmStatement', { ...review, requestId: 'wrong', voucherId: wrongSite.id })).toThrow('does not match');
    expect(run('confirmStatement', { ...review, requestId: 'match', voucherId: existing.id }).id).toBe(existing.id);
    expect(run('getLedger', { accountId }).closing).toBe(-1_000_000n);
    const post = { ...review, rowId: payments[1].id, voucherId: null, requestId: 'statement-post' };
    expect(run('getStatementMatches', post).rows).toEqual([]);
    const created = run('confirmStatement', post);
    expect(run('confirmStatement', post).id).toBe(created.id);
    expect(run('getLedger', { accountId }).rows.some(row => row.voucherId === created.id)).toBe(true);
    expect(run('getContractorLedger', { accountId: anuj.id, siteId: site.id }).rows.map(row => row.voucherId))
      .toEqual([existing.id, created.id]);

    const ambiguous = run('postBank', { ...movement, day: '2026-11-22', memo: 'Second date', requestId: 'ambiguous-1' });
    const ambiguous2 = run('postBank', { ...movement, day: '2026-11-22', memo: 'Second date duplicate', requestId: 'ambiguous-2' });
    run('importStatement', { ...initial, ...csv('Date,Description,Reference,Amount\n2026-11-22,Ambiguous,, -5000\n') });
    const unresolved = run('getStatements', { accountId, pending: true }).rows;
    expect(unresolved.map(row => row.description)).toEqual(['Ambiguous', 'Unreviewed receipt']);
    expect(run('getStatementMatches', { ...review, rowId: unresolved[0].id }).rows.map(row => row.id))
      .toEqual([ambiguous2.id, ambiguous.id]);

    db.close();
    db = openWorkspace(directory, 'live', fixture);
    run = books(db, 'live', company);
    expect(run('getStatements', { accountId, pending: true }).rows).toEqual(unresolved);
    run('reverseVoucher', { voucherId: created.id, requestId: 'reverse', day: today, memo: 'Correction' });
    expect(run('getStatement', post).voucherId).toBeNull();
    expect(() => run('confirmStatement', post)).toThrow('previous posting was reversed');
    const reposted = run('confirmStatement', { ...post, requestId: 'repost' });
    expect(reposted.id).not.toBe(created.id);
    const pendingBank = run('createAccount', { kind: 'bank', name: 'Pending bank' });
    run('importStatement', { ...initial, accountId: pendingBank.id });
    expect(run('removeNamedAccount', { kind: 'bank', accountId: pendingBank.id })).toEqual({ archived: true });
    expect(run('getStatements', { accountId: pendingBank.id, pending: true }).rows).toHaveLength(1);
  } finally {
    db.close();
  }
});

test('issued invoices, notes and bill applications reconcile to the firm books and management reports', () => {
  const kind = 'live';
  const db = openWorkspace(directory, kind, fixture);
  const firmA = firm(db, kind, 'Firm A');
  const firmB = firm(db, kind, 'Firm B');
  const a = books(db, kind, firmA);
  const b = books(db, kind, firmB);
  const opening = '2026-11-16';
  const billDay = '2026-11-18';
  const paymentDay = '2026-11-19';
  const noteDay = '2026-11-20';
  const purchase = {
    requestId: 'purchase-a', side: 'Purchase', document: 'Invoice', number: 'SUP-421', day: billDay, issuerId: firmA,
    party: 'Vikram Enterprises', partyAddress: 'Supplier address', partyGstin: 'GST-SUP', consumer: 'Site office',
    supply: 'Agra', taxMode: 'split', allocationMode: 'amount', items: [
      { description: 'Steel', quantity: '2.5', unit: 't', rate: '40000', gst: '18' },
    ], allocations: [{ firmId: firmA, value: '60000' }, { firmId: firmB, value: '40000' }],
  } satisfies import('../desktop/invoices').InvoiceEntry;
  let saleId: number;
  let billId: number;
  try {
    runWorkspaceCommand(db, { kind, operation: 'saveFirm', id: firmA,
      details: { name: 'Firm A', owner: 'Asha', address: '12 Old Address', gstin: 'GST-FIRM' } });
    const cashbook = a('createCashbook', { name: 'Site cash', custodian: 'Vikram', requestId: 'site',
      openingCash: 1_000_000, openedOn: opening });
    const bill = a('postInvoice', purchase);
    billId = bill.voucherId;
    expect(a('postInvoice', purchase)).toEqual(bill);
    expect(() => a('postInvoice', { ...purchase, number: 'X' })).toThrow(/different voucher/);
    expect(() => a('postInvoice', { ...purchase, requestId: 'other-a' })).toThrow(/already in use/);
    expect(() => a('postInvoice', { ...purchase, number: 'X', requestId: 'bad-split',
      allocations: [{ firmId: firmB, value: '5000' }] })).toThrow(/total the pre-tax/);
    expect(bill.snapshot.totals).toEqual({ base: 10_000_000, CGST: 900_000, SGST: 900_000, IGST: 0, total: 11_800_000 });
    expect(bill.snapshot.allocations.map(row => row.amount)).toEqual([6_000_000, 4_000_000]);
    expect(a('getDayBook', { from: billDay }).rows.map(row => row.id)).toEqual([billId]);
    const byName = Object.fromEntries(a('getTrialBalance', {}).rows.map(row => [row.name, row]));
    const payable = byName['Vikram Enterprises'];
    expect([byName.Purchases.balance, byName['Input CGST'].balance, byName['Input SGST'].balance, payable.balance])
      .toEqual([10_000_000n, 900_000n, 900_000n, -11_800_000n]);
    expect(b('getTrialBalance', {}).rows).toEqual([]);
    const combined = a('getReport', { name: 'allocations', combined: true, from: billDay, to: billDay });
    expect(combined.tables[0].totals).toEqual([['Total allocated', 0n, 10_000_000n, 10_000_000n]]);
    expect(combined.tables[1].rows.map(row => row[0])).toEqual([
      { label: 'SUP-421', source: { view: 'invoice', firmId: firmA, id: billId } },
      { label: 'SUP-421', source: { view: 'invoice', firmId: firmA, id: billId } },
    ]);
    expect(b('getReport', { name: 'allocations' }).tables[0].totals).toEqual([['Total allocated', 0n, 4_000_000n, 4_000_000n]]);

    const payment = { invoiceId: billId, accountId: cashbook.id, requestId: 'apply', day: paymentDay, memo: '', amount: 650_000 };
    expect(() => b('applyBillPayment', payment)).toThrow(/invoice in this firm/);
    expect(() => a('applyBillPayment', { ...payment, amount: 11_800_001 })).toThrow(/bill balance/);
    expect(a('getCashbookLedger', { accountId: cashbook.id }).closing).toBe(1_000_000n);
    const applied = a('applyBillPayment', payment);
    expect(a('applyBillPayment', payment)).toEqual(applied);
    expect(applied).toMatchObject({ invoiceId: billId, lines: [line(cashbook.id, -650_000), line(payable.id, 650_000)] });
    expect(a('getCashbookLedger', { accountId: cashbook.id }).closing).toBe(350_000n);
    expect(a('getLedger', { accountId: byName.Purchases.id }).closing).toBe(10_000_000n);
    expect(a('getInvoice', { voucherId: billId }).outstanding).toBe(11_150_000);
    expect(a('getReport', { name: 'bills', to: billDay }).tables[1].totals?.[0].at(-1)).toBe(11_800_000n);
    expect(a('getReport', { name: 'bills', to: paymentDay }).tables[1].totals)
      .toEqual([['Total', '', '', 11_800_000n, 0n, 650_000n, 11_150_000n]]);
    expect(() => a('reverseVoucher', { voucherId: billId, requestId: 'early', day: noteDay, memo: 'Void invoice' }))
      .toThrow(/bill payments/);

    const debit = a('postInvoice', { ...purchase, requestId: 'purchase-return', originalId: billId,
      document: 'Debit note', number: 'DN-1', day: noteDay,
      items: [{ ...purchase.items[0], quantity: '1', rate: '1000' }], allocations: [] });
    expect(a('getInvoice', { voucherId: billId }).outstanding).toBe(11_032_000);
    const reverse = a('reverseVoucher', { voucherId: debit.voucherId, requestId: 'undo-debit', day: '2026-11-21', memo: 'Void return' });
    expect(reverse.invoiceId).toBe(debit.voucherId);
    expect(a('getInvoice', { voucherId: billId }).outstanding).toBe(11_150_000);
    expect(a('getReport', { name: 'purchases', to: noteDay }).tables[0].totals?.[0].slice(4, 9))
      .toEqual([9_900_000n, 891_000n, 891_000n, 0n, 11_682_000n]);
    expect(a('getReport', { name: 'purchases' }).tables[0].totals?.[0].slice(4, 9))
      .toEqual([10_000_000n, 900_000n, 900_000n, 0n, 11_800_000n]);

    const saleDraft = { ...purchase, side: 'Sale', requestId: 'issue-sale', number: 'A-24', day: paymentDay,
      party: 'Customer', taxMode: 'igst', items: [{ description: 'Custom work', unit: 'm', quantity: '3.125', rate: '106.15', gst: '18' }],
      allocations: [{ firmId: firmA, value: '33.333333' }, { firmId: firmB, value: '66.666667' }], allocationMode: 'percent',
    } satisfies import('../desktop/invoices').InvoiceEntry;
    const sale = a('postInvoice', saleDraft);
    saleId = sale.voucherId;
    expect(sale.snapshot.totals).toEqual({ base: 33_172, CGST: 0, SGST: 0, IGST: 5_971, total: 39_143 });
    expect(sale.snapshot.allocations.map(row => row.amount)).toEqual([11_057, 22_115]);
    const credit = a('postInvoice', { ...saleDraft, originalId: saleId, document: 'Credit note', requestId: 'refund',
      number: 'CN-1', day: noteDay, items: [{ ...saleDraft.items[0], quantity: '1', rate: '100' }], allocations: [] });
    expect(a('getInvoice', { voucherId: saleId }).outstanding).toBe(27_343);
    expect(credit.snapshot.originalNumber).toBe(sale.snapshot.number);
    runWorkspaceCommand(db, { kind, operation: 'saveFirm', id: firmA,
      details: { name: 'Firm A', owner: 'Asha', address: '99 New Address', gstin: 'GST-FIRM' } });
    expect(a('postInvoice', saleDraft).snapshot).toEqual(sale.snapshot);
    const trial = a('getTrialBalance', { to: paymentDay });
    for (const account of trial.rows) {
      expect(a('getLedger', { accountId: account.id, to: paymentDay }).closing, account.name).toBe(account.balance);
      expect(a('getReport', { name: 'ledger', accountId: account.id, to: paymentDay }).tables[0].totals?.at(-1)?.at(-1))
        .toBe(account.balance);
    }
    expect(trial.debit).toBe(trial.credit);
    expect(a('getReport', { name: 'trial', to: paymentDay }).tables[0].totals).toEqual([['Total', trial.debit, trial.credit]]);
    const balance = a('getReport', { name: 'balance', to: paymentDay }).tables.at(-1)!.totals!;
    expect(balance[0][1]).toBe(balance[1][1]);
    expect(balance[2]).toEqual(['Difference', 0n]);
    expect(a('getReport', { name: 'pnl', from: billDay, to: paymentDay }).tables.at(-1)!.totals)
      .toEqual([['Net profit / (loss)', -9_966_828n]]);
    expect(a('getReport', { name: 'gst', to: paymentDay }).tables.at(-1)!.totals)
      .toEqual([['Output less input', -900_000n, -900_000n, 5_971n]]);

    a('applyBillPayment', { ...payment, invoiceId: saleId, amount: 27_343, day: noteDay, requestId: 'sale-receipt' });
    expect(a('getInvoice', { voucherId: saleId }).outstanding).toBe(0);
    a('postInvoice', { ...saleDraft, originalId: saleId, document: 'Credit note', requestId: 'credit-paid-sale',
      number: 'CN-2', day: noteDay, items: [{ ...saleDraft.items[0], quantity: '1', rate: '100' }], allocations: [] });
    expect(a('getInvoice', { voucherId: saleId }).outstanding).toBe(-11_800);
    a('applyBillPayment', { ...payment, invoiceId: saleId, amount: 11_800, day: noteDay, refund: true, requestId: 'cash-refund' });
    expect(a('getInvoice', { voucherId: saleId }).outstanding).toBe(0);
  } finally {
    db.close();
  }

  const reopened = openWorkspace(directory, kind, fixture);
  try {
    expect(books(reopened, kind, firmA)('getInvoice', { voucherId: saleId! }).snapshot.issuer.address).toBe('12 Old Address');
    expect(books(reopened, kind, firmA)('getInvoice', { voucherId: billId! }).outstanding).toBe(11_150_000);
  } finally {
    reopened.close();
  }
});

test('statement reconciliation traces exact book and imported movements before and after reversal', () => {
  const db = openWorkspace(directory, 'live', fixture);
  try {
    const id = firm(db, 'live', 'Reconciliation');
    const run = books(db, 'live', id);
    const bank = run('createAccount', { name: 'Bank', kind: 'bank' });
    const expense = run('createAccount', { name: 'Supplies', kind: 'expense' });
    run('postVoucher', { kind: 'Opening balance', requestId: 'open-bank', day: '2026-11-17', memo: '', accountId: bank.id, value: 2_000_000 });
    const booked = run('postBank', { bankId: bank.id, accountId: expense.id, siteId: null, requestId: 'first',
      day: '2026-11-18', memo: 'Supplies', value: -500_000 });
    run('postBank', { bankId: bank.id, accountId: expense.id, siteId: null, requestId: 'second',
      day: '2026-11-19', memo: 'Unmatched', value: -100_000 });
    const bytes = new TextEncoder().encode('Date,Description,Amount\n2026-11-18,Supplies,-5000\n2026-11-19,Pending,2000').buffer;
    run('importStatement', { accountId: bank.id, filename: 'statement.csv', bytes, mapping: { date: 0, description: 1, amount: 2 } });
    const statement = run('getStatements', { accountId: bank.id }).rows.find(row => row.value < 0)!;
    run('confirmStatement', { bankId: bank.id, rowId: statement.id, voucherId: booked.id, accountId: expense.id,
      siteId: null, requestId: 'match' });
    const report = () => run('getReport', { name: 'bank', from: '2026-11-18', to: '2026-11-19' });
    expect(report().tables[0].rows[0].slice(1))
      .toEqual([2_000_000n, -600_000n, 1_400_000n, -300_000n, -500_000n, -100_000n, 200_000n, -300_000n]);
    expect(report().tables[1].rows[0].at(-1)).toEqual({ label: '#' + booked.id, source: { view: 'voucher', firmId: id, id: booked.id } });
    run('reverseVoucher', { voucherId: booked.id, requestId: 'reverse', day: '2026-11-20', memo: 'Correct bank entry' });
    expect(report().tables[0].rows[0][5]).toBe(-500_000n);
    expect(run('getReport', { name: 'bank', from: '2026-11-18' }).tables[0].rows[0][5]).toBe(0n);
  } finally {
    db.close();
  }
});

test('upgrading version 5 indexes issued prototype snapshots and the seeded part payment', () => {
  let db = openWorkspace(directory, 'demo', fixture);
  db.exec(`DROP VIEW bill_movements; DROP TABLE bill_applications; DROP TABLE invoice_allocations;
    DROP TABLE invoice_records; DROP TABLE statement_match_history; PRAGMA user_version = 5;`);
  db.close();
  db = openWorkspace(directory, 'demo', fixture);
  try {
    const run = books(db, 'demo', 1);
    expect(run('getInvoice', { voucherId: 35 })).toMatchObject({
      snapshot: { issuer: { address: 'Agra, Uttar Pradesh' }, number: 'SP-026', totals: { total: 11_328_000 } },
      outstanding: 4_828_000, activity: [{ voucherId: 35, amount: 11_328_000 }, { voucherId: 39, amount: -6_500_000 }],
    });
    expect(run('getInvoices', {}).rows.map(row => row.number)).toEqual(['SP-026', 'AST-218']);
    expect(run('getDayBook', {}).rows).toHaveLength(25);
    expect(run('getReport', { name: 'day' }).tables[0].rows).toHaveLength(40);
  } finally {
    db.close();
  }
});
