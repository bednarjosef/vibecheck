const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vc', {
  getState: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  setLimits: (on) => ipcRenderer.invoke('limits:set', on),
  close: () => ipcRenderer.send('settings:close'),
});
