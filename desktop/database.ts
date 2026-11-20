import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { accountingSchema, BookInputError, replayDemo, runAccountingCommand } from './accounting';
import type { BookCommand } from './books';
import { FIRM_FIELDS, isWorkspaceKind, workspaceName } from './workspace';
import type { Firm, FirmDetails, WorkerReply, Workspace, WorkspaceCommand, WorkspaceKind } from './workspace';

const migrations = [
  `CREATE TABLE workspace_settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   ) STRICT;
   CREATE TABLE demo_baseline (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     snapshot TEXT NOT NULL CHECK (json_valid(snapshot))
   ) STRICT;`,
  `CREATE TABLE firms (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL COLLATE NOCASE UNIQUE,
     owner TEXT NOT NULL,
     address TEXT NOT NULL,
     gstin TEXT NOT NULL,
     archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
   ) STRICT;
   CREATE TABLE active_firm (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     firm_id INTEGER REFERENCES firms(id) ON DELETE SET NULL
   ) STRICT;
   INSERT INTO active_firm (id) VALUES (1);
   ALTER TABLE demo_baseline ADD COLUMN firm_id INTEGER REFERENCES firms(id) ON DELETE RESTRICT;`,
  accountingSchema,
  `CREATE TABLE cashbooks (
     account_id INTEGER PRIMARY KEY,
     firm_id INTEGER NOT NULL REFERENCES firms(id),
     custodian TEXT NOT NULL,
     opened_on TEXT NOT NULL,
     request_id TEXT NOT NULL,
     opening_voucher_id INTEGER,
     UNIQUE (firm_id, request_id),
     FOREIGN KEY (firm_id, account_id) REFERENCES accounts(firm_id, id),
     FOREIGN KEY (firm_id, opening_voucher_id) REFERENCES vouchers(firm_id, id)
   ) STRICT;
   ALTER TABLE vouchers ADD COLUMN payee_person TEXT;
   ALTER TABLE vouchers ADD COLUMN payee_firm_id INTEGER REFERENCES firms(id)
     CHECK (payee_firm_id IS NULL OR payee_person IS NULL);`,
];

class FirmInputError extends Error {}

export function openWorkspace(directory: string, kind: WorkspaceKind, fixture: string) {
  if (!isWorkspaceKind(kind)) throw new Error('Unknown workspace.');
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, `${kind}.sqlite3`));
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    db.exec('BEGIN IMMEDIATE');
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version > migrations.length) throw new Error('This workspace needs a newer version of the app.');
    for (let index = version; index < migrations.length; index++) {
      db.exec(migrations[index]);
      db.exec(`PRAGMA user_version = ${index + 1}`);
    }
    db.prepare('INSERT OR IGNORE INTO workspace_settings VALUES (?, ?)').run(
      'name', kind === 'demo' ? 'SP & Company Demo' : 'SP & Company',
    );
    if (kind === 'demo' && !db.prepare('SELECT 1 FROM demo_baseline WHERE firm_id IS NOT NULL').get()) {
      const previous = db.prepare('SELECT snapshot FROM demo_baseline WHERE id = 1').get() as { snapshot: string } | undefined;
      const snapshot = previous?.snapshot ?? readFileSync(fixture, 'utf8');
      const { lastInsertRowid } = db.prepare(`INSERT INTO firms (id, name, owner, address, gstin)
        SELECT json_extract(firm, '$.id'), json_extract(firm, '$.name'), json_extract(firm, '$.owner'),
          json_extract(firm, '$.address'), json_extract(firm, '$.gstin')
        FROM (SELECT json_extract(?, '$.firms[0]') AS firm)`).run(snapshot);
      db.prepare(`INSERT INTO demo_baseline (id, snapshot, firm_id) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET firm_id = excluded.firm_id`).run(snapshot, lastInsertRowid);
    }
    if (kind === 'demo' && version < 3) {
      const { firmId, snapshot } = db.prepare('SELECT firm_id AS firmId, snapshot FROM demo_baseline WHERE id = 1')
        .get() as { firmId: number; snapshot: string };
      replayDemo(db, firmId, snapshot);
    }
    db.exec('COMMIT');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function readWorkspace(db: DatabaseSync): Workspace {
  const { value: name } = db.prepare("SELECT value FROM workspace_settings WHERE key = 'name'").get() as { value: string };
  const rows = db.prepare('SELECT id, name, owner, address, gstin, archived FROM firms ORDER BY id').all() as
    (Omit<Firm, 'archived'> & { archived: number })[];
  const firms = rows.map(row => ({ ...row, archived: row.archived === 1 }));
  const { firm_id: selected } = db.prepare('SELECT firm_id FROM active_firm WHERE id = 1').get() as { firm_id: number | null };
  const activeFirmId = selected ?? firms.find(firm => !firm.archived)?.id ?? null;
  const demo = db.prepare(`SELECT firm_id AS firmId, json_array_length(snapshot, '$.vouchers') AS vouchers,
    json_extract(snapshot, '$.trialBalance.debit') AS debit,
    json_extract(snapshot, '$.trialBalance.credit') AS credit FROM demo_baseline WHERE id = 1`).get();
  return { name, firms, activeFirmId, demo: (demo as Workspace['demo']) ?? null };
}

function requireFirm(db: DatabaseSync, id: unknown) {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new FirmInputError('Choose an existing firm.');
  }
  const firm = db.prepare('SELECT archived FROM firms WHERE id = ?').get(id);
  if (!firm) throw new FirmInputError('Choose an existing firm.');
  return { id, archived: firm.archived === 1 };
}

function saveFirm(db: DatabaseSync, id: unknown, details: unknown) {
  if (typeof details !== 'object' || details === null) throw new FirmInputError('Enter the firm details.');
  const fields = details as Record<keyof FirmDetails, unknown>;
  const values = Object.fromEntries(Object.entries(FIRM_FIELDS).map(([key, { label, limit }]) => {
    const field = key as keyof FirmDetails;
    const value = fields[field];
    if (typeof value !== 'string' || value.length > limit || (field === 'name' && !value.trim())) {
      throw new FirmInputError(`${label} must have ${field === 'name' ? '1 to' : 'at most'} ${limit} characters.`);
    }
    return [key, field === 'gstin' ? value.trim().toUpperCase() : value.trim()];
  }));
  try {
    if (id === null) db.prepare('INSERT INTO firms (name, owner, address, gstin) VALUES ($name, $owner, $address, $gstin)').run(values);
    else db.prepare('UPDATE firms SET name = $name, owner = $owner, address = $address, gstin = $gstin WHERE id = $id').run(
      { ...values, id: requireFirm(db, id).id },
    );
  } catch (error) {
    if (error instanceof Error && 'errcode' in error && error.errcode === 2067) {
      throw new FirmInputError('A firm with that name already exists.');
    }
    throw error;
  }
}

function removeFirm(db: DatabaseSync, id: unknown) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const firm = requireFirm(db, id);
    if (firm.archived) throw new FirmInputError('This firm is already archived.');
    try {
      db.prepare('DELETE FROM firms WHERE id = ?').run(firm.id);
    } catch (error) {
      // Book records must use non-cascading foreign keys so removing a firm preserves history.
      if (!(error instanceof Error) || error.message !== 'FOREIGN KEY constraint failed') throw error;
      db.prepare('UPDATE firms SET archived = 1 WHERE id = ?').run(firm.id);
      db.prepare('UPDATE active_firm SET firm_id = NULL WHERE firm_id = ?').run(firm.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function runWorkspaceCommand(db: DatabaseSync, command: WorkspaceCommand): Workspace {
  switch (command.operation) {
    case 'saveName':
      db.prepare("UPDATE workspace_settings SET value = ? WHERE key = 'name'").run(workspaceName(command.name));
      break;
    case 'saveFirm':
      saveFirm(db, command.id, command.details);
      break;
    case 'selectFirm': {
      const firm = requireFirm(db, command.id);
      if (firm.archived) throw new FirmInputError('Choose a firm that is not archived.');
      db.prepare('UPDATE active_firm SET firm_id = ? WHERE id = 1').run(firm.id);
      break;
    }
    case 'removeFirm':
      removeFirm(db, command.id);
      break;
    case 'read':
      break;
    default:
      throw new Error('Unknown workspace operation.');
  }
  return readWorkspace(db);
}

export function runBookCommand(db: DatabaseSync, command: BookCommand) {
  return runAccountingCommand(db, requireFirm(db, command.firmId), command);
}

if (parentPort) {
  const port = parentPort;
  const databases = new Map<WorkspaceKind, DatabaseSync>();
  port.on('message', ({ id, command }: { id: number; command: WorkspaceCommand | BookCommand }) => {
    let reply: WorkerReply;
    try {
      const { kind } = command;
      let db = databases.get(kind);
      if (!db) {
        db = openWorkspace(workerData.directory, kind, workerData.fixture);
        databases.set(kind, db);
      }
      reply = { id, result: 'firmId' in command ? runBookCommand(db, command) : runWorkspaceCommand(db, command) };
    } catch (error) {
      const invalidInput = error instanceof FirmInputError || error instanceof BookInputError;
      if (!invalidInput) console.error(error);
      reply = { id, error: invalidInput ? error.message
        : 'The workspace could not be accessed. Check its files and try again.' };
    }
    port.postMessage(reply);
  });
}
