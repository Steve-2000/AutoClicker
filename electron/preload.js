const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window discovery
  getWindows: () => ipcRenderer.invoke('get-windows'),

  // Screen capture
  captureWindow: (handle) => ipcRenderer.invoke('capture-window', handle),

  // Target selection (maps image click → screen coords)
  setClickTarget: (coords) => ipcRenderer.invoke('set-click-target', coords),

  doSingleClick: (target) => ipcRenderer.invoke('do-single-click', target),
  startAutoClick: (opts) => ipcRenderer.invoke('start-auto-click', opts),
  stopAutoClick: () => ipcRenderer.invoke('stop-auto-click'),

  // Events from main process → renderer
  onClickFired: (cb) => ipcRenderer.on('click-fired', (_e, d) => cb(d)),
  onAutoClickStopped: (cb) => ipcRenderer.on('auto-click-stopped', (_e, d) => cb(d)),
  removeAllListeners: (ch) => ipcRenderer.removeAllListeners(ch),
});
