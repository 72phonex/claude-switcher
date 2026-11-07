const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeSwitcher', {
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    add: (name) => ipcRenderer.invoke('accounts:add', name),
    rename: (id, name) => ipcRenderer.invoke('accounts:rename', { id, name }),
    remove: (id) => ipcRenderer.invoke('accounts:delete', id),
    clearSession: (id) => ipcRenderer.invoke('accounts:clear-session', id),
    showView: (id) => ipcRenderer.invoke('account-view:show', id),
    setViewBounds: (bounds) => ipcRenderer.invoke('account-view:bounds', bounds),
    reloadView: () => ipcRenderer.invoke('account-view:reload'),
    openExternal: () => ipcRenderer.invoke('account-view:open-external')
  },
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url)
});
