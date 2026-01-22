const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notionAPI', {
  fetchEvents: (dates) => ipcRenderer.invoke('fetch-events', dates),
  addEvent: (eventData) => ipcRenderer.invoke('add-event', eventData)
});