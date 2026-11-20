import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { accountingSchema, BookInputError, replayDemo, runAccountingCommand } from './accounting';
import { getReport } from './reports';
import { indexPrototypeInvoices, invoiceSchema } from './invoice-schema';
import type { BookCommand } from './books';
import { StatementFileError } from './statement-file';
import { FIRM_FIELDS, isWorkspaceKind, workspaceName } from './workspace';
import type { BackupCommand, Firm, FirmDetails, WorkerReply, WorkerResult, Workspace, WorkspaceCommand, WorkspaceKind } from './workspace';

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
  `ALTER TABLE cashbooks ADD COLUMN employee_id INTEGER REFERENCES accounts(id);
   CREATE INDEX cashbooks_by_employee ON cashbooks(firm_id, employee_id);
   ALTER TABLE vouchers ADD COLUMN employee_id INTEGER REFERENCES accounts(id);
   CREATE INDEX vouchers_by_employee ON vouchers(firm_id, employee_id);
   CREATE TABLE statement_rows (
     id INTEGER PRIMARY KEY,
     firm_id INTEGER NOT NULL REFERENCES firms(id),
     bank_id INTEGER NOT NULL,
     day TEXT NOT NULL,
     description TEXT NOT NULL,
     reference TEXT NOT NULL,
     value INTEGER NOT NULL CHECK (value <> 0),
     occurrence INTEGER NOT NULL CHECK (occurrence > 0),
     filename TEXT NOT NULL,
     sheet TEXT NOT NULL,
     row_number INTEGER NOT NULL,
     voucher_id INTEGER,
     UNIQUE (bank_id, day, description, reference, value, occurrence),
     UNIQUE (bank_id, voucher_id),
     FOREIGN KEY (firm_id, bank_id) REFERENCES accounts(firm_id, id),
     FOREIGN KEY (firm_id, voucher_id) REFERENCES vouchers(firm_id, id)
   ) STRICT;
   CREATE INDEX statement_review ON statement_rows(firm_id, bank_id, day, id);
   CREATE INDEX statement_by_voucher ON statement_rows(firm_id, voucher_id);`,
  invoiceSchema,
];

class FirmInputError extends Error {}
class BackupError extends Error {}

function schemaVersion(db: DatabaseSync) {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

function applyMigrations(db: DatabaseSync, version: number, latest = migrations.length) {
  for (let index = version; index < latest; index++) {
    db.exec(migrations[index]);
    db.exec(`PRAGMA user_version = ${index + 1}`);
  }
}

export function openWorkspace(directory: string, kind: WorkspaceKind, fixture: string) {
  if (!isWorkspaceKind(kind)) throw new Error('Unknown workspace.');
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, `${kind}.sqlite3`));
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    db.exec('BEGIN IMMEDIATE');
    const version = schemaVersion(db);
    if (version > migrations.length) throw new Error('This workspace needs a newer version of the app.');
    applyMigrations(db, version);
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
    if (kind === 'demo' && version < 6) indexPrototypeInvoices(db);
    db.exec('COMMIT');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function removeStaging(directory: string) {
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    console.error('Could not remove backup staging directory', directory, error);
  }
}

function writeSnapshot(db: DatabaseSync, destination: string) {
  const staging = mkdtempSync(join(dirname(destination), '.sp-backup-'));
  try {
    const snapshot = join(staging, 'snapshot.sqlite3');
    db.prepare('VACUUM INTO ?').run(snapshot);
    chmodSync(snapshot, 0o600);
    renameSync(snapshot, destination);
  } finally {
    removeStaging(staging);
  }
}

export function saveBackup(db: DatabaseSync, filename: string) {
  const directory = realpathSync(dirname(db.location()!));
  const destination = realpathSync(dirname(filename));
  const offset = relative(directory.toLowerCase(), destination.toLowerCase());
  if (offset !== '..' && !offset.startsWith('..' + sep) && !isAbsolute(offset)) {
    throw new BackupError('Choose a backup location outside the app’s workspaces folder.');
  }
  writeSnapshot(db, join(destination, basename(filename)));
}

function checkIntegrity(db: DatabaseSync) {
  const integrity = db.prepare('PRAGMA integrity_check(1)').get();
  if (integrity?.integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').get()) {
    throw new BackupError('The backup failed SQLite integrity checks.');
  }
}

function validateBackup(filename: string, kind: WorkspaceKind) {
  using db = new DatabaseSync(filename, { readOnly: true });
  db.exec('PRAGMA trusted_schema = OFF');
  const version = schemaVersion(db);
  if (version > migrations.length) throw new BackupError('This backup needs a newer version of the app.');
  if (db.prepare('PRAGMA journal_mode').get()?.journal_mode === 'wal') {
    throw new BackupError('Choose a standalone backup made with Save backup.');
  }
  using expected = new DatabaseSync(':memory:');
  applyMigrations(expected, 0, version);
  const schema = 'SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name';
  if (version < 1 || JSON.stringify(db.prepare(schema).all()) !== JSON.stringify(expected.prepare(schema).all())) {
    throw new BackupError('The file does not have a supported workspace schema.');
  }
  checkIntegrity(db);
  if (kind !== (db.prepare('SELECT 1 FROM demo_baseline WHERE id = 1').get() ? 'demo' : 'live')) {
    throw new BackupError('Choose a backup made from the same Live or Demo workspace type.');
  }
}

export async function restoreBackup(db: DatabaseSync, kind: WorkspaceKind, fixture: string, filename: string) {
  const current = db.location()!;
  const directory = dirname(current);
  const staging = mkdtempSync(join(directory, '.sp-restore-'));
  try {
    let replacement: DatabaseSync;
    try {
      if (!statSync(filename).isFile()) throw new BackupError('Choose a SQLite workspace backup file.');
      const stagedFile = join(staging, `${kind}.sqlite3`);
      copyFileSync(filename, stagedFile);
      validateBackup(stagedFile, kind);
      replacement = openWorkspace(staging, kind, fixture);
    } catch (error) {
      if (error instanceof BackupError) throw error;
      console.error(error);
      throw new BackupError('The backup could not be opened or upgraded. The existing books are unchanged.');
    }
    using staged = replacement;
    checkIntegrity(staged);
    const workspace = readWorkspace(staged);
    writeSnapshot(db, join(directory, `${kind}.before-restore.sqlite3`));
    // SQLite commits the copy as one transaction, so interruption leaves a complete set of books.
    await backup(staged, current);
    return workspace;
  } finally {
    removeStaging(staging);
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
  const firm = requireFirm(db, command.firmId);
  return command.operation === 'getReport' ? getReport(db, firm.id, command.input) : runAccountingCommand(db, firm, { ...command, operation: command.operation });
}

if (parentPort) {
  const port = parentPort;
  const databases = new Map<WorkspaceKind, DatabaseSync>();
  let queue = Promise.resolve();
  async function respond({ id, command }: { id: number; command: BackupCommand | WorkspaceCommand | BookCommand }) {
    let reply: WorkerReply;
    try {
      const { kind } = command;
      let db = databases.get(kind);
      if (!db) {
        db = openWorkspace(workerData.directory, kind, workerData.fixture);
        databases.set(kind, db);
      }
      let result: WorkerResult;
      if (command.operation === 'backup') {
        saveBackup(db, command.filename);
        result = true;
      } else if (command.operation === 'restore') {
        result = await restoreBackup(db, kind, workerData.fixture, command.filename);
      } else {
        result = 'firmId' in command ? runBookCommand(db, command) : runWorkspaceCommand(db, command);
      }
      reply = { id, result };
    } catch (error) {
      const invalidInput = error instanceof FirmInputError || error instanceof BookInputError ||
        error instanceof StatementFileError || error instanceof BackupError;
      if (!invalidInput) console.error(error);
      reply = { id, error: invalidInput ? error.message
        : command.operation === 'backup' ? 'The backup could not be saved. Check the destination and try again.'
        : command.operation === 'restore' ? 'Restore could not finish. The existing books are unchanged.'
        : 'The workspace could not be accessed. Check its files and try again.' };
    }
    port.postMessage(reply);
  }
  port.on('message', (request: Parameters<typeof respond>[0]) => {
    queue = queue.then(() => respond(request));
  });
}
