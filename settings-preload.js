const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vc', {
  getState: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  close: () => ipcRenderer.send('settings:close'),
});
