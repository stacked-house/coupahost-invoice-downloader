const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('coupaAPI', {
  checkBrowser: (browser) => ipcRenderer.invoke('check-browser', browser),
  launchBrowser: (browser) => ipcRenderer.invoke('launch-browser', browser),
  validateUrl: (url) => ipcRenderer.invoke('validate-url', url),
  startDownload: (url, script, configFile) => ipcRenderer.invoke('start-download', url, script, configFile)
});
