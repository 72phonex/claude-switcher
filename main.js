const { app, BrowserWindow, BrowserView, dialog, Menu, nativeImage, Notification, Tray, ipcMain, session, shell } = require('electron');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');

const CLAUDE_URL = 'https://claude.ai/';
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

let mainWindow;
let accounts = [];
let configPath;
let preferencesPath;
let preferences = { memoryMode: 'balanced', usageRefreshMinutes: 5, startMinimized: false };
const accountViews = new Map();
const accountViewLoads = new Map();
let viewUseOrder = [];
let activeViewId;
let attachedViewId;
let startMinimizedLaunch = false;
const accountUsage = new Map();
const resetTimers = new Map();
let activeViewBounds;
let tray;
let isQuitting = false;

async function loadAccounts() {
  try {
    accounts = JSON.parse(await fs.readFile(configPath, 'utf8'));
    if (!Array.isArray(accounts)) accounts = [];
    accounts = accounts.map((account) => ({
      ...account,
      reminderEnabled: account.reminderEnabled !== false
    }));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Unable to load accounts:', error);
    accounts = [];
  }
}

async function saveAccounts() {
  await fs.writeFile(configPath, JSON.stringify(accounts, null, 2), 'utf8');
}

async function loadPreferences() {
  try {
    const saved = JSON.parse(await fs.readFile(preferencesPath, 'utf8'));
    if (['normal', 'balanced', 'ultra-low'].includes(saved.memoryMode)) {
      preferences.memoryMode = saved.memoryMode;
    }
    if ([1, 5, 15, 30].includes(saved.usageRefreshMinutes)) {
      preferences.usageRefreshMinutes = saved.usageRefreshMinutes;
    }
    if (typeof saved.startMinimized === 'boolean') preferences.startMinimized = saved.startMinimized;
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Unable to load preferences:', error);
  }
}

async function savePreferences() {
  await fs.writeFile(preferencesPath, JSON.stringify(preferences, null, 2), 'utf8');
}

function accountPartition(id) {
  return `persist:account_${id}`;
}

function scheduleResetNotification(account, usage) {
  const existingTimer = resetTimers.get(account.id);
  if (existingTimer) clearTimeout(existingTimer);
  resetTimers.delete(account.id);

  if (account.reminderEnabled === false || !usage.limited || !Number.isFinite(usage.resetAt) || usage.resetAt <= Date.now() || !Notification.isSupported()) {
    return;
  }

  const delay = usage.resetAt - Date.now();
  const timer = setTimeout(() => {
    resetTimers.delete(account.id);
    new Notification({
      title: `${account.name} is ready again`,
      body: 'Claude token usage should be restored. Open Claude to continue.'
    }).show();
  }, delay);
  resetTimers.set(account.id, timer);
}

function makeAccount(name) {
  const id = crypto.randomUUID();
  return {
    id,
    name: name.trim() || `Account ${accounts.length + 1}`,
    partition: accountPartition(id),
    createdAt: new Date().toISOString()
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#171716',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    if (startMinimizedLaunch && !mainWindow.isVisible()) return;
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      unloadBackgroundViews();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('show', attachActiveView);
  mainWindow.on('restore', attachActiveView);
  mainWindow.on('minimize', unloadBackgroundViews);
}

function destroyAccountView(id) {
  const view = accountViews.get(id);
  if (!view) return;
  if (mainWindow && attachedViewId === id) {
    mainWindow.removeBrowserView(view);
    attachedViewId = undefined;
  }
  view.webContents.destroy();
  accountViews.delete(id);
  accountViewLoads.delete(id);
  viewUseOrder = viewUseOrder.filter((accountId) => accountId !== id);
}

function unloadBackgroundViews() {
  for (const id of accountViews.keys()) destroyAccountView(id);
}

function pruneInactiveViews() {
  const retainedCount = preferences.memoryMode === 'normal'
    ? Infinity
    : preferences.memoryMode === 'balanced' ? 1 : 0;
  const inactiveIds = viewUseOrder.filter((id) => id !== activeViewId);
  inactiveIds.slice(0, Math.max(0, inactiveIds.length - retainedCount)).forEach(destroyAccountView);
}

function attachActiveView() {
  if (!mainWindow || !activeViewId) return;
  const account = accounts.find((item) => item.id === activeViewId);
  if (!account) return;
  const view = getAccountView(account);
  if (attachedViewId !== activeViewId) {
    mainWindow.addBrowserView(view);
    attachedViewId = activeViewId;
  }
  if (activeViewBounds) view.setBounds(activeViewBounds);
  viewUseOrder = viewUseOrder.filter((accountId) => accountId !== activeViewId);
  viewUseOrder.push(activeViewId);
  pruneInactiveViews();
}

function createTray() {
  const icon = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#d97757"/><text x="16" y="23" text-anchor="middle" font-size="21" fill="#28150f">✦</text></svg>'
  );
  tray = new Tray(nativeImage.createFromDataURL(icon));
  tray.setToolTip('Claude Switcher');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Claude Switcher', click: () => { startMinimizedLaunch = false; mainWindow.show(); mainWindow.focus(); } },
    { label: 'Refresh usage', click: () => { mainWindow.webContents.send('app:tray-refresh-usage'); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

function getAccountView(account) {
  let view = accountViews.get(account.id);
  if (!view) {
    view = new BrowserView({
      webPreferences: {
        session: session.fromPartition(account.partition),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: true
      }
    });
    view.webContents.setUserAgent(CHROME_USER_AGENT);
    const loadPromise = view.webContents.loadURL(CLAUDE_URL);
    accountViewLoads.set(account.id, loadPromise);
    loadPromise.then(
      () => {
        if (accountViewLoads.get(account.id) === loadPromise) accountViewLoads.delete(account.id);
      },
      (error) => {
        if (accountViewLoads.get(account.id) === loadPromise) accountViewLoads.delete(account.id);
        console.warn(`Could not load Claude for ${account.name}:`, error.message);
      }
    );
    accountViews.set(account.id, view);
  }
  return view;
}

function registerIpc() {
  ipcMain.handle('accounts:list', () => {
    return accounts;
  });

  ipcMain.handle('app:memory-mode', () => preferences.memoryMode);
  ipcMain.handle('app:set-memory-mode', async (_event, mode) => {
    if (!['normal', 'balanced', 'ultra-low'].includes(mode)) throw new Error('Invalid memory mode');
    const previousMode = preferences.memoryMode;
    preferences.memoryMode = mode;
    try {
      await savePreferences();
    } catch (error) {
      preferences.memoryMode = previousMode;
      throw error;
    }
    pruneInactiveViews();
    return preferences.memoryMode;
  });
  ipcMain.handle('app:usage-refresh-minutes', () => preferences.usageRefreshMinutes);
  ipcMain.handle('app:set-usage-refresh-minutes', async (_event, minutes) => {
    if (![1, 5, 15, 30].includes(minutes)) throw new Error('Invalid usage refresh interval');
    const previousMinutes = preferences.usageRefreshMinutes;
    preferences.usageRefreshMinutes = minutes;
    try {
      await savePreferences();
    } catch (error) {
      preferences.usageRefreshMinutes = previousMinutes;
      throw error;
    }
    return preferences.usageRefreshMinutes;
  });
  ipcMain.handle('app:start-minimized', () => preferences.startMinimized);
  ipcMain.handle('app:set-start-minimized', async (_event, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid start-minimized setting');
    const previousSetting = preferences.startMinimized;
    const startupEnabled = app.getLoginItemSettings().openAtLogin;
    if (startupEnabled) {
      app.setLoginItemSettings({
        openAtLogin: true,
        args: enabled ? ['--start-minimized'] : []
      });
    }
    preferences.startMinimized = enabled;
    try {
      await savePreferences();
    } catch (error) {
      preferences.startMinimized = previousSetting;
      if (startupEnabled) {
        app.setLoginItemSettings({
          openAtLogin: true,
          args: previousSetting ? ['--start-minimized'] : []
        });
      }
      throw error;
    }
    return preferences.startMinimized;
  });

  ipcMain.handle('account-view:show', (_event, id) => {
    const account = accounts.find((item) => item.id === id);
    if (!account || !mainWindow) throw new Error('Account not found');
    if (startMinimizedLaunch && !mainWindow.isVisible()) {
      activeViewId = id;
      return true;
    }
    const view = getAccountView(account);
    if (activeViewId && activeViewId !== id) {
      const previous = accountViews.get(activeViewId);
      if (previous) {
        mainWindow.removeBrowserView(previous);
        attachedViewId = undefined;
      }
    }
    if (attachedViewId !== id) {
      mainWindow.addBrowserView(view);
      attachedViewId = id;
    }
    activeViewId = id;
    viewUseOrder = viewUseOrder.filter((accountId) => accountId !== id);
    viewUseOrder.push(id);
    pruneInactiveViews();
    return true;
  });

  ipcMain.handle('account-view:hide', () => {
    if (!mainWindow || !activeViewId) return false;
    const view = accountViews.get(activeViewId);
    if (view) {
      mainWindow.removeBrowserView(view);
      attachedViewId = undefined;
    }
    return Boolean(view);
  });

  ipcMain.handle('account-view:bounds', (_event, bounds) => {
    if (!mainWindow || !activeViewId || !bounds) return false;
    const view = accountViews.get(activeViewId);
    if (!view) return false;
    const safeBounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height))
    };
    activeViewBounds = safeBounds;
    view.setBounds(safeBounds);
    return true;
  });

  ipcMain.handle('account-view:reload', () => {
    const view = activeViewId && accountViews.get(activeViewId);
    if (view) view.webContents.reload();
    return Boolean(view);
  });

  ipcMain.handle('account-view:usage', async (_event, includeActive = false) => {
    if (typeof includeActive !== 'boolean') throw new Error('Invalid usage refresh request');
    let temporaryViewId;
    try {
      if (includeActive && activeViewId && !accountViews.has(activeViewId)) {
        const account = accounts.find((item) => item.id === activeViewId);
        if (account) {
          temporaryViewId = account.id;
          getAccountView(account);
          const loadPromise = accountViewLoads.get(account.id);
          if (loadPromise) await loadPromise;
        }
      }
      const results = [];
      for (const account of accounts) {
        const view = accountViews.get(account.id);
        if (!view || view.webContents.isLoading()) continue;
        try {
          const usage = await view.webContents.executeJavaScript(`(() => {
            const body = document.body ? document.body.innerText : '';
            const selectors = ['[data-testid*="user-message"]', '[data-is-user="true"]', '[class*="user-message"]'];
            const nodes = [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))];
            const messages = nodes.length;
            const tokens = Math.max(0, Math.round(nodes.reduce((total, node) => total + (node.innerText || '').length, 0) / 4));
            const reset = body.match(/(?:until|resets? at|available again)\\s+([^\\.\\n]{3,80})/i);
            const limited = /reached (?:your )?limit|usage limit|try again later/i.test(body);
            const resetText = reset ? reset[1].trim() : '';
            let resetAt = resetText ? Date.parse(resetText) : NaN;
            if (Number.isFinite(resetAt) && resetAt <= Date.now()) resetAt += 24 * 60 * 60 * 1000;
            const signedOut = /sign in|log in|create an account/i.test(body) && messages === 0;
            const networkError = /unable to connect|network error|offline|this site can.t be reached/i.test(body);
            const status = networkError ? 'network-error' : signedOut ? 'signed-out' : limited ? 'limited' : 'ready';
            return { messages, tokens, resetText, resetAt: Number.isFinite(resetAt) ? resetAt : null, limited, status };
          })()`, true);
          accountUsage.set(account.id, usage);
          account.lastUsage = {
            limited: usage.limited,
            resetAt: usage.resetAt,
            resetText: usage.resetText,
            status: usage.status,
            checkedAt: Date.now()
          };
          await saveAccounts();
          scheduleResetNotification(account, usage);
          results.push({ id: account.id, ...usage });
        } catch (error) {
          console.warn(`Could not inspect usage for ${account.name}:`, error.message);
        }
      }
      return results;
    } finally {
      if (temporaryViewId && (
        activeViewId !== temporaryViewId ||
        !mainWindow ||
        !mainWindow.isVisible() ||
        mainWindow.isMinimized()
      )) {
        destroyAccountView(temporaryViewId);
      }
    }
  });

  ipcMain.handle('account-view:history', async () => {
    const view = activeViewId && accountViews.get(activeViewId);
    if (!view) return [];
    try {
      return await view.webContents.executeJavaScript(`(() => {
        const links = [...document.querySelectorAll('a[href*="/chat/"], a[href*="/project/"]')];
        return [...new Map(links.map((link) => [link.href, {
          title: (link.innerText || link.textContent || '').trim(),
          href: link.href
        }]).filter(([, item]) => item.title)).values()].slice(0, 100);
      })()`, true);
    } catch (error) {
      console.warn('Could not read project history:', error.message);
      return [];
    }
  });

  ipcMain.handle('account-view:open-history', (_event, url) => {
    const view = activeViewId && accountViews.get(activeViewId);
    if (!view || typeof url !== 'string' || !/^https:\/\/claude\.ai\/(chat|project)\//.test(url)) {
      throw new Error('Invalid Claude history link');
    }
    view.webContents.loadURL(url);
    return true;
  });

  ipcMain.handle('account-view:open-external', () => {
    const view = activeViewId && accountViews.get(activeViewId);
    if (view) return shell.openExternal(view.webContents.getURL() || CLAUDE_URL);
    return shell.openExternal(CLAUDE_URL);
  });

  ipcMain.handle('accounts:add', async (_event, name) => {
    const account = makeAccount(typeof name === 'string' ? name : '');
    accounts.push(account);
    await saveAccounts();
    return account;
  });

  ipcMain.handle('accounts:rename', async (_event, { id, name }) => {
    const account = accounts.find((item) => item.id === id);
    if (!account) throw new Error('Account not found');
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) throw new Error('Account name cannot be empty');
    account.name = trimmedName;
    await saveAccounts();
    return account;
  });

  ipcMain.handle('accounts:set-reminder', async (_event, { id, enabled }) => {
    const account = accounts.find((item) => item.id === id);
    if (!account || typeof enabled !== 'boolean') throw new Error('Invalid reminder setting');
    account.reminderEnabled = enabled;
    if (!enabled) {
      const timer = resetTimers.get(id);
      if (timer) clearTimeout(timer);
      resetTimers.delete(id);
    } else if (account.lastUsage) {
      scheduleResetNotification(account, account.lastUsage);
    }
    await saveAccounts();
    return account;
  });

  ipcMain.handle('accounts:delete', async (_event, id) => {
    const index = accounts.findIndex((item) => item.id === id);
    if (index === -1) throw new Error('Account not found');
    const [account] = accounts.splice(index, 1);
    destroyAccountView(account.id);
    const timer = resetTimers.get(account.id);
    if (timer) clearTimeout(timer);
    resetTimers.delete(account.id);
    if (activeViewId === account.id) activeViewId = undefined;
    await saveAccounts();
    await session.fromPartition(account.partition).clearStorageData();
    return account.id;
  });

  ipcMain.handle('accounts:clear-session', async (_event, id) => {
    const account = accounts.find((item) => item.id === id);
    if (!account) throw new Error('Account not found');
    await session.fromPartition(account.partition).clearStorageData();
    return true;
  });

  ipcMain.handle('app:open-external', (_event, url) => {
    if (typeof url === 'string' && /^https:\/\/(www\.)?(claude\.ai|github\.com\/72phonex\/claude-switcher)(\/|$)/.test(url)) {
      return shell.openExternal(url);
    }
    return false;
  });

  ipcMain.handle('config:export', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Claude Switcher settings',
      defaultPath: 'claude-switcher-settings.json',
      filters: [{ name: 'JSON files', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return false;
    const safeAccounts = accounts.map(({ name, reminderEnabled, createdAt }) => ({
      name,
      reminderEnabled: reminderEnabled !== false,
      createdAt
    }));
    await fs.writeFile(result.filePath, JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts: safeAccounts
    }, null, 2), 'utf8');
    return true;
  });

  ipcMain.handle('config:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Claude Switcher settings',
      properties: ['openFile'],
      filters: [{ name: 'JSON files', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths[0]) return false;
    const imported = JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'));
    if (!imported || imported.version !== 1 || !Array.isArray(imported.accounts)) {
      throw new Error('Unsupported settings file');
    }
    const importedAccounts = imported.accounts
      .filter((account) => account && typeof account.name === 'string' && account.name.trim())
      .map((account) => ({
        ...makeAccount(account.name),
        reminderEnabled: account.reminderEnabled !== false
      }));
    accounts.push(...importedAccounts);
    await saveAccounts();
    return importedAccounts;
  });

  ipcMain.handle('app:startup-status', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('app:set-startup', (_event, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid startup setting');
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: enabled && preferences.startMinimized ? ['--start-minimized'] : []
    });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('app:check-updates', async () => {
    const response = await fetch('https://api.github.com/repos/72phonex/claude-switcher/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Claude-Switcher' }
    });
    if (response.status === 404) return { available: false, releaseUrl: 'https://github.com/72phonex/claude-switcher/releases' };
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    const release = await response.json();
    return {
      available: Boolean(release.tag_name),
      version: release.tag_name || null,
      releaseUrl: release.html_url || 'https://github.com/72phonex/claude-switcher/releases'
    };
  });
}

app.whenReady().then(async () => {
  configPath = path.join(app.getPath('userData'), 'accounts.json');
  preferencesPath = path.join(app.getPath('userData'), 'preferences.json');
  await loadAccounts();
  await loadPreferences();
  const loginSettings = app.getLoginItemSettings();
  startMinimizedLaunch = preferences.startMinimized &&
    (loginSettings.wasOpenedAtLogin || process.argv.includes('--start-minimized'));
  for (const account of accounts) {
    session.fromPartition(account.partition).setUserAgent(CHROME_USER_AGENT);
    if (account.lastUsage) scheduleResetNotification(account, account.lastUsage);
  }
  registerIpc();
  createWindow();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin' && !isQuitting) return;
});

app.on('before-quit', () => {
  isQuitting = true;
  resetTimers.forEach((timer) => clearTimeout(timer));
  resetTimers.clear();
  if (tray) tray.destroy();
});
