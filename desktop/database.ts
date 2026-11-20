import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { isWorkspaceKind, workspaceName } from './workspace';
import type { WorkerReply, Workspace, WorkspaceCommand, WorkspaceKind } from './workspace';

const migrations = [
  `CREATE TABLE workspace_settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   ) STRICT;
   CREATE TABLE demo_baseline (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     snapshot TEXT NOT NULL CHECK (json_valid(snapshot))
   ) STRICT;`,
];

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
    if (kind === 'demo' && !db.prepare('SELECT 1 FROM demo_baseline WHERE id = 1').get()) {
      db.prepare('INSERT INTO demo_baseline VALUES (1, ?)').run(readFileSync(fixture, 'utf8'));
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
  const demo = db.prepare(`SELECT json_array_length(snapshot, '$.vouchers') AS vouchers,
    json_extract(snapshot, '$.trialBalance.debit') AS debit,
    json_extract(snapshot, '$.trialBalance.credit') AS credit FROM demo_baseline WHERE id = 1`).get();
  return { name, demo: (demo as Workspace['demo']) ?? null };
}

if (parentPort) {
  const port = parentPort;
  const databases = new Map<WorkspaceKind, DatabaseSync>();
  port.on('message', ({ id, command }: { id: number; command: WorkspaceCommand }) => {
    let reply: WorkerReply;
    try {
      const { kind } = command;
      let db = databases.get(kind);
      if (!db) {
        db = openWorkspace(workerData.directory, kind, workerData.fixture);
        databases.set(kind, db);
      }
      switch (command.operation) {
        case 'saveName':
          db.prepare("UPDATE workspace_settings SET value = ? WHERE key = 'name'").run(workspaceName(command.name));
          break;
        case 'read':
          break;
        default:
          throw new Error('Unknown workspace operation.');
      }
      reply = { id, workspace: readWorkspace(db) };
    } catch (error) {
      console.error(error);
      reply = { id, error: 'The workspace could not be accessed. Check its files and try again.' };
    }
    port.postMessage(reply);
  });
}
