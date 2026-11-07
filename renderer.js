const state = { accounts: [], activeId: null, views: new Map(), limited: new Set(), usage: new Map(), messageCounts: new Map() };
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
    const status = state.limited.has(account.id) ? 'Limit reached' : 'Ready to use';
    item.innerHTML = `<button class="account-select"><span class="avatar">${initials(account.name)}</span><span class="account-copy"><span class="account-name"></span><span class="account-status"></span></span><span class="limit-dot${state.limited.has(account.id) ? ' limited' : ''}"></span></button><button class="account-menu" title="Account settings" aria-label="Account settings">•••</button>`;
    item.querySelector('.account-name').textContent = account.name;
    item.querySelector('.account-status').textContent = status;
    item.querySelector('.account-select').addEventListener('click', () => switchAccount(account.id));
    item.querySelector('.account-menu').addEventListener('click', () => openAccountSettings(account));
    list.append(item);
  });
  const active = state.accounts.find((account) => account.id === state.activeId);
  $('active-name').textContent = active ? active.name : 'No account';
  $('empty-state').classList.toggle('hidden', state.accounts.length > 0);
  renderUsage();
}

function openAccountSettings(account) {
  managedAccount = account;
  $('account-dialog-title').textContent = account.name;
  $('account-dialog-subtitle').textContent = account.id === state.activeId ? 'Active Claude session' : 'Manage this Claude session';
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
  const count = state.messageCounts.get(state.activeId) || 0;
  const fill = Math.min(count * 5, 100);
  $('usage-meter-fill').style.width = `${fill}%`;
  const usage = state.usage.get(state.activeId);
  $('usage-summary').textContent = usage?.resetText || (state.activeId ? 'No limit notice detected' : 'Select an account to see usage');
  $('usage-detail').textContent = state.activeId
    ? `Local estimate: ${count} message${count === 1 ? '' : 's'} visible`
    : 'Usage appears here when Claude exposes it';
}

function switchAccount(id) {
  state.activeId = id;
  $('empty-state').classList.add('hidden');
  $('error-state').classList.add('hidden');
  renderAccounts();
  window.claudeSwitcher.accounts.showView(id)
    .then(resizeWebviews)
    .catch((error) => window.alert(`Could not open Claude: ${error.message}`));
}

async function addAccount() {
  try {
    const account = await window.claudeSwitcher.accounts.add('');
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
}

$('add-account').addEventListener('click', addAccount);
$('empty-add').addEventListener('click', addAccount);
$('reload-page').addEventListener('click', () => window.claudeSwitcher.accounts.reloadView());
$('error-reload').addEventListener('click', () => window.claudeSwitcher.accounts.reloadView());
$('open-external').addEventListener('click', () => window.claudeSwitcher.openExternal('https://claude.ai/'));
$('sidebar-toggle').addEventListener('click', () => $('sidebar').classList.toggle('collapsed'));
$('rename-account').addEventListener('click', async () => {
  if (managedAccount) await renameAccount(managedAccount);
  $('account-dialog').close();
});
$('clear-account-session').addEventListener('click', clearManagedSession);
$('remove-account').addEventListener('click', removeManagedAccount);
window.addEventListener('resize', resizeWebviews);
new ResizeObserver(resizeWebviews).observe($('webview-stage'));
init().catch((error) => window.alert(`Could not start Claude Switcher: ${error.message}`));
