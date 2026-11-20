import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import baseline from '../fixtures/prototype-2026-11-20.json';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
const { openWorkspace, readWorkspace } = require('../dist/desktop/database.js') as typeof import('../desktop/database');
const fixture = resolve('fixtures/prototype-2026-11-20.json');
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'sp-sqlite-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

test('replays the prototype postings to the captured account and site balances', () => {
  expect(baseline.vouchers).toHaveLength(40);
  const accounts = new Map(baseline.accounts.map(account => [account.id, 0]));
  const sites = new Map(baseline.sites.map(site => [site.id, new Map<number, number>()]));
  for (const voucher of baseline.vouchers) {
    expect(voucher.lines.reduce((total, line) => total + line.value, 0)).toBe(0);
    expect(voucher.lines.reduce((total, line) => total + Math.max(0, line.value), 0)).toBe(voucher.amount);
    for (const { account, site, value } of voucher.lines) {
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(accounts.has(account)).toBe(true);
      accounts.set(account, accounts.get(account)! + value);
      if (site === null) continue;
      const siteAccounts = sites.get(site)!;
      siteAccounts.set(account, (siteAccounts.get(account) ?? 0) + value);
    }
  }
  expect(accounts).toEqual(new Map(baseline.balances.map(({ account, value }) => [account, value])));
  expect([...sites].flatMap(([site, balances]) => [...balances].map(([account, value]) => ({ site, account, value }))))
    .toEqual(expect.arrayContaining(baseline.siteBalances));
  expect([...sites.values()].reduce((total, balances) => total + balances.size, 0)).toBe(baseline.siteBalances.length);
  expect(baseline.assigned).toHaveLength(6);
  for (const { site, account } of baseline.assigned) {
    expect(sites.has(site) && accounts.has(account)).toBe(true);
  }
  const balances = [...accounts.values()];
  expect(balances.reduce((total, value) => total + Math.max(0, value), 0)).toBe(219_800_000);
  expect(balances.reduce((total, value) => total - Math.min(0, value), 0)).toBe(219_800_000);
  const invoices = baseline.vouchers.flatMap(({ kind, document }) => document ? [[kind, document]] as const : []);
  expect(invoices).toHaveLength(2);
  expect(invoices).toContainEqual(['Sale', expect.objectContaining({ number: 'SP-026', totals: { base: 9_600_000, CGST: 864_000, SGST: 864_000 } })]);
  expect(invoices).toContainEqual(['Purchase', expect.objectContaining({ number: 'AST-218', totals: { base: 5_400_000, CGST: 486_000, SGST: 486_000 } })]);
});

test('migrates fresh files, seeds only demo and preserves populated settings on reopen', () => {
  const live = openWorkspace(directory, 'live', fixture);
  expect(live.prepare('PRAGMA user_version').get()).toEqual({ user_version: 6 });
  expect(live.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  expect(readWorkspace(live)).toEqual({ name: 'SP & Company', firms: [], activeFirmId: null, demo: null });
  live.prepare("UPDATE workspace_settings SET value = 'Office books' WHERE key = 'name'").run();
  live.close();

  const demo = openWorkspace(directory, 'demo', fixture);
  expect(readWorkspace(demo)).toEqual({
    name: 'SP & Company Demo',
    firms: [{ id: 1, name: 'SP & Company', owner: 'Nikhil Singh', address: 'Agra, Uttar Pradesh', gstin: '', archived: false }],
    activeFirmId: 1,
    demo: { firmId: 1, vouchers: 40, debit: 219_800_000, credit: 219_800_000 },
  });
  expect(demo.prepare('SELECT snapshot FROM demo_baseline').get()).toEqual({ snapshot: readFileSync(fixture, 'utf8') });
  demo.close();

  const reopened = openWorkspace(directory, 'live', fixture);
  expect(readWorkspace(reopened)).toEqual({ name: 'Office books', firms: [], activeFirmId: null, demo: null });
  reopened.close();
});

test('rolls back migration if the demo seed fails and refuses a future version', () => {
  expect(() => openWorkspace(directory, 'demo', join(directory, 'missing.json'))).toThrow();
  const db = new DatabaseSync(join(directory, 'demo.sqlite3'));
  expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 });
  expect(db.prepare('SELECT name FROM sqlite_schema WHERE type = ?').all('table')).toEqual([]);
  db.exec('PRAGMA user_version = 999');
  db.close();
  expect(() => openWorkspace(directory, 'demo', fixture)).toThrow('needs a newer version');
});
