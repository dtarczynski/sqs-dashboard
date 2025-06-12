const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getQueues: () => ipcRenderer.invoke('get-queues'),
  purgeQueue: (queueUrl) => ipcRenderer.invoke('purge-queue', queueUrl),
  deleteQueue: (queueUrl) => ipcRenderer.invoke('delete-queue', queueUrl),
  checkConnection: () => ipcRenderer.invoke('check-connection'),
  changeRegion: (newRegion) => ipcRenderer.invoke('change-region', newRegion),
  getCurrentRegion: () => ipcRenderer.invoke('get-current-region')
});