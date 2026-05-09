'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopClipboard', {
  readText: () => ipcRenderer.invoke('clipboard:read-text'),
  writeText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
});
