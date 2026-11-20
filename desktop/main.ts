import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { BOOK_OPERATIONS } from './books';
import type { BookCommand, BookResult } from './books';
import { CHANNELS, isWorkspaceKind, workspaceName } from './workspace';
import type { WorkerReply, Workspace, WorkspaceCommand } from './workspace';

const profile = app.commandLine.getSwitchValue('user-data-dir');
if (profile) {
  const directory = resolve(profile);
  mkdirSync(directory, { recursive: true });
  app.setPath('userData', directory);
}

const renderer = join(__dirname, '../renderer/index.html');
const rendererUrl = pathToFileURL(renderer).href;
let window: BrowserWindow | null = null;

function openWindow() {
  window = new BrowserWindow({
    title: 'SP & Company Accounts',
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 540,
    backgroundColor: '#f5f4ef',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  window.on('closed', () => { window = null; });
  void window.loadFile(renderer).catch(console.error);
}

function bindWorkspace(directory: string) {
  const worker = new Worker(join(__dirname, 'database.js'), {
    workerData: { directory, fixture: join(app.getAppPath(), 'fixtures/prototype-2026-11-20.json') },
  });
  const pending = new Map<number, { resolve: (result: Workspace | BookResult) => void; reject: (error: Error) => void }>();
  let nextId = 0;
  let available = true;
  const unavailable = () => new Error('The database worker stopped. Reopen the app to retry.');

  worker.on('message', (reply: WorkerReply) => {
    const request = pending.get(reply.id);
    pending.delete(reply.id);
    if ('error' in reply) request?.reject(new Error(reply.error));
    else request?.resolve(reply.result);
  });
  worker.on('error', console.error);
  worker.on('exit', () => {
    available = false;
    for (const request of pending.values()) request.reject(unavailable());
    pending.clear();
  });

  function dispatch(command: WorkspaceCommand | BookCommand) {
    if (!available) throw unavailable();
    const id = ++nextId;
    return new Promise<Workspace | BookResult>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, command });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  function requireWindow(event: IpcMainInvokeEvent) {
    const frame = event.senderFrame;
    if (!window || event.sender !== window.webContents || !frame ||
        frame !== event.sender.mainFrame || frame.url !== rendererUrl) {
      throw new Error('Workspace access denied.');
    }
    return window;
  }

  function validateCaller(event: IpcMainInvokeEvent, kind: unknown) {
    requireWindow(event);
    if (!isWorkspaceKind(kind)) throw new Error('Unknown workspace.');
    return kind;
  }

  ipcMain.handle('desktop:output', async (event, input: unknown) => {
    const parent = requireWindow(event);
    if (typeof input !== 'object' || input === null) throw new Error('Choose a print or export action.');
    const { kind, title, csv } = input as Record<string, unknown>;
    if (typeof title !== 'string' || !title.trim() || title.length > 180) throw new Error('Enter a valid document name.');
    if (kind === 'print') return new Promise<boolean>((resolve, reject) => {
      parent.webContents.print({ pageSize: 'A4' }, (success, reason) => {
        if (success || /cancel/i.test(reason)) resolve(success);
        else reject(new Error(reason || 'The document could not be printed.'));
      });
    });
    if (kind !== 'pdf' && kind !== 'csv') throw new Error('Choose PDF or CSV.');
    if (kind === 'csv' && (typeof csv !== 'string' || csv.length > 50_000_000)) throw new Error('The CSV export is too large.');
    const data = kind === 'pdf' ? await parent.webContents.printToPDF({ pageSize: 'A4', preferCSSPageSize: true })
      : '\uFEFF' + csv;
    const filename = title.replace(/[^\p{L}\p{N} ._-]/gu, '-').trim().replace(/^\.+/, '') || 'Accounts';
    const { canceled, filePath } = await dialog.showSaveDialog(parent, {
      title: kind === 'pdf' ? 'Save PDF' : 'Export CSV', defaultPath: filename + '.' + kind,
      filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
    });
    if (canceled || !filePath) return false;
    await writeFile(filePath, data);
    return true;
  });

  ipcMain.handle(CHANNELS.read, (event, kind: unknown) => (
    dispatch({ operation: 'read', kind: validateCaller(event, kind) })
  ));
  ipcMain.handle(CHANNELS.saveName, (event, kind: unknown, name: unknown) => (
    dispatch({ operation: 'saveName', kind: validateCaller(event, kind), name: workspaceName(name) })
  ));
  ipcMain.handle(CHANNELS.saveFirm, (event, kind: unknown, id: unknown, details: unknown) => (
    dispatch({ operation: 'saveFirm', kind: validateCaller(event, kind), id, details })
  ));
  ipcMain.handle(CHANNELS.selectFirm, (event, kind: unknown, id: unknown) => (
    dispatch({ operation: 'selectFirm', kind: validateCaller(event, kind), id })
  ));
  ipcMain.handle(CHANNELS.removeFirm, (event, kind: unknown, id: unknown) => (
    dispatch({ operation: 'removeFirm', kind: validateCaller(event, kind), id })
  ));
  for (const operation of BOOK_OPERATIONS) {
    ipcMain.handle('books:' + operation, (event, kind: unknown, firmId: unknown, input: unknown) => (
      dispatch({ operation, kind: validateCaller(event, kind), firmId, input })
    ));
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.commandLine.appendSwitch('disable-background-networking');
  app.whenReady().then(() => {
    const desktopSession = session.defaultSession;
    desktopSession.setPermissionCheckHandler(() => false);
    desktopSession.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));
    desktopSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (_request, respond) => respond({ cancel: true }));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      process.platform === 'darwin' ? { role: 'appMenu' } : { role: 'fileMenu' },
      { role: 'editMenu' },
    ]));
    bindWorkspace(join(app.getPath('userData'), 'workspaces'));
    openWindow();
  }).catch((error) => { console.error(error); app.quit(); });

  app.on('activate', () => { if (!window) openWindow(); });
  app.on('second-instance', () => {
    if (!window) openWindow();
    else {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
