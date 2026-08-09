const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vibecheck', {
  onStatus: (cb) => ipcRenderer.on('status', (_e, data) => cb(data)),
  onReveal: (cb) => ipcRenderer.on('reveal', () => cb()),
  onConceal: (cb) => ipcRenderer.on('conceal', () => cb()),
  onChime: (cb) => ipcRenderer.on('chime', (_e, kind) => cb(kind)),
});
