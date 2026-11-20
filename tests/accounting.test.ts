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
