import { contextBridge, ipcRenderer } from 'electron';
import type { WorkspaceBridge } from './workspace';

const bridge: WorkspaceBridge = {
  read: (kind) => ipcRenderer.invoke('workspace:read', kind),
  saveName: (kind, name) => ipcRenderer.invoke('workspace:save-name', kind, name),
  saveFirm: (kind, id, details) => ipcRenderer.invoke('workspace:save-firm', kind, id, details),
  selectFirm: (kind, id) => ipcRenderer.invoke('workspace:select-firm', kind, id),
  removeFirm: (kind, id) => ipcRenderer.invoke('workspace:remove-firm', kind, id),
  getChart: (kind, firmId) => ipcRenderer.invoke('books:getChart', kind, firmId),
  createAccount: (kind, firmId, input) => ipcRenderer.invoke('books:createAccount', kind, firmId, input),
  postVoucher: (kind, firmId, input) => ipcRenderer.invoke('books:postVoucher', kind, firmId, input),
  reverseVoucher: (kind, firmId, input) => ipcRenderer.invoke('books:reverseVoucher', kind, firmId, input),
  getVoucher: (kind, firmId, input) => ipcRenderer.invoke('books:getVoucher', kind, firmId, input),
  getDayBook: (kind, firmId, input) => ipcRenderer.invoke('books:getDayBook', kind, firmId, input),
  getLedger: (kind, firmId, input) => ipcRenderer.invoke('books:getLedger', kind, firmId, input),
  getTrialBalance: (kind, firmId, input) => ipcRenderer.invoke('books:getTrialBalance', kind, firmId, input),
  isMac: process.platform === 'darwin',
};

contextBridge.exposeInMainWorld('workspaces', bridge);
