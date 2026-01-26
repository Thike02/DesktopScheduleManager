const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notionAPI', {
  fetchEvents: (dates) => ipcRenderer.invoke('fetch-events', dates),
  addEvent: (eventData) => ipcRenderer.invoke('add-event', eventData),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings)
});