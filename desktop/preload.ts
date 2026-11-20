import { contextBridge, ipcRenderer } from 'electron';
import type { WorkspaceBridge } from './workspace';

const bridge: WorkspaceBridge = {
  read: (kind) => ipcRenderer.invoke('workspace:read', kind),
  saveName: (kind, name) => ipcRenderer.invoke('workspace:save-name', kind, name),
  isMac: process.platform === 'darwin',
};

contextBridge.exposeInMainWorld('workspaces', bridge);
