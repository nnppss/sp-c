import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
const { openWorkspace, readWorkspace, restoreBackup, saveBackup } =
  require('../dist/desktop/database.js') as typeof import('../desktop/database');
const fixture = resolve('fixtures/prototype-2026-11-20.json');
let directory: string;
let books: string;
let exported: string;
let recovery: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sp-backup-'));
  books = join(directory, 'books');
  exported = join(directory, 'export.sqlite3');
  recovery = join(books, 'live.before-restore.sqlite3');
});
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

test('exports committed WAL data and restores without mutating the backup or the previous books', async () => {
  const source = join(directory, 'source');
  using db = openWorkspace(source, 'live', fixture);
  db.exec(`
    PRAGMA journal_mode = WAL;
    INSERT INTO firms (name, owner, address, gstin) VALUES ('Sample first', '', '', ''), ('Sample second', '', '', '');
    UPDATE active_firm SET firm_id = 2;
    UPDATE workspace_settings SET value = 'Saved books' WHERE key = 'name';
  `);
  const expected = readWorkspace(db);
  db.exec("BEGIN; UPDATE workspace_settings SET value = 'Draft' WHERE key = 'name';");
  using committed = new DatabaseSync(join(source, 'live.sqlite3'), { readOnly: true });
  saveBackup(committed, exported);
  db.exec('ROLLBACK');
  expect(existsSync(exported + '-wal')).toBe(false);
  expect(() => saveBackup(db, join(source, 'demo.sqlite3'))).toThrow(/outside the app/);

  const target = openWorkspace(books, 'live', fixture);
  try {
    expect(await restoreBackup(target, 'live', fixture, exported)).toEqual(expected);
    expect(readWorkspace(target)).toEqual(expected);
  } finally {
    target.close();
  }
  using reopened = openWorkspace(books, 'live', fixture);
  expect(readWorkspace(reopened)).toEqual(expected);
  using previous = new DatabaseSync(recovery, { readOnly: true });
  expect(readWorkspace(previous).firms).toEqual([]);
  using original = new DatabaseSync(exported, { readOnly: true });
  expect(readWorkspace(original)).toEqual(expected);
});

test('rejects unreadable, unrelated, future, wrong-kind and foreign-key-invalid backups', async () => {
  using target = openWorkspace(books, 'live', fixture);
  target.exec("UPDATE workspace_settings SET value = 'Keep me' WHERE key = 'name'");
  writeFileSync(exported, 'bad backup');
  await expect(restoreBackup(target, 'live', fixture, exported)).rejects.toThrow(/could not be opened/);
  const unrelated = join(directory, 'unrelated.sqlite3');
  const other = new DatabaseSync(unrelated);
  other.exec('CREATE TABLE other (id INTEGER); PRAGMA user_version = 6;');
  other.close();
  await expect(restoreBackup(target, 'live', fixture, unrelated)).rejects.toThrow(/supported workspace schema/);
  saveBackup(target, exported);
  const future = new DatabaseSync(exported);
  future.exec('PRAGMA user_version = 999');
  future.close();
  await expect(restoreBackup(target, 'live', fixture, exported)).rejects.toThrow(/newer version/);
  using demo = openWorkspace(books, 'demo', fixture);
  saveBackup(demo, exported);
  await expect(restoreBackup(target, 'live', fixture, exported)).rejects.toThrow(/same Live or Demo/);
  saveBackup(target, exported);
  const orphan = new DatabaseSync(exported, { enableForeignKeyConstraints: false });
  orphan.exec('UPDATE active_firm SET firm_id = 99');
  orphan.close();
  await expect(restoreBackup(target, 'live', fixture, exported)).rejects.toThrow(/integrity/);
  expect(existsSync(recovery)).toBe(false);
  using reopened = openWorkspace(books, 'live', fixture);
  expect(readWorkspace(reopened).name).toBe('Keep me');
});

test('keeps the existing books and the recovery snapshot when installation cannot acquire a write lock', async () => {
  using source = openWorkspace(join(directory, 'source'), 'live', fixture);
  saveBackup(source, exported);
  const target = openWorkspace(books, 'live', fixture);
  const locked = new DatabaseSync(join(books, 'live.sqlite3'));
  try {
    target.exec("UPDATE workspace_settings SET value = 'Existing books' WHERE key = 'name'");
    locked.exec('BEGIN IMMEDIATE');
    await expect(restoreBackup(target, 'live', fixture, exported)).rejects.toThrow();
    expect(existsSync(recovery)).toBe(true);
  } finally {
    locked.close();
    target.close();
  }
  using reopened = openWorkspace(books, 'live', fixture);
  expect(readWorkspace(reopened).name).toBe('Existing books');
  using previous = new DatabaseSync(recovery, { readOnly: true });
  expect(readWorkspace(previous)).toEqual(readWorkspace(reopened));
});

test('upgrades a populated version 5 backup in staging and leaves its original at version 5', async () => {
  const source = join(directory, 'source');
  const seeded = openWorkspace(source, 'demo', fixture);
  seeded.exec(`
    INSERT INTO firms (name, owner, address, gstin) VALUES ('Second sample firm', '', '', '');
    UPDATE active_firm SET firm_id = 2;
  `);
  saveBackup(seeded, exported);
  seeded.close();
  const expected = openWorkspace(source, 'demo', fixture);
  try {
    const legacyFile = join(directory, 'legacy.sqlite3');
    copyFileSync(exported, legacyFile);
    const legacy = new DatabaseSync(legacyFile);
    legacy.exec(`
      DROP VIEW bill_movements;
      DROP TABLE bill_applications;
      DROP TABLE invoice_allocations;
      DROP TABLE invoice_records;
      DROP TABLE statement_match_history;
      PRAGMA user_version = 5;
    `);
    legacy.close();
    const target = openWorkspace(books, 'demo', fixture);
    try {
      await expect(restoreBackup(target, 'demo', fixture, legacyFile)).resolves.toEqual(readWorkspace(expected));
      expect(target.prepare('PRAGMA user_version').get()).toEqual({ user_version: 6 });
      for (const table of ['posting_lines', 'invoice_records', 'invoice_allocations', 'bill_applications']) {
        const query = `SELECT * FROM ${table} ORDER BY rowid`;
        expect(target.prepare(query).all()).toEqual(expected.prepare(query).all());
      }
      using untouched = new DatabaseSync(legacyFile, { readOnly: true });
      expect(untouched.prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 });
    } finally {
      target.close();
    }
  } finally {
    expected.close();
  }
});
