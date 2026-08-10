const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vibecheck', {
  onStatus: (cb) => ipcRenderer.on('status', (_e, data) => cb(data)),
  onReveal: (cb) => ipcRenderer.on('reveal', () => cb()),
  onConceal: (cb) => ipcRenderer.on('conceal', () => cb()),
  onChime: (cb) => ipcRenderer.on('chime', (_e, kind, theme) => cb(kind, theme)),
  onUsage: (cb) => ipcRenderer.on('usage', (_e, data) => cb(data)),
  onNotice: (cb) => ipcRenderer.on('notice', (_e, data) => cb(data)),
  onPosition: (cb) => ipcRenderer.on('position', (_e, pos) => cb(pos)),
});
