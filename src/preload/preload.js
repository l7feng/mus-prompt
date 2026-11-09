'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 只暴露四个白名单动作，渲染进程拿不到 fs / child_process。
contextBridge.exposeInMainWorld('p85', {
  loadContract: () => ipcRenderer.invoke('contract:load'),
  runExport: (selection) => ipcRenderer.invoke('export:run', selection),
  onAutoExport: (callback) => ipcRenderer.on('auto:export', () => callback()),
  notifyDone: (result) => ipcRenderer.send('auto:done', result)
});
