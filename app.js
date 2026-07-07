// Version: Kontenplan-Favoriten
const STORAGE_KEY = 'football-finance-state';
const walletLabels = {
  cash: 'Kasse',
  bank: 'Bank'
};

const accountTypeLabels = {
  asset: 'Aktivkonto',
  income: 'Ertrag',
  expense: 'Aufwand',
  other: 'Sonstiges'
};

const bookingColumns = [
  { key: 'date', label: 'Datum' },
  { key: 'statementNumber', label: 'Auszug Nr.' },
  { key: 'text', label: 'Text' },
  { key: 'percent', label: '%' },
  { key: 'preTax', label: 'Vorst. enth.' },
  { key: 'vat', label: 'MWSt enth.' },
  { key: 'income', label: 'Einnahmen' },
  { key: 'expense', label: 'Ausgabe' },
  { key: 'booked', label: 'gebucht' },
  { key: 'konto', label: 'Konto' },
  { key: 'balance', label: 'Bestand' }
];

// Supabase-Client aus den Zugangsdaten in config.js erstellen.
const supabaseClient = window.supabase.createClient(
  window.SUPABASE_CONFIG.url,
  window.SUPABASE_CONFIG.anonKey
);

// In-Memory-Stand; wird nach dem Login aus Supabase geladen.
let state = { accounts: [], entries: [] };
let realtimeChannel = null;
let refreshTimer = null;
let loadedUserId = null;

const bookingForm = document.getElementById('bookingForm');
const bookingSubmitBtn = document.getElementById('bookingSubmit');
const accountForm = document.getElementById('accountForm');
const accountSelect = document.getElementById('accountSelect');
const accountFile = document.getElementById('accountFile');
const ledgerFile = document.getElementById('ledgerFile');
const statusEl = document.getElementById('accountPlanStatus');
const cashEntriesTableHead = document.getElementById('cashEntriesTableHead');
const cashEntriesTableBody = document.getElementById('cashEntriesTableBody');
const bankEntriesTableHead = document.getElementById('bankEntriesTableHead');
const bankEntriesTableBody = document.getElementById('bankEntriesTableBody');
const totalEntriesTableHead = document.getElementById('totalEntriesTableHead');
const totalEntriesTableBody = document.getElementById('totalEntriesTableBody');
const accountsTableBody = document.getElementById('accountsTableBody');
const cashBalanceEl = document.getElementById('cashBalance');
const bankBalanceEl = document.getElementById('bankBalance');
const totalBalanceEl = document.getElementById('totalBalance');
const entryCountEl = document.getElementById('entryCount');
const accountCountEl = document.getElementById('accountCount');
const tabButtons = document.querySelectorAll('.tab-button');
const views = document.querySelectorAll('.view');
const ledgerToggleButtons = document.querySelectorAll('.ledger-toggle-btn');
const ledgerViews = document.querySelectorAll('.ledger-view');
const cancelAccountEditBtn = document.getElementById('cancelAccountEdit');
const accountFormSubmitBtn = document.getElementById('accountFormSubmit');
const filterYear = document.getElementById('filterYear');
const filterMonth = document.getElementById('filterMonth');
const filterType = document.getElementById('filterType');
const filterVat = document.getElementById('filterVat');
const filterReset = document.getElementById('filterReset');
const authOverlay = document.getElementById('authOverlay');
const appShell = document.getElementById('appShell');
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginSubmit = document.getElementById('loginSubmit');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');
const currentUserEl = document.getElementById('currentUser');
const migrationBar = document.getElementById('migrationBar');
const migrationText = document.getElementById('migrationText');
const migrateBtn = document.getElementById('migrateBtn');
const dismissMigrateBtn = document.getElementById('dismissMigrateBtn');

const sortOrder = document.getElementById('sortOrder');

const filters = { year: '', month: '', type: '', vat: '' };
let sortMode = 'dateDesc';

window.addAccountFromForm = handleAccountSubmit;

init();
initAuth();

function init() {
  document.getElementById('date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('booked').value = new Date().toISOString().slice(0, 10);
  renderHeaders();

  loginForm.addEventListener('submit', handleLogin);
  logoutBtn.addEventListener('click', handleLogout);
  migrateBtn.addEventListener('click', migrateLocalData);
  dismissMigrateBtn.addEventListener('click', dismissMigration);

  bookingForm.addEventListener('submit', handleSubmit);
  ['amount', 'percent', 'movementType'].forEach((id) => {
    document.getElementById(id).addEventListener('input', recalcTax);
    document.getElementById(id).addEventListener('change', recalcTax);
  });
  document.querySelectorAll('.entries-table').forEach((table) => {
    table.addEventListener('click', handleBookingTableAction);
  });
  filterYear.addEventListener('change', handleFilterChange);
  filterMonth.addEventListener('change', handleFilterChange);
  filterType.addEventListener('change', handleFilterChange);
  filterVat.addEventListener('change', handleFilterChange);
  filterReset.addEventListener('click', resetFilters);
  sortOrder.addEventListener('change', handleSortChange);
  accountFormSubmitBtn.addEventListener('click', handleAccountSubmit);
  accountFile.addEventListener('change', handleUpload);
  ledgerFile.addEventListener('change', handleLedgerImport);
  cancelAccountEditBtn.addEventListener('click', resetAccountForm);
  accountsTableBody.addEventListener('click', handleAccountTableAction);
  document.querySelectorAll('.export-btn').forEach((button) => {
    button.addEventListener('click', () => exportEntries(button.dataset.exportWallet));
  });
  tabButtons.forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  });
  ledgerToggleButtons.forEach((button) => {
    button.addEventListener('click', () => activateLedgerView(button.dataset.ledgerView));
  });
  activateLedgerView('all');
}

// ---------------------------------------------------------------------------
// Authentifizierung (Login pro Person über Supabase Auth)
// ---------------------------------------------------------------------------

function initAuth() {
  supabaseClient.auth.onAuthStateChange((_event, session) => applyAuthState(session));
  supabaseClient.auth.getSession().then(({ data }) => applyAuthState(data.session));
}

function applyAuthState(session) {
  if (session && session.user) {
    authOverlay.hidden = true;
    appShell.hidden = false;
    currentUserEl.textContent = session.user.email || '';
    // Daten nur einmal pro angemeldetem Nutzer laden (getSession + onAuthStateChange
    // können beide feuern).
    if (loadedUserId !== session.user.id) {
      loadedUserId = session.user.id;
      loadAndRender();
    }
  } else {
    loadedUserId = null;
    appShell.hidden = true;
    authOverlay.hidden = false;
    teardownRealtime();
  }
}

async function handleLogin(event) {
  event.preventDefault();
  loginError.textContent = '';
  loginSubmit.disabled = true;
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: loginEmail.value.trim(),
    password: loginPassword.value
  });
  loginSubmit.disabled = false;
  if (error) {
    loginError.textContent = 'Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.';
    return;
  }
  loginPassword.value = '';
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
}

// ---------------------------------------------------------------------------
// Datenzugriff (Supabase als zentrale Quelle statt localStorage)
// ---------------------------------------------------------------------------

async function loadAndRender() {
  try {
    state = await loadStateFromCloud();
  } catch (error) {
    statusEl.textContent = 'Daten konnten nicht geladen werden. Bitte Seite neu laden.';
    return;
  }
  renderAccountSelect();
  renderSummary();
  renderEntries();
  renderAccounts();
  setupRealtime();
  maybeOfferMigration();
}

async function loadStateFromCloud() {
  const [accountsRes, entriesRes] = await Promise.all([
    supabaseClient.from('accounts').select('*').order('code'),
    supabaseClient.from('entries').select('*')
  ]);
  if (accountsRes.error) throw accountsRes.error;
  if (entriesRes.error) throw entriesRes.error;
  return {
    accounts: accountsRes.data.map(rowToAccount),
    entries: entriesRes.data.map(rowToEntry)
  };
}

// Feldnamen-Übersetzung zwischen DB (snake_case) und App (camelCase).
function rowToAccount(row) {
  return { id: row.id, code: row.code, label: row.label, type: row.type || 'other', favorite: row.favorite === true };
}

function rowToEntry(row) {
  const amount = Number(row.amount) || 0;
  const movementType = row.movement_type;
  return {
    id: row.id,
    date: row.date || '',
    amount,
    movementType,
    wallet: row.wallet,
    accountCode: row.account_code || '',
    accountLabel: row.account_label || '',
    description: row.description || '',
    statementNumber: row.statement_number || '',
    text: row.text || '',
    percent: row.percent == null ? '' : String(row.percent),
    preTax: Number(row.pre_tax) || 0,
    vat: Number(row.vat) || 0,
    booked: row.booked || '',
    income: movementType === 'income' ? amount : 0,
    expense: movementType === 'expense' ? amount : 0
  };
}

function entryToRow(entry) {
  return {
    date: entry.date || null,
    amount: entry.amount,
    movement_type: entry.movementType,
    wallet: entry.wallet,
    account_code: entry.accountCode || null,
    account_label: entry.accountLabel || null,
    description: entry.description || null,
    statement_number: entry.statementNumber || null,
    text: entry.text || null,
    percent: entry.percent === '' || entry.percent == null ? null : String(entry.percent),
    pre_tax: entry.preTax || 0,
    vat: entry.vat || 0,
    booked: entry.booked || null
  };
}

// Ersetzt den kompletten Kontenplan (für den Excel-Upload): alle löschen, neu einfügen.
async function replaceAccounts(accounts) {
  const { error: deleteError } = await supabaseClient
    .from('accounts')
    .delete()
    .not('id', 'is', null);
  if (deleteError) throw deleteError;

  const rows = accounts.map((account) => ({
    code: account.code,
    label: account.label,
    type: account.type || 'other'
  }));
  const { data, error } = await supabaseClient.from('accounts').insert(rows).select();
  if (error) throw error;
  return data.map(rowToAccount);
}

// ---------------------------------------------------------------------------
// Live-Sync: Änderungen anderer Personen erscheinen automatisch.
// ---------------------------------------------------------------------------

function setupRealtime() {
  teardownRealtime();
  realtimeChannel = supabaseClient
    .channel('finance-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, scheduleRefresh)
    .subscribe();
}

function teardownRealtime() {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      state = await loadStateFromCloud();
      renderAccountSelect();
      renderSummary();
      renderEntries();
      renderAccounts();
    } catch (error) {
      // Ein fehlgeschlagenes Live-Update ist unkritisch – beim nächsten Ereignis erneut.
    }
  }, 300);
}

// ---------------------------------------------------------------------------
// Einmalige Übernahme evtl. vorhandener lokaler Daten (aus der localStorage-Version).
// ---------------------------------------------------------------------------

function readLocalBackup() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch (error) {
    return null;
  }
}

function maybeOfferMigration() {
  const local = readLocalBackup();
  const localCount = local && Array.isArray(local.entries) ? local.entries.length : 0;
  if (localCount && state.entries.length === 0) {
    migrationText.textContent = `Auf diesem Gerät wurden ${localCount} lokale Buchungen gefunden, die noch nicht in der Cloud sind.`;
    migrationBar.hidden = false;
  } else {
    migrationBar.hidden = true;
  }
}

async function migrateLocalData() {
  const local = readLocalBackup();
  if (!local) {
    migrationBar.hidden = true;
    return;
  }
  migrateBtn.disabled = true;
  try {
    if (Array.isArray(local.accounts) && local.accounts.length && state.accounts.length === 0) {
      await replaceAccounts(local.accounts);
    }
    if (Array.isArray(local.entries) && local.entries.length) {
      const rows = local.entries.map(entryToRow);
      const { error } = await supabaseClient.from('entries').insert(rows);
      if (error) throw error;
    }
    state = await loadStateFromCloud();
    renderAccountSelect();
    renderSummary();
    renderEntries();
    renderAccounts();
    localStorage.removeItem(STORAGE_KEY);
    migrationBar.hidden = true;
    statusEl.textContent = 'Lokale Daten wurden in die Cloud übertragen.';
  } catch (error) {
    statusEl.textContent = 'Übertragung fehlgeschlagen. Bitte erneut versuchen.';
  } finally {
    migrateBtn.disabled = false;
  }
}

function dismissMigration() {
  migrationBar.hidden = true;
}

function activateTab(tabName) {
  tabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabName);
  });
  views.forEach((view) => {
    view.classList.toggle('active', view.id === `${tabName}View`);
  });
}

function activateLedgerView(viewName) {
  ledgerToggleButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.ledgerView === viewName);
  });
  ledgerViews.forEach((view) => {
    view.classList.toggle('active', view.dataset.ledgerView === viewName);
  });
}

function renderHeaders() {
  [cashEntriesTableHead, bankEntriesTableHead, totalEntriesTableHead].forEach((head) => {
    head.innerHTML = bookingColumns
      .map((column) => `<th>${escapeHtml(column.label)}</th>`)
      .join('');
  });
}

function renderAccountSelect() {
  const currentValue = accountSelect.value;
  // Favoriten zuerst, dann alphabetisch nach Kontoname; innerhalb der Favoriten ebenfalls alphabetisch.
  const sortedAccounts = [...state.accounts].sort((a, b) => {
    const favDiff = (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
    if (favDiff !== 0) return favDiff;
    return a.label.localeCompare(b.label, 'de', { sensitivity: 'base' });
  });
  accountSelect.innerHTML = sortedAccounts
    .map((account) => `<option value="${account.code}">${account.favorite ? '★ ' : ''}${escapeHtml(account.label)}</option>`)
    .join('');

  if (state.accounts.some((account) => account.code === currentValue)) {
    accountSelect.value = currentValue;
  } else if (sortedAccounts.length) {
    accountSelect.value = sortedAccounts[0].code;
  }
}

function renderSummary() {
  const cashBalance = calculateBalance('cash');
  const bankBalance = calculateBalance('bank');
  const totalBalance = cashBalance + bankBalance;

  cashBalanceEl.textContent = formatEuro(cashBalance);
  bankBalanceEl.textContent = formatEuro(bankBalance);
  totalBalanceEl.textContent = formatEuro(totalBalance);
  statusEl.textContent = `${state.accounts.length} Konten im Kontenplan geladen.`;
}

function renderEntries() {
  populateYearFilter();

  if (!state.entries.length) {
    [cashEntriesTableBody, bankEntriesTableBody, totalEntriesTableBody].forEach((body) => {
      body.innerHTML = `
        <tr>
          <td colspan="${bookingColumns.length}">Noch keine Buchungen vorhanden. Trage die erste Buchung ein, um die Übersicht zu starten.</td>
        </tr>
      `;
    });
    entryCountEl.textContent = '0 Einträge';
    return;
  }

  const sorted = [...state.entries].sort((a, b) => new Date(a.date) - new Date(b.date));
  const runningBalances = { cash: 0, bank: 0, all: 0 };
  const enrichedEntries = sorted.map((entry) => {
    const delta = entry.movementType === 'income' ? entry.amount : -entry.amount;
    runningBalances[entry.wallet] += delta;
    runningBalances.all += delta;
    return { ...entry, balance: runningBalances[entry.wallet], totalBalance: runningBalances.all };
  });

  const visibleEntries = enrichedEntries.filter(matchesFilters);
  // Der Bestand oben wird chronologisch berechnet; hier nur die Anzeige-Reihenfolge.
  const displayEntries = applySortOrder(visibleEntries);

  entryCountEl.textContent = `${displayEntries.length} Einträge`;
  renderBookingTable(cashEntriesTableBody, displayEntries.filter((entry) => entry.wallet === 'cash'), 'cash');
  renderBookingTable(bankEntriesTableBody, displayEntries.filter((entry) => entry.wallet === 'bank'), 'bank');
  renderBookingTable(totalEntriesTableBody, displayEntries, 'all');
}

function applySortOrder(entries) {
  const list = [...entries];
  switch (sortMode) {
    case 'dateAsc':
      return list.sort((a, b) => new Date(a.date) - new Date(b.date));
    case 'amountDesc':
      return list.sort((a, b) => b.amount - a.amount);
    case 'amountAsc':
      return list.sort((a, b) => a.amount - b.amount);
    case 'dateDesc':
    default:
      return list.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
}

function handleSortChange() {
  sortMode = sortOrder.value;
  renderEntries();
}

function matchesFilters(entry) {
  const date = entry.date || '';
  if (filters.year && date.slice(0, 4) !== filters.year) return false;
  if (filters.month && date.slice(5, 7) !== filters.month) return false;
  if (filters.type && entry.movementType !== filters.type) return false;
  if (filters.vat === 'yes' && !hasVorsteuer(entry)) return false;
  if (filters.vat === 'no' && hasVorsteuer(entry)) return false;
  return true;
}

function populateYearFilter() {
  const years = [...new Set(state.entries
    .map((entry) => (entry.date || '').slice(0, 4))
    .filter((year) => /^\d{4}$/.test(year)))]
    .sort((a, b) => b.localeCompare(a));

  const current = filters.year;
  filterYear.innerHTML = `<option value="">Alle Jahre</option>${years
    .map((year) => `<option value="${year}">${year}</option>`)
    .join('')}`;

  if (current && years.includes(current)) {
    filterYear.value = current;
  } else if (current && !years.includes(current)) {
    filters.year = '';
    filterYear.value = '';
  }
}

function handleFilterChange() {
  filters.year = filterYear.value;
  filters.month = filterMonth.value;
  filters.type = filterType.value;
  filters.vat = filterVat.value;
  renderEntries();
}

function resetFilters() {
  filters.year = '';
  filters.month = '';
  filters.type = '';
  filters.vat = '';
  filterYear.value = '';
  filterMonth.value = '';
  filterType.value = '';
  filterVat.value = '';
  renderEntries();
}

function renderBookingTable(body, entries, wallet) {
  body.innerHTML = entries
    .map((entry) => {
      const rows = bookingColumns
        .map((column) => {
          const value = getBookingCellValue(entry, column, wallet);
          const cellClass = column.key === 'income' ? 'entry-amount positive' : column.key === 'expense' ? 'entry-amount negative' : '';
          const cellContent = column.key === 'balance'
            ? `<div class="balance-cell"><span class="balance-value">${escapeHtml(value)}</span><span class="row-actions"><button class="table-action-btn" type="button" data-action="edit" data-id="${entry.id}">Bearbeiten</button><button class="table-action-btn danger" type="button" data-action="delete" data-id="${entry.id}">Löschen</button></span></div>`
            : escapeHtml(value);
          return `<td class="${cellClass}">${cellContent}</td>`;
        })
        .join('');

      return `<tr>${rows}</tr>`;
    })
    .join('');
}

function renderAccounts() {
  accountCountEl.textContent = `${state.accounts.length} Konten`;
  accountsTableBody.innerHTML = state.accounts
    .map((account) => `
      <tr>
        <td>${escapeHtml(account.code)}</td>
        <td>${escapeHtml(account.label)}</td>
        <td>${escapeHtml(accountTypeLabels[account.type] || account.type)}</td>
        <td>
          <button class="account-action-btn favorite ${account.favorite ? 'active' : ''}" type="button" data-action="favorite" data-id="${account.id}" title="Als Favorit markieren" aria-pressed="${account.favorite ? 'true' : 'false'}">${account.favorite ? '★' : '☆'}</button>
          <button class="account-action-btn" type="button" data-action="edit" data-id="${account.id}">Bearbeiten</button>
          <button class="account-action-btn danger" type="button" data-action="delete" data-id="${account.id}">Löschen</button>
        </td>
      </tr>
    `)
    .join('');
}

function calculateBalance(wallet) {
  return state.entries
    .filter((entry) => entry.wallet === wallet)
    .reduce((sum, entry) => sum + (entry.movementType === 'income' ? entry.amount : -entry.amount), 0);
}

function includedTax(entry) {
  const percent = Number(entry.percent);
  if (!percent) return 0;
  return entry.amount * (percent / (100 + percent));
}

function hasVorsteuer(entry) {
  return Number(entry.percent) > 0;
}

function recalcTax() {
  const amount = Number(document.getElementById('amount').value || 0);
  const percent = Number(document.getElementById('percent').value || 0);
  const movementType = document.getElementById('movementType').value;
  const included = percent ? amount * (percent / (100 + percent)) : 0;

  const preTaxField = document.getElementById('preTax');
  const vatField = document.getElementById('vat');

  if (!included) {
    preTaxField.value = '';
    vatField.value = '';
    return;
  }

  if (movementType === 'expense') {
    preTaxField.value = included.toFixed(2);
    vatField.value = '';
  } else {
    vatField.value = included.toFixed(2);
    preTaxField.value = '';
  }
}

function getBookingCellValue(entry, column, wallet) {
  switch (column.key) {
    case 'date':
      return entry.date || '—';
    case 'statementNumber':
      return entry.statementNumber || '—';
    case 'text':
      return entry.text || entry.description || '—';
    case 'percent':
      return entry.percent === '' || entry.percent === undefined || entry.percent === null ? 'Keine Steuer' : `${entry.percent}%`;
    case 'preTax': {
      const tax = entry.movementType === 'expense' ? includedTax(entry) : 0;
      return tax ? formatEuro(tax) : '—';
    }
    case 'vat': {
      const tax = entry.movementType === 'income' ? includedTax(entry) : 0;
      return tax ? formatEuro(tax) : '—';
    }
    case 'income':
      return entry.movementType === 'income' ? formatEuro(entry.amount) : '—';
    case 'expense':
      return entry.movementType === 'expense' ? formatEuro(entry.amount) : '—';
    case 'booked':
      return entry.booked || entry.date || '—';
    case 'konto':
      if (!entry.accountCode) return '—';
      return entry.accountLabel ? `${entry.accountCode} · ${entry.accountLabel}` : entry.accountCode;
    case 'balance':
      return wallet === 'all' && entry.totalBalance !== undefined ? formatEuro(entry.totalBalance) : entry.balance !== undefined ? formatEuro(entry.balance) : '—';
    default:
      return '—';
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  const entryId = document.getElementById('entryId').value;
  const amount = Number(document.getElementById('amount').value);
  const movementType = document.getElementById('movementType').value;
  const percent = document.getElementById('percent').value;
  const description = document.getElementById('description').value.trim();
  const included = percent ? amount * (Number(percent) / (100 + Number(percent))) : 0;

  if (!description || !amount) {
    return;
  }

  const entryData = {
    date: document.getElementById('date').value,
    amount,
    movementType,
    wallet: document.getElementById('wallet').value,
    accountCode: accountSelect.value,
    accountLabel: (state.accounts.find((account) => account.code === accountSelect.value) || {}).label || 'Unbekannt',
    description,
    statementNumber: document.getElementById('statementNumber').value.trim(),
    text: description,
    percent,
    preTax: movementType === 'expense' ? included : 0,
    vat: movementType === 'income' ? included : 0,
    booked: document.getElementById('booked').value || document.getElementById('date').value,
    income: movementType === 'income' ? amount : 0,
    expense: movementType === 'expense' ? amount : 0
  };

  try {
    if (entryId) {
      const { error } = await supabaseClient
        .from('entries')
        .update(entryToRow(entryData))
        .eq('id', entryId);
      if (error) throw error;
      state.entries = state.entries.map((entry) => entry.id === entryId ? { ...entryData, id: entryId } : entry);
    } else {
      const { data, error } = await supabaseClient
        .from('entries')
        .insert(entryToRow(entryData))
        .select()
        .single();
      if (error) throw error;
      state.entries.unshift(rowToEntry(data));
    }
  } catch (error) {
    statusEl.textContent = 'Buchung konnte nicht gespeichert werden.';
    showToast('Buchung konnte nicht gespeichert werden.', 'error');
    return;
  }

  renderSummary();
  renderEntries();
  resetBookingForm();
  showToast(entryId ? 'Buchung aktualisiert ✓' : 'Buchung gespeichert ✓');
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}

async function handleBookingTableAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const entry = state.entries.find((item) => item.id === button.dataset.id);
  if (!entry) return;

  if (button.dataset.action === 'delete') {
    const label = entry.text || entry.description || 'diese Buchung';
    if (!window.confirm(`Buchung „${label}" wirklich löschen?`)) return;

    try {
      const { error } = await supabaseClient.from('entries').delete().eq('id', button.dataset.id);
      if (error) throw error;
    } catch (error) {
      statusEl.textContent = 'Buchung konnte nicht gelöscht werden.';
      return;
    }

    state.entries = state.entries.filter((item) => item.id !== button.dataset.id);
    renderSummary();
    renderEntries();

    // Falls die gelöschte Buchung gerade bearbeitet wird, Formular zurücksetzen.
    if (document.getElementById('entryId').value === button.dataset.id) {
      resetBookingForm();
    }
    return;
  }

  populateBookingForm(entry);
  activateTab('newBooking');
}

function populateBookingForm(entry) {
  document.getElementById('entryId').value = entry.id;
  document.getElementById('date').value = entry.date || '';
  document.getElementById('amount').value = entry.amount || '';
  document.getElementById('movementType').value = entry.movementType || 'income';
  document.getElementById('wallet').value = entry.wallet || 'cash';
  document.getElementById('statementNumber').value = entry.statementNumber || '';
  document.getElementById('percent').value = entry.percent || '';
  document.getElementById('description').value = entry.text || entry.description || '';
  document.getElementById('booked').value = entry.booked || entry.date || '';
  recalcTax();

  renderAccountSelect();
  accountSelect.value = entry.accountCode || '';
  bookingSubmitBtn.textContent = 'Änderungen speichern';
}

function resetBookingForm() {
  bookingForm.reset();
  document.getElementById('entryId').value = '';
  document.getElementById('date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('movementType').value = 'income';
  document.getElementById('wallet').value = 'cash';
  document.getElementById('booked').value = new Date().toISOString().slice(0, 10);
  document.getElementById('percent').value = '';
  recalcTax();
  renderAccountSelect();
  bookingSubmitBtn.textContent = 'Buchung speichern';
}

function handleUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function () {
    try {
      const workbook = XLSX.read(reader.result, { type: 'array' });
      const accounts = extractAccounts(workbook);

      if (!accounts.length) {
        statusEl.textContent = 'Im Kontenplan wurden keine lesbaren Konten gefunden.';
        return;
      }

      state.accounts = await replaceAccounts(accounts);
      renderAccountSelect();
      renderSummary();
      renderAccounts();
      statusEl.textContent = `${state.accounts.length} Konten aus dem Upload geladen.`;
    } catch (error) {
      statusEl.textContent = 'Der Kontenplan konnte nicht gelesen oder gespeichert werden.';
    }
  };

  reader.readAsArrayBuffer(file);
}

// ---------------------------------------------------------------------------
// Import der bisherigen Buchführung (Excel/ODS) in den Tab "Buchführung".
// ---------------------------------------------------------------------------

function handleLedgerImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function () {
    try {
      const workbook = XLSX.read(reader.result, { type: 'array' });
      const parsed = importEntriesFromWorkbook(workbook);

      if (!parsed.entries.length) {
        window.alert('In der Datei wurden keine Buchungen gefunden. Wird die richtige Datei mit den Journalen "Bank/Sparkasse" und "Kasse" verwendet?');
        return;
      }

      const bankCount = parsed.entries.filter((entry) => entry.wallet === 'bank').length;
      const cashCount = parsed.entries.filter((entry) => entry.wallet === 'cash').length;

      let message = `${parsed.entries.length} Buchungen importieren (${bankCount} Bank, ${cashCount} Kasse)?\n\n`
        + 'Die Buchungen werden zu den vorhandenen hinzugefügt (nichts wird gelöscht). Bitte nur einmal ausführen.';
      if (parsed.carried.length) {
        message += `\n\nHinweis: ${parsed.carried.length} Buchung(en) ohne Datum wurden dem Datum der Zeile darüber zugeordnet.`;
      }
      if (!window.confirm(message)) return;

      statusEl.textContent = 'Import läuft …';
      const rows = parsed.entries.map(entryToRow);
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabaseClient.from('entries').insert(rows.slice(i, i + 200));
        if (error) throw error;
      }

      state = await loadStateFromCloud();
      renderAccountSelect();
      renderSummary();
      renderEntries();
      renderAccounts();
      window.alert(`${parsed.entries.length} Buchungen wurden importiert (${bankCount} Bank, ${cashCount} Kasse).`);
      statusEl.textContent = `${parsed.entries.length} Buchungen importiert.`;
    } catch (error) {
      window.alert('Der Import ist fehlgeschlagen: ' + (error?.message || 'unbekannter Fehler'));
    } finally {
      event.target.value = '';
    }
  };

  reader.readAsArrayBuffer(file);
}

// Wandelt die beiden Hauptjournale (Bank/Sparkasse + Kasse) in Buchungen um.
function importEntriesFromWorkbook(workbook) {
  const entries = [];
  const carried = [];

  workbook.SheetNames.forEach((sheetName) => {
    const wallet = detectLedgerWallet(sheetName);
    if (!wallet) return;

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });

    // Kopfzeile finden (enthält "Datum"); ein echtes Journal hat auch "Bestand".
    const headerIndex = rows.findIndex((row) => String(row[0]).trim().toLowerCase() === 'datum');
    if (headerIndex === -1) return;
    const header = rows[headerIndex].map((cell) => String(cell).trim().toLowerCase());
    if (!header.includes('bestand')) return; // Auswertungs-/Zusammenfassungsblätter überspringen

    let lastDate = '';
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      const text = String(row[2] == null ? '' : row[2]).trim();
      let date = parseGermanDate(row[0]);

      if (date) {
        lastDate = date;
      } else {
        // Datumslose Zeile nur übernehmen, wenn es eine echte Buchung ist
        // (kein leerer Text, keine "Summe/Übertrag/Text"-Seitenzeile).
        if (!isRealLedgerText(text) || !lastDate) continue;
        date = lastDate;
        carried.push({ text, date });
      }

      const income = parseGermanNumber(row[6]);
      const expense = parseGermanNumber(row[7]);
      const bestand = parseGermanNumber(row[9]);

      let movementType = null;
      let amount = 0;
      if (income > 0) {
        movementType = 'income';
        amount = income;
      } else if (expense > 0) {
        movementType = 'expense';
        amount = expense;
      } else if (bestand !== 0 && /übertrag|bestand/i.test(text)) {
        movementType = 'income'; // Anfangsbestand als Startbuchung
        amount = bestand;
      } else {
        continue;
      }

      const percentRaw = String(row[3] == null ? '' : row[3]).trim();
      const percent = percentRaw === '7' || percentRaw === '19' ? percentRaw : '';
      const kontoRaw = String(row[8] == null ? '' : row[8]).trim();
      const accountCode = kontoRaw && kontoRaw !== '0' ? kontoRaw : '';
      const account = accountCode ? state.accounts.find((item) => item.code === accountCode) : null;
      const included = percent ? amount * (Number(percent) / (100 + Number(percent))) : 0;

      entries.push({
        date,
        amount,
        movementType,
        wallet,
        accountCode,
        accountLabel: account ? account.label : '',
        description: text,
        statementNumber: String(row[1] == null ? '' : row[1]).trim(),
        text,
        percent,
        preTax: movementType === 'expense' ? included : 0,
        vat: movementType === 'income' ? included : 0,
        booked: date
      });
    }
  });

  return { entries, carried };
}

function detectLedgerWallet(sheetName) {
  const name = sheetName.toLowerCase();
  if (name.includes('sparkasse') || name.includes('bank')) return 'bank';
  if (name.includes('kasse')) return 'cash';
  return null;
}

function isRealLedgerText(text) {
  const value = String(text || '').trim();
  return value.length > 0 && !/^\s*(summe|übertrag|text)\b/i.test(value);
}

function parseGermanNumber(value) {
  const str = String(value == null ? '' : value).trim();
  if (!str) return 0;
  const normalized = str.replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function parseGermanDate(value) {
  const str = String(value == null ? '' : value).trim();
  let m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  // Tippfehler-Toleranz: fehlender mittlerer Punkt, z. B. "06.042025".
  m = str.match(/^(\d{1,2})\.(\d{2})(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1].padStart(2, '0')}`;
  return '';
}

async function handleAccountSubmit(event) {
  event?.preventDefault();
  const id = document.getElementById('accountId').value;
  const code = document.getElementById('accountCode').value.trim();
  const label = document.getElementById('accountLabel').value.trim();
  const type = document.getElementById('accountType').value;

  if (!code || !label) {
    return;
  }

  try {
    if (id) {
      const { error } = await supabaseClient.from('accounts').update({ code, label, type }).eq('id', id);
      if (error) throw error;
      state.accounts = state.accounts.map((account) => account.id === id ? { ...account, code, label, type } : account);
    } else {
      const { data, error } = await supabaseClient.from('accounts').insert({ code, label, type }).select().single();
      if (error) throw error;
      state.accounts.push(rowToAccount(data));
    }
  } catch (error) {
    statusEl.textContent = 'Konto konnte nicht gespeichert werden.';
    return;
  }

  renderAccountSelect();
  renderSummary();
  renderAccounts();
  resetAccountForm();
  statusEl.textContent = id ? 'Kontenplan aktualisiert.' : 'Neuer Kontenplan-Eintrag gespeichert.';
}

async function handleAccountTableAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const id = button.dataset.id;
  if (button.dataset.action === 'favorite') {
    const account = state.accounts.find((entry) => entry.id === id);
    if (!account) return;
    const newFavorite = !account.favorite;
    try {
      const { error } = await supabaseClient.from('accounts').update({ favorite: newFavorite }).eq('id', id);
      if (error) throw error;
    } catch (error) {
      statusEl.textContent = 'Favorit konnte nicht gespeichert werden. Ist die Spalte "favorite" in Supabase angelegt?';
      return;
    }
    account.favorite = newFavorite;
    renderAccountSelect();
    renderAccounts();
    statusEl.textContent = newFavorite ? 'Als Favorit markiert.' : 'Favorit entfernt.';
    return;
  }

  if (button.dataset.action === 'delete') {
    try {
      const { error } = await supabaseClient.from('accounts').delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      statusEl.textContent = 'Konto konnte nicht gelöscht werden.';
      return;
    }
    state.accounts = state.accounts.filter((account) => account.id !== id);
    renderAccountSelect();
    renderSummary();
    renderAccounts();
    statusEl.textContent = 'Kontenplan-Eintrag entfernt.';
    return;
  }

  const account = state.accounts.find((entry) => entry.id === id);
  if (!account) return;

  document.getElementById('accountId').value = account.id;
  document.getElementById('accountCode').value = account.code;
  document.getElementById('accountLabel').value = account.label;
  document.getElementById('accountType').value = account.type;
  activateTab('accounts');
}

function resetAccountForm() {
  accountForm.reset();
  document.getElementById('accountId').value = '';
  document.getElementById('accountType').value = 'asset';
}

function exportEntries(wallet) {
  const filteredEntries = wallet === 'all'
    ? [...state.entries].sort((a, b) => new Date(a.date) - new Date(b.date))
    : [...state.entries].filter((entry) => entry.wallet === wallet).sort((a, b) => new Date(a.date) - new Date(b.date));

  let runningBalance = 0;
  const rows = filteredEntries.map((entry) => {
    const delta = entry.movementType === 'income' ? entry.amount : -entry.amount;
    runningBalance += delta;
    return {
      Datum: entry.date || '—',
      'Auszug Nr.': entry.statementNumber || '—',
      Text: entry.text || entry.description || '—',
      '%': entry.percent === '' || entry.percent === undefined || entry.percent === null ? 'Keine Steuer' : `${entry.percent}%`,
      'Vorst. enth.': entry.movementType === 'expense' && includedTax(entry) ? formatEuro(includedTax(entry)) : '—',
      'MWSt enth.': entry.movementType === 'income' && includedTax(entry) ? formatEuro(includedTax(entry)) : '—',
      Einnahmen: entry.movementType === 'income' ? formatEuro(entry.amount) : '—',
      Ausgabe: entry.movementType === 'expense' ? formatEuro(entry.amount) : '—',
      gebucht: entry.booked || entry.date || '—',
      Konto: entry.accountCode ? (entry.accountLabel ? `${entry.accountCode} · ${entry.accountLabel}` : entry.accountCode) : '—',
      Bestand: formatEuro(runningBalance)
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, wallet === 'all' ? 'Gesamt' : wallet === 'cash' ? 'Kasse' : 'Bank');
  XLSX.writeFile(workbook, `${wallet === 'all' ? 'Gesamt' : wallet === 'cash' ? 'Kasse' : 'Bank'}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function extractAccounts(workbook) {
  const seen = new Set();
  const accounts = [];

  workbook.SheetNames.forEach((sheetName) => {
    // Zeilen als Arrays lesen: Spalte A = Index 0, Spalte B = Index 1, Rest ignorieren.
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: '',
      raw: false
    });

    rows.forEach((row) => {
      const codeCandidate = String(row[0] ?? '').trim().replace(/\s+/g, '');
      const labelCandidate = String(row[1] ?? '').trim().replace(/\s+/g, ' ');

      // Leere Zeilen und die Kopfzeile ("Kto." / "Name des Kontos") überspringen.
      if (!codeCandidate || !labelCandidate) return;
      if (!looksLikeAccountCode(codeCandidate) || !looksLikeLabel(labelCandidate)) {
        return;
      }

      const key = `${codeCandidate}-${labelCandidate.toLowerCase()}`;
      if (seen.has(key)) return;

      seen.add(key);
      accounts.push({
        id: crypto.randomUUID(),
        code: codeCandidate,
        label: labelCandidate,
        type: classifyAccount(codeCandidate, labelCandidate)
      });
    });
  });

  return accounts;
}

function looksLikeAccountCode(value) {
  return /^\d{1,6}$/.test(value);
}

function looksLikeLabel(value) {
  return value.length >= 2 && !value.startsWith('http');
}

function classifyAccount(code, label) {
  const text = `${code} ${label}`.toLowerCase();
  if (text.includes('kasse') || text.includes('bank')) return 'asset';
  if (text.includes('mitglied') || text.includes('sponsoring') || text.includes('einnahme')) return 'income';
  if (text.includes('gehalt') || text.includes('kosten') || text.includes('betrieb') || text.includes('transport') || text.includes('ausgabe')) return 'expense';
  return 'other';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEuro(value) {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}
