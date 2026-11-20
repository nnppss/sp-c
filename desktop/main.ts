import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { app, BrowserWindow, ipcMain, Menu, session } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
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
  const pending = new Map<number, { resolve: (workspace: Workspace) => void; reject: (error: Error) => void }>();
  let nextId = 0;
  let available = true;
  const unavailable = () => new Error('The database worker stopped. Reopen the app to retry.');

  worker.on('message', (reply: WorkerReply) => {
    const request = pending.get(reply.id);
    pending.delete(reply.id);
    if ('error' in reply) request?.reject(new Error(reply.error));
    else request?.resolve(reply.workspace);
  });
  worker.on('error', console.error);
  worker.on('exit', () => {
    available = false;
    for (const request of pending.values()) request.reject(unavailable());
    pending.clear();
  });

  function dispatch(command: WorkspaceCommand) {
    if (!available) throw unavailable();
    const id = ++nextId;
    return new Promise<Workspace>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, command });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  function validateCaller(event: IpcMainInvokeEvent, kind: unknown) {
    const frame = event.senderFrame;
    if (!window || event.sender !== window.webContents || !frame ||
        frame !== event.sender.mainFrame || frame.url !== rendererUrl) {
      throw new Error('Workspace access denied.');
    }
    if (!isWorkspaceKind(kind)) throw new Error('Unknown workspace.');
    return kind;
  }

  ipcMain.handle(CHANNELS.read, (event, kind: unknown) => (
    dispatch({ operation: 'read', kind: validateCaller(event, kind) })
  ));
  ipcMain.handle(CHANNELS.saveName, (event, kind: unknown, name: unknown) => (
    dispatch({ operation: 'saveName', kind: validateCaller(event, kind), name: workspaceName(name) })
  ));
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
