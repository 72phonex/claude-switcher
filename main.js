const { app, BrowserWindow, BrowserView, ipcMain, session, shell } = require('electron');
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

async function loadAccounts() {
  try {
    accounts = JSON.parse(await fs.readFile(configPath, 'utf8'));
    if (!Array.isArray(accounts)) accounts = [];
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
  mainWindow.on('closed', () => { mainWindow = null; });
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
  ipcMain.handle('accounts:list', () => accounts);

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
  }
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
