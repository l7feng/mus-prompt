'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 只暴露白名单动作，渲染进程拿不到 fs / child_process。
contextBridge.exposeInMainWorld('p85', {
  loadContract: () => ipcRenderer.invoke('contract:load'),
  runExport: (selection) => ipcRenderer.invoke('export:run', selection),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  loadUi: () => ipcRenderer.invoke('ui:load'),
  saveUi: (payload) => ipcRenderer.invoke('ui:save', payload),
  loadSop2: () => ipcRenderer.invoke('sop2:load'),
  exportSop2: (payload) => ipcRenderer.invoke('sop2:export', payload),
  copyTextAny: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  exportDir: () => ipcRenderer.invoke('export:dir'),
  revealExport: (payload) => ipcRenderer.invoke('export:reveal', payload),
  loadAppInfo: () => ipcRenderer.invoke('app:info'),
  loadMcpToken: () => ipcRenderer.invoke('mcp:token'),
  onAutoExport: (callback) => ipcRenderer.on('auto:export', () => callback()),
  notifyDone: (result) => ipcRenderer.send('auto:done', result)
});
