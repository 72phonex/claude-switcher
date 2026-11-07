const state = { accounts: [], activeId: null, views: new Map(), limited: new Set(), usage: new Map(), history: [] };
let managedAccount;
const $ = (id) => document.getElementById(id);
const list = $('account-list');

function initials(name) {
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function renderAccounts() {
  list.replaceChildren();
  state.accounts.forEach((account) => {
    const item = document.createElement('div');
    item.className = `account-item${account.id === state.activeId ? ' active' : ''}`;
    item.title = account.name;
    const usage = state.usage.get(account.id);
    const statusLabels = {
      limited: 'Limit reached',
      'signed-out': 'Sign in required',
      'network-error': 'Connection problem',
      ready: 'Ready to use'
    };
    const status = statusLabels[usage?.status] || 'Checking session...';
    const usageLine = usage ? `Usage: ~${usage.tokens.toLocaleString()} tokens` : 'Usage: measuring...';
    item.innerHTML = `<button class="account-select"><span class="avatar">${initials(account.name)}</span><span class="account-copy"><span class="account-name"></span><span class="account-status"></span><span class="account-usage"></span></span><span class="limit-dot${usage?.limited ? ' limited' : ''}"></span></button><button class="account-menu" title="Rename or manage account" aria-label="Rename or manage account">⚙</button>`;
    item.querySelector('.account-name').textContent = account.name;
    item.querySelector('.account-status').textContent = status;
    item.querySelector('.account-usage').textContent = usageLine;
    item.querySelector('.account-select').addEventListener('click', () => switchAccount(account.id));
    item.querySelector('.account-menu').addEventListener('click', () => openAccountSettings(account));
    list.append(item);
  });
  const active = state.accounts.find((account) => account.id === state.activeId);
  $('active-name').textContent = active ? active.name : 'No account';
  $('empty-state').classList.toggle('hidden', state.accounts.length > 0);
  renderUsage();
}

async function openAccountSettings(account) {
  managedAccount = account;
  $('account-dialog-title').textContent = account.name;
  $('account-dialog-subtitle').textContent = account.id === state.activeId ? 'Active Claude session' : 'Manage this Claude session';
  $('toggle-reminders').textContent = account.reminderEnabled === false
    ? 'Enable reset notifications'
    : 'Disable reset notifications';
  await window.claudeSwitcher.accounts.hideView();
  $('account-dialog').showModal();
}

async function removeManagedAccount() {
  if (!managedAccount) return;
  const account = managedAccount;
  const confirmation = window.prompt(`To remove "${account.name}", type REMOVE:`);
  if (confirmation !== 'REMOVE') return;
  try {
    await window.claudeSwitcher.accounts.remove(account.id);
    state.views.delete(account.id);
    state.accounts = state.accounts.filter((item) => item.id !== account.id);
    $('account-dialog').close();
    if (state.activeId === account.id) {
      state.activeId = state.accounts[0]?.id || null;
      if (state.activeId) switchAccount(state.activeId);
    }
    renderAccounts();
  } catch (error) {
    window.alert(`Could not remove account: ${error.message}`);
  }
}

function restoreActiveView() {
  if (state.activeId) {
    window.claudeSwitcher.accounts.showView(state.activeId).then(resizeWebviews);
  }
}

async function clearManagedSession() {
  if (!managedAccount) return;
  if (!window.confirm(`Clear the saved login session for "${managedAccount.name}"? You will need to sign in again.`)) return;
  try {
    await window.claudeSwitcher.accounts.clearSession(managedAccount.id);
    $('account-dialog').close();
    window.alert('Saved session cleared. Reload Claude and sign in again.');
  } catch (error) {
    window.alert(`Could not clear session: ${error.message}`);
  }
}

function createView(account) {
  state.views.set(account.id, account.id);
}

function resizeWebviews() {
  const stage = $('webview-stage').getBoundingClientRect();
  window.claudeSwitcher.accounts.setViewBounds({
    x: stage.left,
    y: stage.top,
    width: stage.width,
    height: stage.height
  });
}

function renderUsage() {
  const usage = state.usage.get(state.activeId);
  const count = usage?.tokens || 0;
  const fill = Math.min((count / 20000) * 100, 100);
  $('usage-meter-fill').style.width = `${fill}%`;
  $('usage-summary').textContent = usage?.resetText || (state.activeId ? 'No limit notice detected' : 'Select an account to see usage');
  $('usage-detail').textContent = state.activeId
    ? usage?.resetAt
      ? `Reminder scheduled for ${new Date(usage.resetAt).toLocaleString()}`
      : `Local estimate: ~${count.toLocaleString()} tokens`
    : 'Usage appears here when Claude exposes it';
}

async function refreshUsage() {
  const usageResults = await window.claudeSwitcher.accounts.usage();
  usageResults.forEach((usage) => {
    state.usage.set(usage.id, usage);
    if (usage.limited) state.limited.add(usage.id); else state.limited.delete(usage.id);
  });
  renderAccounts();
}

async function refreshHistory() {
  const panel = $('history-panel');
  const listElement = $('history-list');
  listElement.replaceChildren();
  $('history-account').textContent = state.activeId
    ? `Recent chats and projects for ${state.accounts.find((account) => account.id === state.activeId)?.name || 'this account'}`
    : 'Select an account to view its recent Claude activity.';
  const entries = await window.claudeSwitcher.accounts.history();
  if (!entries.length) {
    listElement.innerHTML = '<div class="history-empty">No project or chat links were found in this account session. Open Claude and refresh.</div>';
    return;
  }
  entries.forEach((entry) => {
    const link = document.createElement('button');
    link.className = 'history-entry';
    link.textContent = entry.title;
    link.addEventListener('click', async () => {
      await window.claudeSwitcher.accounts.openHistory(entry.href);
      $('history-panel').classList.add('hidden');
      $('webview-stage').classList.remove('hidden');
    });
    listElement.append(link);
  });
}

function switchAccount(id) {
  state.activeId = id;
  $('empty-state').classList.add('hidden');
  $('error-state').classList.add('hidden');
  renderAccounts();
  window.claudeSwitcher.accounts.showView(id)
    .then(resizeWebviews)
    .then(refreshUsage)
    .catch((error) => window.alert(`Could not open Claude: ${error.message}`));
}

async function addAccount() {
  const name = window.prompt('Name this Claude account:', `Account ${state.accounts.length + 1}`);
  if (name === null) return;
  if (!name.trim()) {
    window.alert('Please enter an account name.');
    return;
  }
  try {
    const account = await window.claudeSwitcher.accounts.add(name);
    state.accounts.push(account);
    createView(account);
    switchAccount(account.id);
  } catch (error) {
    window.alert(`Could not add account: ${error.message}`);
  }
}

async function renameAccount(account) {
  const name = window.prompt('Rename account:', account.name);
  if (name === null || name.trim() === account.name) return;
  try {
    const updated = await window.claudeSwitcher.accounts.rename(account.id, name);
    Object.assign(account, updated);
    renderAccounts();
  } catch (error) {
    window.alert(`Could not rename account: ${error.message}`);
  }
}

async function init() {
  state.accounts = await window.claudeSwitcher.accounts.list();
  state.accounts.forEach(createView);
  if (state.accounts[0]) switchAccount(state.accounts[0].id); else renderAccounts();
  window.setInterval(() => {
    refreshUsage().catch((error) => console.warn(`Automatic usage refresh failed: ${error.message}`));
  }, 5 * 60 * 1000);
}

$('add-account').addEventListener('click', addAccount);
$('empty-add').addEventListener('click', addAccount);
$('toggle-reminders').addEventListener('click', async () => {
  if (!managedAccount) return;
  try {
    const updated = await window.claudeSwitcher.accounts.setReminderEnabled(
      managedAccount.id,
      managedAccount.reminderEnabled === false
    );
    Object.assign(managedAccount, updated);
    $('toggle-reminders').textContent = managedAccount.reminderEnabled === false
      ? 'Enable reset notifications'
      : 'Disable reset notifications';
  } catch (error) {
    window.alert(`Could not update notifications: ${error.message}`);
  }
});
$('reload-page').addEventListener('click', () => window.claudeSwitcher.accounts.reloadView());
$('error-reload').addEventListener('click', () => window.claudeSwitcher.accounts.reloadView());
$('open-external').addEventListener('click', () => window.claudeSwitcher.openExternal('https://claude.ai/'));
$('sidebar-toggle').addEventListener('click', () => $('sidebar').classList.toggle('collapsed'));
$('project-history-button').addEventListener('click', async () => {
  await window.claudeSwitcher.accounts.hideView();
  $('webview-stage').classList.add('hidden');
  $('history-panel').classList.remove('hidden');
  await refreshHistory();
});
$('refresh-history').addEventListener('click', refreshHistory);
$('close-history').addEventListener('click', () => {
  $('history-panel').classList.add('hidden');
  $('webview-stage').classList.remove('hidden');
  restoreActiveView();
});
$('rename-account').addEventListener('click', async () => {
  if (managedAccount) await renameAccount(managedAccount);
  $('account-dialog').close();
});
$('clear-account-session').addEventListener('click', clearManagedSession);
$('remove-account').addEventListener('click', removeManagedAccount);
$('account-dialog').addEventListener('close', restoreActiveView);
window.addEventListener('resize', resizeWebviews);
new ResizeObserver(resizeWebviews).observe($('webview-stage'));
init().catch((error) => window.alert(`Could not start Claude Switcher: ${error.message}`));
setInterval(refreshUsage, 10000);
