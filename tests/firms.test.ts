import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { WorkspaceCommand } from '../desktop/workspace';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
const { openWorkspace, readWorkspace, runWorkspaceCommand } = require('../dist/desktop/database.js') as typeof import('../desktop/database');
const fixture = resolve('fixtures/prototype-2026-11-20.json');
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'sp-firms-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

test('upgrades a populated phase 1 demo and retains the sample books when their firm is archived', () => {
  const snapshot = readFileSync(fixture, 'utf8');
  const old = new DatabaseSync(join(directory, 'demo.sqlite3'));
  old.exec(`CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE demo_baseline (id INTEGER PRIMARY KEY CHECK (id = 1),
      snapshot TEXT NOT NULL CHECK (json_valid(snapshot))) STRICT;
    INSERT INTO workspace_settings VALUES ('name', 'Training books');
    PRAGMA user_version = 1;`);
  old.prepare('INSERT INTO demo_baseline VALUES (1, ?)').run(snapshot);
  old.close();

  // The upgrade must recover the firm from the saved books, even without the fixture file.
  const withoutFixture = join(directory, 'missing.json');
  const db = openWorkspace(directory, 'demo', withoutFixture);
  try {
    const before = readWorkspace(db);
    expect(before.name).toBe('Training books');
    expect(before.activeFirmId).toBe(1);
    expect(before.demo).toEqual({ firmId: 1, vouchers: 40, debit: 219_800_000, credit: 219_800_000 });
    runWorkspaceCommand(db, { kind: 'demo', operation: 'selectFirm', id: 1 });
    expect(runWorkspaceCommand(db, { kind: 'demo', operation: 'removeFirm', id: 1 })).toEqual({
      ...before, activeFirmId: null, firms: [{ ...before.firms[0], archived: true }],
    });
    expect(() => runWorkspaceCommand(db, { kind: 'demo', operation: 'selectFirm', id: 1 })).toThrow(/archived/);
    expect(db.prepare('SELECT snapshot, firm_id FROM demo_baseline').get()).toEqual({ snapshot, firm_id: 1 });
  } finally {
    db.close();
  }
  const reopened = openWorkspace(directory, 'demo', withoutFixture);
  try {
    expect(readWorkspace(reopened).firms).toMatchObject([{ id: 1, archived: true }]);
    expect(readWorkspace(reopened).activeFirmId).toBeNull();
  } finally {
    reopened.close();
  }
});

test('uses stable IDs, persists the explicit choice and only deletes firms without references', () => {
  const db = openWorkspace(directory, 'live', fixture);
  const run = (command: WorkspaceCommand) => runWorkspaceCommand(db, command);
  const a = { name: 'Firm A', owner: 'Asha', address: 'Agra', gstin: '' };
  const b = { name: 'Firm B', owner: 'Bina', address: 'Delhi', gstin: '07abcde1234f1z5' };
  let bId: number;
  try {
    const [first] = run({ kind: 'live', operation: 'saveFirm', id: null, details: a }).firms;
    const second = run({ kind: 'live', operation: 'saveFirm', id: null, details: b }).firms[1];
    bId = second.id;
    expect(readWorkspace(db).activeFirmId).toBe(first.id);
    expect(() => run({ kind: 'live', operation: 'saveFirm', id: null, details: { ...a, name: ' firm a ' } }))
      .toThrow('A firm with that name already exists.');
    expect(() => run({ kind: 'live', operation: 'saveFirm', id: null, details: { ...a, owner: 1 } })).toThrow(/Owner/);
    expect(() => run({ kind: 'live', operation: 'selectFirm', id: '1' })).toThrow(/existing firm/);
    expect(run({ kind: 'live', operation: 'saveFirm', id: first.id, details: { ...a, owner: 'Asha Singh' } }).firms[0])
      .toEqual({ ...first, owner: 'Asha Singh' });
    expect(second.gstin).toBe('07ABCDE1234F1Z5');
    db.exec('CREATE TABLE book_history (firm_id INTEGER NOT NULL REFERENCES firms(id), memo TEXT NOT NULL) STRICT;');
    db.prepare('INSERT INTO book_history VALUES (?, ?)').run(first.id, 'Existing book entry');
    run({ kind: 'live', operation: 'selectFirm', id: first.id });
    expect(run({ kind: 'live', operation: 'removeFirm', id: first.id })).toMatchObject({
      activeFirmId: bId, firms: [{ id: first.id, archived: true }, second],
    });
    expect(db.prepare('SELECT memo FROM book_history WHERE firm_id = ?').get(first.id)).toEqual({ memo: 'Existing book entry' });
    const unused = run({ kind: 'live', operation: 'saveFirm', id: null, details: { ...a, name: 'Unused' } }).firms[2];
    run({ kind: 'live', operation: 'selectFirm', id: unused.id });
    expect(run({ kind: 'live', operation: 'removeFirm', id: unused.id })).toMatchObject({
      activeFirmId: bId, firms: [{ id: first.id, archived: true }, second],
    });
    expect(() => run({ kind: 'live', operation: 'selectFirm', id: unused.id })).toThrow(/existing firm/);
    run({ kind: 'live', operation: 'selectFirm', id: bId });
  } finally {
    db.close();
  }
  const reopened = openWorkspace(directory, 'live', fixture);
  try {
    expect(readWorkspace(reopened)).toMatchObject({
      activeFirmId: bId,
      firms: [{ archived: true, owner: 'Asha Singh' }, { ...b, gstin: '07ABCDE1234F1Z5', id: bId, archived: false }],
    });
  } finally {
    reopened.close();
  }
});
