const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeSwitcher', {
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    add: (name) => ipcRenderer.invoke('accounts:add', name),
    rename: (id, name) => ipcRenderer.invoke('accounts:rename', { id, name }),
    setReminderEnabled: (id, enabled) => ipcRenderer.invoke('accounts:set-reminder', { id, enabled }),
    remove: (id) => ipcRenderer.invoke('accounts:delete', id),
    clearSession: (id) => ipcRenderer.invoke('accounts:clear-session', id),
    showView: (id) => ipcRenderer.invoke('account-view:show', id),
    hideView: () => ipcRenderer.invoke('account-view:hide'),
    setViewBounds: (bounds) => ipcRenderer.invoke('account-view:bounds', bounds),
    reloadView: () => ipcRenderer.invoke('account-view:reload'),
    openExternal: () => ipcRenderer.invoke('account-view:open-external'),
    usage: () => ipcRenderer.invoke('account-view:usage'),
    history: () => ipcRenderer.invoke('account-view:history'),
    openHistory: (url) => ipcRenderer.invoke('account-view:open-history', url)
  },
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url)
});
