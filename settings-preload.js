const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vc', {
  getState: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  captureKey: () => ipcRenderer.invoke('key:capture'),
  captureDom: (dom) => ipcRenderer.send('key:capture:dom', dom),
  captureCancel: () => ipcRenderer.send('key:capture:cancel'),
  fit: (height) => ipcRenderer.send('settings:fit', height),
  close: () => ipcRenderer.send('settings:close'),
});
