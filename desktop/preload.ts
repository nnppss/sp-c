import { contextBridge, ipcRenderer } from 'electron';
import type { WorkspaceBridge } from './workspace';

const bridge: WorkspaceBridge = {
  read: (kind) => ipcRenderer.invoke('workspace:read', kind),
  saveName: (kind, name) => ipcRenderer.invoke('workspace:save-name', kind, name),
  saveFirm: (kind, id, details) => ipcRenderer.invoke('workspace:save-firm', kind, id, details),
  selectFirm: (kind, id) => ipcRenderer.invoke('workspace:select-firm', kind, id),
  removeFirm: (kind, id) => ipcRenderer.invoke('workspace:remove-firm', kind, id),
  isMac: process.platform === 'darwin',
};

contextBridge.exposeInMainWorld('workspaces', bridge);
