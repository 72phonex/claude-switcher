const { app, BrowserWindow, BrowserView, Menu, nativeImage, Notification, Tray, ipcMain, session, shell } = require('electron');
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
const accountViews = new Map();
let activeViewId;
const accountUsage = new Map();
const resetTimers = new Map();
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
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  const icon = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#d97757"/><text x="16" y="23" text-anchor="middle" font-size="21" fill="#28150f">✦</text></svg>'
  );
  tray = new Tray(nativeImage.createFromDataURL(icon));
  tray.setToolTip('Claude Switcher');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Claude Switcher', click: () => { mainWindow.show(); mainWindow.focus(); } },
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
        sandbox: true
      }
    });
    view.webContents.setUserAgent(CHROME_USER_AGENT);
    view.webContents.loadURL(CLAUDE_URL);
    accountViews.set(account.id, view);
  }
  return view;
}

function registerIpc() {
  ipcMain.handle('accounts:list', () => {
    accounts.forEach((account) => getAccountView(account));
    return accounts;
  });

  ipcMain.handle('account-view:show', (_event, id) => {
    const account = accounts.find((item) => item.id === id);
    if (!account || !mainWindow) throw new Error('Account not found');
    const view = getAccountView(account);
    if (activeViewId && activeViewId !== id) {
      const previous = accountViews.get(activeViewId);
      if (previous) mainWindow.removeBrowserView(previous);
    }
    mainWindow.addBrowserView(view);
    activeViewId = id;
    return true;
  });

  ipcMain.handle('account-view:hide', () => {
    if (!mainWindow || !activeViewId) return false;
    const view = accountViews.get(activeViewId);
    if (view) mainWindow.removeBrowserView(view);
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
    view.setBounds(safeBounds);
    return true;
  });

  ipcMain.handle('account-view:reload', () => {
    const view = activeViewId && accountViews.get(activeViewId);
    if (view) view.webContents.reload();
    return Boolean(view);
  });

  ipcMain.handle('account-view:usage', async () => {
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

  ipcMain.handle('accounts:delete', async (_event, id) => {
    const index = accounts.findIndex((item) => item.id === id);
    if (index === -1) throw new Error('Account not found');
    const [account] = accounts.splice(index, 1);
    const view = accountViews.get(account.id);
    if (view && mainWindow) mainWindow.removeBrowserView(view);
    if (view) {
      view.webContents.destroy();
      accountViews.delete(account.id);
    }
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
    if (typeof url === 'string' && /^https:\/\/(www\.)?claude\.ai(\/|$)/.test(url)) {
      return shell.openExternal(url);
    }
    return false;
  });
}

app.whenReady().then(async () => {
  configPath = path.join(app.getPath('userData'), 'accounts.json');
  await loadAccounts();
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
