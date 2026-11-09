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
    usage: (includeActive) => ipcRenderer.invoke('account-view:usage', includeActive),
    history: () => ipcRenderer.invoke('account-view:history'),
    openHistory: (url) => ipcRenderer.invoke('account-view:open-history', url)
  },
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  exportConfig: () => ipcRenderer.invoke('config:export'),
  importConfig: () => ipcRenderer.invoke('config:import'),
  startupStatus: () => ipcRenderer.invoke('app:startup-status'),
  setStartup: (enabled) => ipcRenderer.invoke('app:set-startup', enabled),
  memoryMode: () => ipcRenderer.invoke('app:memory-mode'),
  setMemoryMode: (mode) => ipcRenderer.invoke('app:set-memory-mode', mode),
  usageRefreshMinutes: () => ipcRenderer.invoke('app:usage-refresh-minutes'),
  setUsageRefreshMinutes: (minutes) => ipcRenderer.invoke('app:set-usage-refresh-minutes', minutes),
  onTrayRefreshUsage: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:tray-refresh-usage', listener);
    return () => ipcRenderer.removeListener('app:tray-refresh-usage', listener);
  },
  checkUpdates: () => ipcRenderer.invoke('app:check-updates')
});
