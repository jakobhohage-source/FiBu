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
  { key: 'receipt', label: 'Beleg' },
  { key: 'balance', label: 'Bestand' }
];

// Ablage der Belegdateien (privater Bucket, siehe supabase-setup.sql).
const RECEIPT_BUCKET = 'belege';
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

const ruleFieldLabels = { any: 'Verwendungszweck & Empfänger', text: 'Verwendungszweck', party: 'Empfänger/Auftraggeber' };
const ruleOpLabels = { contains: 'enthält', starts: 'beginnt mit', equals: 'ist genau', regex: 'Regex' };

// Supabase-Client aus den Zugangsdaten in config.js erstellen.
const supabaseClient = window.supabase.createClient(
  window.SUPABASE_CONFIG.url,
  window.SUPABASE_CONFIG.anonKey
);

// In-Memory-Stand; wird nach dem Login aus Supabase geladen.
let state = { accounts: [], entries: [], rules: [], reminders: [], invoices: [], settings: {} };
// Termin, dessen Buchung gerade im Formular vorbereitet wird (siehe calendar.js).
let pendingReminderId = '';
let realtimeChannel = null;
let refreshTimer = null;
let loadedUserId = null;
// Beleg, der nach erfolgreichem Speichern aus dem Storage gelöscht werden soll.
let receiptPathToDelete = '';
// Laufender Kontoauszug-Import (Rohzeilen, Spaltenzuordnung, Vorschlagsliste).
let importSession = null;

const bookingForm = document.getElementById('bookingForm');
const bookingSubmitBtn = document.getElementById('bookingSubmit');
const accountForm = document.getElementById('accountForm');
const accountSelect = document.getElementById('accountSelect');
const accountTaxRate = document.getElementById('accountTaxRate');
const applyTaxBtn = document.getElementById('applyTaxToEntries');
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
const reportYear = document.getElementById('reportYear');
const exportTaxReportBtn = document.getElementById('exportTaxReport');
const exportYearReportBtn = document.getElementById('exportYearReport');

const receiptFile = document.getElementById('receiptFile');
const receiptChosen = document.getElementById('receiptChosen');
const receiptPathInput = document.getElementById('receiptPath');
const receiptNameInput = document.getElementById('receiptName');
const receiptCurrent = document.getElementById('receiptCurrent');
const receiptCurrentName = document.getElementById('receiptCurrentName');
const receiptOpenBtn = document.getElementById('receiptOpenBtn');
const receiptRemoveBtn = document.getElementById('receiptRemoveBtn');

const statementFile = document.getElementById('statementFile');
const importModal = document.getElementById('importModal');
const importSummary = document.getElementById('importSummary');
const importMapping = document.getElementById('importMapping');
const importTableBody = document.getElementById('importTableBody');
const importWallet = document.getElementById('importWallet');
const importStatementNumber = document.getElementById('importStatementNumber');
const importConfirmBtn = document.getElementById('importConfirmBtn');
const mappingSelects = {
  date: document.getElementById('mapDate'),
  amount: document.getElementById('mapAmount'),
  text: document.getElementById('mapText'),
  party: document.getElementById('mapParty')
};

const ruleForm = document.getElementById('ruleForm');
const ruleAccount = document.getElementById('ruleAccount');
const rulesTableBody = document.getElementById('rulesTableBody');
const ruleCountEl = document.getElementById('ruleCount');
const rulesStatus = document.getElementById('rulesStatus');
const ruleTestInput = document.getElementById('ruleTestInput');
const ruleTestResult = document.getElementById('ruleTestResult');

const filters = { year: '', month: '', type: '', vat: '' };
let sortMode = 'dateDesc';

window.addAccountFromForm = handleAccountSubmit;

init();
initAuth();

function init() {
  document.getElementById('date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('booked').value = new Date().toISOString().slice(0, 10);
  renderHeaders();
  renderReceiptField();

  loginForm.addEventListener('submit', handleLogin);
  logoutBtn.addEventListener('click', handleLogout);
  migrateBtn.addEventListener('click', migrateLocalData);
  dismissMigrateBtn.addEventListener('click', dismissMigration);

  bookingForm.addEventListener('submit', handleSubmit);
  ['amount', 'percent', 'movementType'].forEach((id) => {
    document.getElementById(id).addEventListener('input', recalcTax);
    document.getElementById(id).addEventListener('change', recalcTax);
  });
  accountSelect.addEventListener('change', applyAccountTaxToForm);
  applyTaxBtn.addEventListener('click', applyTaxToExistingEntries);
  document.querySelectorAll('.entries-table').forEach((table) => {
    table.addEventListener('click', handleBookingTableAction);
  });
  filterYear.addEventListener('change', handleFilterChange);
  filterMonth.addEventListener('change', handleFilterChange);
  filterType.addEventListener('change', handleFilterChange);
  filterVat.addEventListener('change', handleFilterChange);
  filterReset.addEventListener('click', resetFilters);
  sortOrder.addEventListener('change', handleSortChange);
  exportTaxReportBtn.addEventListener('click', exportTaxReport);
  exportYearReportBtn.addEventListener('click', exportYearReport);
  accountFormSubmitBtn.addEventListener('click', handleAccountSubmit);
  accountFile.addEventListener('change', handleUpload);
  ledgerFile.addEventListener('change', handleLedgerImport);
  statementFile.addEventListener('change', handleStatementImport);

  receiptFile.addEventListener('change', handleReceiptChoice);
  receiptOpenBtn.addEventListener('click', () => openReceipt(receiptPathInput.value));
  receiptRemoveBtn.addEventListener('click', detachReceiptFromForm);

  document.getElementById('importCloseBtn').addEventListener('click', closeImportModal);
  document.getElementById('importCancelBtn').addEventListener('click', closeImportModal);
  importConfirmBtn.addEventListener('click', confirmStatementImport);
  document.getElementById('importSelectAll').addEventListener('click', () => setAllImportRows(true));
  document.getElementById('importSelectNone').addEventListener('click', () => setAllImportRows(false));
  importTableBody.addEventListener('change', handleImportRowChange);
  // Kasse statt Bank ändert die Kennung der Umsätze – Vorschläge neu berechnen.
  importWallet.addEventListener('change', refreshImportPreview);
  Object.values(mappingSelects).forEach((select) => {
    select.addEventListener('change', applyColumnMapping);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !importModal.hidden) closeImportModal();
  });

  ruleForm.addEventListener('submit', handleRuleSubmit);
  document.getElementById('ruleCancel').addEventListener('click', resetRuleForm);
  rulesTableBody.addEventListener('click', handleRuleTableAction);
  ruleTestInput.addEventListener('input', runRuleTest);
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

  initCalendar();
  initInvoices();
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
  renderRules();
  renderCalendar();
  renderInvoices();
  renderOrgForm();
  setupRealtime();
  maybeOfferMigration();
}

async function loadStateFromCloud() {
  const [accountsRes, entriesRes, rulesRes, remindersRes, invoicesRes, settingsRes] = await Promise.all([
    supabaseClient.from('accounts').select('*').order('code'),
    supabaseClient.from('entries').select('*'),
    supabaseClient.from('import_rules').select('*'),
    supabaseClient.from('reminders').select('*'),
    supabaseClient.from('invoices').select('*'),
    supabaseClient.from('app_settings').select('*')
  ]);
  if (accountsRes.error) throw accountsRes.error;
  if (entriesRes.error) throw entriesRes.error;

  // Fehlt eine der neueren Tabellen (supabase-setup.sql nicht eingespielt),
  // läuft der Rest der App weiter.
  const settings = {};
  if (!settingsRes.error) {
    settingsRes.data.forEach((row) => { settings[row.key] = row.value || {}; });
  }

  return {
    accounts: accountsRes.data.map(rowToAccount),
    entries: entriesRes.data.map(rowToEntry),
    rules: rulesRes.error ? [] : rulesRes.data.map(rowToRule),
    reminders: remindersRes.error ? [] : remindersRes.data.map(rowToReminder),
    invoices: invoicesRes.error ? [] : invoicesRes.data.map(rowToInvoice),
    settings
  };
}

// Feldnamen-Übersetzung zwischen DB (snake_case) und App (camelCase).
function rowToAccount(row) {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    type: row.type || 'other',
    favorite: row.favorite === true,
    taxRate: row.tax_rate == null ? '' : String(row.tax_rate)
  };
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
    receiptPath: row.receipt_path || '',
    receiptName: row.receipt_name || '',
    importHash: row.import_hash || '',
    income: movementType === 'income' ? amount : 0,
    expense: movementType === 'expense' ? amount : 0
  };
}

function rowToRule(row) {
  return {
    id: row.id,
    active: row.active !== false,
    priority: Number(row.priority) || 100,
    matchField: row.match_field || 'any',
    matchOp: row.match_op || 'contains',
    pattern: row.pattern || '',
    direction: row.direction || '',
    accountCode: row.account_code || '',
    percent: row.percent == null ? '' : String(row.percent),
    note: row.note || ''
  };
}

function ruleToRow(rule) {
  return {
    active: rule.active,
    priority: rule.priority,
    match_field: rule.matchField,
    match_op: rule.matchOp,
    pattern: rule.pattern,
    direction: rule.direction || null,
    account_code: rule.accountCode || null,
    percent: rule.percent === '' ? null : String(rule.percent),
    note: rule.note || null
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
    booked: entry.booked || null,
    receipt_path: entry.receiptPath || null,
    receipt_name: entry.receiptName || null,
    import_hash: entry.importHash || null
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'import_rules' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reminders' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, scheduleRefresh)
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
      renderRules();
      renderCalendar();
      renderInvoices();
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

  // Jahresauswahl für die Berichte (ohne "Alle"; Standard = neuestes Jahr).
  const reportYears = years.length ? years : [String(new Date().getFullYear())];
  const currentReport = reportYear.value;
  reportYear.innerHTML = reportYears.map((year) => `<option value="${year}">${year}</option>`).join('');
  reportYear.value = reportYears.includes(currentReport) ? currentReport : reportYears[0];
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
          let cellContent;
          if (column.key === 'balance') {
            cellContent = `<div class="balance-cell"><span class="balance-value">${escapeHtml(value)}</span><span class="row-actions"><button class="table-action-btn" type="button" data-action="edit" data-id="${entry.id}">Bearbeiten</button><button class="table-action-btn danger" type="button" data-action="delete" data-id="${entry.id}">Löschen</button></span></div>`;
          } else if (column.key === 'receipt') {
            cellContent = entry.receiptPath
              ? `<button class="table-action-btn receipt-link" type="button" data-action="receipt" data-id="${entry.id}" title="${escapeHtml(entry.receiptName || 'Beleg öffnen')}">📎 Beleg</button>`
              : '—';
          } else {
            cellContent = escapeHtml(value);
          }
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
        <td>${account.taxRate ? account.taxRate + '%' : '—'}</td>
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
    case 'receipt':
      return entry.receiptPath ? 'Beleg' : '—';
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

  // Beleg: neue Datei hochladen, sonst den bereits hinterlegten Pfad behalten.
  let receiptPath = receiptPathInput.value || '';
  let receiptName = receiptNameInput.value || '';
  const chosenReceipt = receiptFile.files && receiptFile.files[0];
  if (chosenReceipt) {
    if (chosenReceipt.size > MAX_RECEIPT_BYTES) {
      showToast('Der Beleg ist größer als 10 MB.', 'error');
      return;
    }
    bookingSubmitBtn.disabled = true;
    try {
      const uploadedPath = await uploadReceipt(chosenReceipt);
      if (receiptPath && receiptPath !== uploadedPath) receiptPathToDelete = receiptPath;
      receiptPath = uploadedPath;
      receiptName = chosenReceipt.name;
    } catch (error) {
      showToast('Beleg konnte nicht hochgeladen werden. Ist der Bucket "belege" angelegt?', 'error');
      return;
    } finally {
      bookingSubmitBtn.disabled = false;
    }
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
    receiptPath,
    receiptName,
    importHash: (state.entries.find((entry) => entry.id === entryId) || {}).importHash || '',
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
    statusEl.textContent = 'Buchung konnte nicht gespeichert werden. Wurde supabase-setup.sql bereits ausgeführt?';
    showToast('Buchung konnte nicht gespeichert werden.', 'error');
    return;
  }

  // Ersetzter oder entfernter Beleg wird erst nach erfolgreichem Speichern gelöscht.
  if (receiptPathToDelete) {
    await removeReceiptFile(receiptPathToDelete);
    receiptPathToDelete = '';
  }

  // Kam die Buchung aus einem Kalendertermin, rückt dieser jetzt auf den nächsten Turnus.
  const reminderToAdvance = !entryId && pendingReminderId
    ? state.reminders.find((reminder) => reminder.id === pendingReminderId)
    : null;

  renderSummary();
  renderEntries();
  resetBookingForm();
  showToast(entryId ? 'Buchung aktualisiert ✓' : 'Buchung gespeichert ✓');

  if (reminderToAdvance) {
    await completeReminder(reminderToAdvance, true);
    showToast(reminderToAdvance.active
      ? `Termin „${reminderToAdvance.title}" steht wieder am ${reminderToAdvance.nextDue} an.`
      : `Termin „${reminderToAdvance.title}" abgeschlossen ✓`);
  }
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

  if (button.dataset.action === 'receipt') {
    openReceipt(entry.receiptPath);
    return;
  }

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

    await removeReceiptFile(entry.receiptPath);
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
  receiptPathInput.value = entry.receiptPath || '';
  receiptNameInput.value = entry.receiptName || '';
  receiptFile.value = '';
  receiptPathToDelete = '';
  renderReceiptField();
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
  receiptPathInput.value = '';
  receiptNameInput.value = '';
  receiptFile.value = '';
  receiptPathToDelete = '';
  pendingReminderId = '';
  renderReceiptField();
  recalcTax();
  renderAccountSelect();
  bookingSubmitBtn.textContent = 'Buchung speichern';
}

// ---------------------------------------------------------------------------
// Belege: Foto oder PDF je Buchung im privaten Supabase-Bucket
// ---------------------------------------------------------------------------

function renderReceiptField() {
  const hasReceipt = Boolean(receiptPathInput.value);
  receiptCurrent.hidden = !hasReceipt;
  if (hasReceipt) {
    receiptCurrentName.textContent = receiptNameInput.value || 'Beleg hinterlegt';
  }
  const chosen = receiptFile.files && receiptFile.files[0];
  receiptChosen.textContent = chosen
    ? `Ausgewählt: ${chosen.name}`
    : hasReceipt ? 'Neue Datei wählen, um den Beleg zu ersetzen.' : '';
}

function handleReceiptChoice() {
  const chosen = receiptFile.files && receiptFile.files[0];
  if (chosen && chosen.size > MAX_RECEIPT_BYTES) {
    showToast('Der Beleg ist größer als 10 MB.', 'error');
    receiptFile.value = '';
  }
  renderReceiptField();
}

// Entfernt die Verknüpfung im Formular; gelöscht wird die Datei erst beim Speichern.
function detachReceiptFromForm() {
  if (receiptPathInput.value) receiptPathToDelete = receiptPathInput.value;
  receiptPathInput.value = '';
  receiptNameInput.value = '';
  receiptFile.value = '';
  renderReceiptField();
  showToast('Beleg wird beim Speichern entfernt.');
}

async function uploadReceipt(file) {
  const extension = (file.name.split('.').pop() || 'dat').toLowerCase().replace(/[^a-z0-9]/g, '') || 'dat';
  const today = new Date().toISOString().slice(0, 10);
  const random = Math.random().toString(36).slice(2, 10);
  const path = `${today.slice(0, 4)}/${today}-${random}.${extension}`;
  const { error } = await supabaseClient.storage
    .from(RECEIPT_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return path;
}

async function openReceipt(path) {
  if (!path) return;
  // Fenster vorab öffnen, damit der Popup-Blocker den Aufruf nach dem await nicht abfängt.
  const viewer = window.open('', '_blank', 'noopener');
  const { data, error } = await supabaseClient.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(path, 300);
  if (error || !data) {
    if (viewer) viewer.close();
    showToast('Beleg konnte nicht geöffnet werden.', 'error');
    return;
  }
  if (viewer) {
    viewer.location.href = data.signedUrl;
  } else {
    window.location.href = data.signedUrl;
  }
}

async function removeReceiptFile(path) {
  if (!path) return;
  try {
    await supabaseClient.storage.from(RECEIPT_BUCKET).remove([path]);
  } catch (error) {
    // Eine verwaiste Datei im Storage ist unkritisch – die Buchung ist entscheidend.
  }
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
      renderRules();
      renderCalendar();
      renderInvoices();
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

// ---------------------------------------------------------------------------
// Kontoauszug-Import: CSV der Bank oder CAMT.053-Datei einlesen, Umsätze
// anhand der Regeln vorbelegen und vor dem Buchen prüfen lassen.
// ---------------------------------------------------------------------------

// Suchbegriffe für die automatische Spaltenerkennung, beste Treffer zuerst.
const HEADER_HINTS = {
  date: ['buchungstag', 'buchungsdatum', 'wertstellung', 'valutadatum', 'valuta', 'datum'],
  amount: ['betrag', 'umsatz', 'wert'],
  text: ['verwendungszweck', 'buchungstext', 'vorgang', 'beschreibung', 'text'],
  party: ['beguenstigter', 'begünstigter', 'zahlungspflichtiger', 'auftraggeber', 'empfänger', 'empfaenger', 'zahlungsbeteiligter', 'kontrahent', 'name']
};

async function handleStatementImport(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  try {
    const text = decodeBytes(await file.arrayBuffer());
    importSession = /<\s*Document[\s>]|<\?xml/i.test(text.slice(0, 400))
      ? parseCamtStatement(text)
      : parseCsvStatement(text);

    if (!importSession.kind) throw new Error('Format nicht erkannt.');
    openImportModal();
  } catch (error) {
    window.alert('Der Kontoauszug konnte nicht gelesen werden: ' + (error?.message || 'unbekannter Fehler')
      + '\n\nUnterstützt werden CSV-Dateien der Bank und CAMT.053-Dateien (.xml).');
  } finally {
    event.target.value = '';
  }
}

// Deutsche Bankexporte kommen häufig als Windows-1252 statt UTF-8.
function decodeBytes(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  const asUtf8 = new TextDecoder('utf-8').decode(bytes);
  if (!asUtf8.includes('�')) return asUtf8;
  return new TextDecoder('windows-1252').decode(bytes);
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 6).join('\n');
  const best = [';', ',', '\t', '|']
    .map((candidate) => ({ candidate, count: sample.split(candidate).length - 1 }))
    .sort((a, b) => b.count - a.count)[0];
  return best && best.count > 0 ? best.candidate : ';';
}

function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char !== '"') {
        field += char;
      } else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = false;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseCsvStatement(text) {
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter).filter((row) => row.some((cell) => String(cell).trim() !== ''));
  if (rows.length < 2) throw new Error('Die Datei enthält keine auswertbaren Zeilen.');

  // Manche Banken stellen der Kopfzeile Zusatzangaben voran.
  let headerIndex = rows.findIndex((row) => {
    const cells = row.map(normalizeHeader);
    return cells.some((cell) => HEADER_HINTS.date.some((hint) => cell.includes(hint)))
      && cells.some((cell) => HEADER_HINTS.amount.some((hint) => cell.includes(hint)));
  });
  if (headerIndex === -1) headerIndex = 0;

  const headers = rows[headerIndex].map((cell) => String(cell).trim());
  const normalized = headers.map(normalizeHeader);

  return {
    kind: 'csv',
    headers,
    dataRows: rows.slice(headerIndex + 1),
    signColumn: normalized.findIndex((cell) => /soll\s*\/?\s*haben|^s\s*\/\s*h$|haben\s*\/\s*soll/.test(cell)),
    mapping: {
      date: guessColumn(normalized, HEADER_HINTS.date),
      amount: guessColumn(normalized, HEADER_HINTS.amount),
      text: guessColumn(normalized, HEADER_HINTS.text),
      party: guessColumn(normalized, HEADER_HINTS.party)
    },
    items: [],
    skipped: 0
  };
}

function normalizeHeader(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function guessColumn(normalizedHeaders, hints) {
  for (const hint of hints) {
    const index = normalizedHeaders.findIndex((header) => header.includes(hint));
    if (index !== -1) return index;
  }
  return -1;
}

// Sammelt alle Nachfahren mit diesem Tag-Namen, unabhängig vom XML-Namensraum
// (CAMT-Dateien kommen mal mit, mal ohne Präfix wie "ns2:Ntry").
function collectByLocalName(root, tagName) {
  const found = [];
  const visit = (node) => {
    const children = node && node.children ? node.children : [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const local = child.localName || String(child.tagName || '').split(':').pop();
      if (local === tagName) found.push(child);
      visit(child);
    }
  };
  visit(root);
  return found;
}

// CAMT.053: jeder <Ntry> ist ein Umsatz, <CdtDbtInd> entscheidet über die Richtung.
function parseCamtStatement(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Die XML-Datei ist beschädigt.');

  const allTexts = (node, tagName) => collectByLocalName(node, tagName).map((element) => element.textContent.trim());
  const localText = (node, tagName) => {
    const texts = allTexts(node, tagName);
    return texts.length ? texts[0] : '';
  };

  const statementNumber = localText(doc.documentElement, 'LglSeqNb') || localText(doc.documentElement, 'ElctrncSeqNb') || '';
  const entries = collectByLocalName(doc.documentElement, 'Ntry');
  if (!entries.length) throw new Error('In der CAMT-Datei wurden keine Umsätze gefunden.');

  const camtItems = entries.map((entry) => {
    const amount = Math.abs(Number(localText(entry, 'Amt')) || 0);
    const movementType = localText(entry, 'CdtDbtInd') === 'DBIT' ? 'expense' : 'income';
    const bookingDate = localText(entry, 'BookgDt') || localText(entry, 'ValDt');
    const purpose = allTexts(entry, 'Ustrd').join(' ').replace(/\s+/g, ' ').trim();
    const partyNames = allTexts(entry, 'Nm');
    return {
      date: (bookingDate || '').slice(0, 10),
      amount,
      movementType,
      text: purpose || localText(entry, 'AddtlNtryInf'),
      party: partyNames.length ? partyNames[0] : '',
      statementNumber
    };
  }).filter((item) => item.date && item.amount);

  return { kind: 'camt', camtItems, items: [], skipped: 0, headers: [], mapping: {}, signColumn: -1 };
}

function parseFlexibleDate(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';

  const german = parseGermanDate(raw);
  if (german) return german;

  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;

  // Zweistelliges Jahr, z. B. 04.03.25
  match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/);
  if (match) return `20${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;

  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;

  return '';
}

// Erkennt, ob Komma oder Punkt das Dezimaltrennzeichen ist (das zuletzt stehende).
function parseAmountFlexible(value) {
  let raw = String(value == null ? '' : value).trim();
  if (!raw) return 0;

  // Minus kann vor der Zahl stehen ("EUR -12,50"), dahinter ("12,50-") oder als Klammer.
  const firstDigit = raw.search(/\d/);
  const beforeDigits = firstDigit === -1 ? raw : raw.slice(0, firstDigit);
  const negative = beforeDigits.includes('-') || /-\s*$/.test(raw) || /^\(.*\)$/.test(raw);
  raw = raw.replace(/[^0-9.,]/g, '');
  if (!raw) return 0;

  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  let normalized;
  if (lastComma === -1 && lastDot === -1) {
    normalized = raw;
  } else if (lastComma > lastDot) {
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = raw.replace(/,/g, '');
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return 0;
  return negative ? -Math.abs(amount) : amount;
}

function deriveRawTransactions() {
  if (importSession.kind === 'camt') return importSession.camtItems;

  const { dataRows, mapping, signColumn } = importSession;
  if (mapping.date < 0 || mapping.amount < 0) return [];

  const cell = (row, index) => (index >= 0 ? String(row[index] == null ? '' : row[index]).replace(/\s+/g, ' ').trim() : '');

  return dataRows.reduce((list, row) => {
    const date = parseFlexibleDate(row[mapping.date]);
    const signed = parseAmountFlexible(row[mapping.amount]);
    if (!date || !signed) return list;

    let movementType = signed < 0 ? 'expense' : 'income';
    if (signColumn >= 0) {
      const flag = cell(row, signColumn).toUpperCase();
      if (flag.startsWith('S')) movementType = 'expense';
      else if (flag.startsWith('H')) movementType = 'income';
    }

    list.push({
      date,
      amount: Math.abs(signed),
      movementType,
      text: cell(row, mapping.text),
      party: cell(row, mapping.party),
      statementNumber: ''
    });
    return list;
  }, []);
}

// Stabile Kennung eines Umsatzes – verhindert, dass dieselbe Datei doppelt landet.
function importHashFor(transaction, wallet) {
  const key = [
    wallet,
    transaction.date,
    transaction.amount.toFixed(2),
    transaction.movementType,
    `${transaction.text} ${transaction.party}`.toLowerCase().replace(/\s+/g, ' ').trim()
  ].join('|');
  return `${transaction.date}-${fnv1a(key)}`;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// Gleicher Betrag und gleiche Richtung im Umkreis weniger Tage: vermutlich schon gebucht.
function findPossibleExisting(transaction, wallet) {
  const target = new Date(transaction.date).getTime();
  if (!Number.isFinite(target)) return null;
  return state.entries.find((entry) => entry.wallet === wallet
    && entry.movementType === transaction.movementType
    && Math.abs(entry.amount - transaction.amount) < 0.005
    && Math.abs(new Date(entry.date).getTime() - target) <= 3 * 86400000) || null;
}

function matchesRulePattern(rule, transaction) {
  const haystack = rule.matchField === 'text'
    ? transaction.text || ''
    : rule.matchField === 'party'
      ? transaction.party || ''
      : `${transaction.text || ''} ${transaction.party || ''}`;

  const pattern = String(rule.pattern || '').trim();
  if (!pattern) return false;

  if (rule.matchOp === 'regex') {
    try {
      return new RegExp(pattern, 'i').test(haystack);
    } catch (error) {
      return false;
    }
  }

  const lowerHaystack = haystack.toLowerCase().replace(/\s+/g, ' ').trim();
  const lowerPattern = pattern.toLowerCase().replace(/\s+/g, ' ').trim();
  if (rule.matchOp === 'starts') return lowerHaystack.startsWith(lowerPattern);
  if (rule.matchOp === 'equals') return lowerHaystack === lowerPattern;
  return lowerHaystack.includes(lowerPattern);
}

function findMatchingRule(transaction) {
  return [...state.rules]
    .filter((rule) => rule.active)
    .filter((rule) => !rule.direction || !transaction.movementType || rule.direction === transaction.movementType)
    .sort((a, b) => a.priority - b.priority || a.pattern.localeCompare(b.pattern, 'de'))
    .find((rule) => matchesRulePattern(rule, transaction)) || null;
}

function prepareImportItems() {
  const wallet = importWallet.value;
  const transactions = deriveRawTransactions();

  // Wie oft ein Umsatz bereits gebucht ist – so bleiben echte Doppelzahlungen erhalten.
  const alreadyImported = new Map();
  state.entries.forEach((entry) => {
    if (!entry.importHash) return;
    alreadyImported.set(entry.importHash, (alreadyImported.get(entry.importHash) || 0) + 1);
  });

  const seen = new Map();
  const items = [];
  let skipped = 0;

  transactions.forEach((transaction) => {
    const hash = importHashFor(transaction, wallet);
    const used = seen.get(hash) || 0;
    seen.set(hash, used + 1);
    if (used < (alreadyImported.get(hash) || 0)) {
      skipped++;
      return;
    }

    const rule = findMatchingRule(transaction);
    const account = rule && rule.accountCode
      ? state.accounts.find((item) => item.code === rule.accountCode)
      : null;
    let percent = '';
    if (rule && rule.percent !== '') percent = rule.percent === '0' ? '' : rule.percent;
    else if (account && account.taxRate) percent = account.taxRate;

    const existing = findPossibleExisting(transaction, wallet);
    items.push({
      ...transaction,
      hash,
      wallet,
      accountCode: rule && rule.accountCode ? rule.accountCode : '',
      percent,
      ruleId: rule ? rule.id : '',
      possibleDuplicate: Boolean(existing),
      existingLabel: existing ? `${existing.date} · ${existing.text || existing.description || 'Buchung'}` : '',
      include: !existing,
      makeRule: false
    });
  });

  importSession.items = items;
  importSession.skipped = skipped;
}

function openImportModal() {
  renderColumnMapping();
  prepareImportItems();
  renderImportTable();
  importStatementNumber.value = (importSession.items[0] && importSession.items[0].statementNumber) || '';
  importModal.hidden = false;
}

function closeImportModal() {
  importModal.hidden = true;
  importSession = null;
}

function renderColumnMapping() {
  const isCsv = importSession.kind === 'csv';
  importMapping.hidden = !isCsv;
  if (!isCsv) return;

  const options = importSession.headers
    .map((header, index) => `<option value="${index}">${escapeHtml(header || `Spalte ${index + 1}`)}</option>`)
    .join('');

  Object.entries(mappingSelects).forEach(([field, select]) => {
    select.innerHTML = `<option value="-1">— nicht vorhanden —</option>${options}`;
    select.value = String(importSession.mapping[field]);
  });
}

function refreshImportPreview() {
  if (!importSession) return;
  prepareImportItems();
  renderImportTable();
}

function applyColumnMapping() {
  if (!importSession || importSession.kind !== 'csv') return;
  Object.entries(mappingSelects).forEach(([field, select]) => {
    importSession.mapping[field] = Number(select.value);
  });
  refreshImportPreview();
}

function importAccountOptions(selectedCode) {
  const sorted = [...state.accounts].sort((a, b) => {
    const favDiff = (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
    if (favDiff !== 0) return favDiff;
    return a.label.localeCompare(b.label, 'de', { sensitivity: 'base' });
  });
  const options = sorted.map((account) => {
    const selected = account.code === selectedCode ? ' selected' : '';
    return `<option value="${escapeHtml(account.code)}"${selected}>${account.favorite ? '★ ' : ''}${escapeHtml(account.label)}</option>`;
  });
  return `<option value=""${selectedCode ? '' : ' selected'}>— kein Konto —</option>${options.join('')}`;
}

function percentOptions(selected) {
  return ['', '7', '19']
    .map((value) => `<option value="${value}"${String(selected) === value ? ' selected' : ''}>${value ? `${value}%` : 'Keine'}</option>`)
    .join('');
}

function renderImportTable() {
  const { items, skipped } = importSession;

  const parts = [`${items.length} Umsatz/Umsätze zum Buchen`];
  if (skipped) parts.push(`${skipped} bereits importiert und übersprungen`);
  const flagged = items.filter((item) => item.possibleDuplicate).length;
  if (flagged) parts.push(`${flagged} evtl. schon gebucht (gelb markiert, nicht vorausgewählt)`);
  const unmatched = items.filter((item) => !item.accountCode).length;
  if (unmatched) parts.push(`${unmatched} ohne Kontovorschlag`);
  importSummary.textContent = parts.join(' · ');

  if (!items.length) {
    importTableBody.innerHTML = `<tr><td colspan="7">Keine neuen Umsätze gefunden.${
      importSession.kind === 'csv' ? ' Stimmt die Spaltenzuordnung oben?' : ''
    }</td></tr>`;
    return;
  }

  importTableBody.innerHTML = items.map((item, index) => {
    const amountClass = item.movementType === 'income' ? 'positive' : 'negative';
    const sign = item.movementType === 'income' ? '+' : '−';
    const ruleHint = item.ruleId
      ? '<span class="import-party">Regel hat zugeordnet</span>'
      : '';
    const duplicateHint = item.possibleDuplicate
      ? `<span class="import-flag">evtl. schon gebucht: ${escapeHtml(item.existingLabel)}</span>`
      : '';
    return `
      <tr class="import-row${item.possibleDuplicate ? ' warn' : ''}" data-index="${index}">
        <td><input type="checkbox" data-field="include"${item.include ? ' checked' : ''} /></td>
        <td>${escapeHtml(item.date)}</td>
        <td class="import-text">
          ${escapeHtml(item.text || '—')}
          ${item.party ? `<span class="import-party">${escapeHtml(item.party)}</span>` : ''}
          ${ruleHint}
          ${duplicateHint}
        </td>
        <td class="entry-amount ${amountClass}">${sign} ${formatEuro(item.amount)}</td>
        <td><select data-field="accountCode">${importAccountOptions(item.accountCode)}</select></td>
        <td><select data-field="percent">${percentOptions(item.percent)}</select></td>
        <td><input type="checkbox" data-field="makeRule"${item.makeRule ? ' checked' : ''} title="Zuordnung als Regel für künftige Importe merken" /></td>
      </tr>
    `;
  }).join('');
}

function handleImportRowChange(event) {
  const row = event.target.closest('tr[data-index]');
  const field = event.target.dataset.field;
  if (!row || !field || !importSession) return;

  const item = importSession.items[Number(row.dataset.index)];
  if (!item) return;

  if (field === 'include' || field === 'makeRule') {
    item[field] = event.target.checked;
    return;
  }

  item[field] = event.target.value;

  if (field === 'accountCode') {
    // Steuersatz des gewählten Kontos übernehmen und die Zuordnung als Regel anbieten.
    const account = state.accounts.find((entry) => entry.code === item.accountCode);
    item.percent = account && account.taxRate ? account.taxRate : '';
    const percentSelect = row.querySelector('select[data-field="percent"]');
    if (percentSelect) percentSelect.value = item.percent;

    if (item.accountCode && !item.ruleId) {
      item.makeRule = true;
      const ruleCheckbox = row.querySelector('input[data-field="makeRule"]');
      if (ruleCheckbox) ruleCheckbox.checked = true;
    }
  }
}

function setAllImportRows(selected) {
  if (!importSession) return;
  importSession.items.forEach((item) => { item.include = selected; });
  importTableBody.querySelectorAll('input[data-field="include"]').forEach((checkbox) => {
    checkbox.checked = selected;
  });
}

function suggestRulePattern(item) {
  const party = (item.party || '').trim();
  if (party.length >= 3) return { field: 'party', pattern: party.slice(0, 60) };
  const text = (item.text || '').trim();
  return { field: 'text', pattern: text.slice(0, 40) };
}

async function confirmStatementImport() {
  if (!importSession) return;

  const selected = importSession.items.filter((item) => item.include);
  if (!selected.length) {
    window.alert('Es ist kein Umsatz ausgewählt.');
    return;
  }

  const withoutAccount = selected.filter((item) => !item.accountCode).length;
  if (withoutAccount) {
    const proceed = window.confirm(`${withoutAccount} von ${selected.length} Umsätzen haben kein Konto.`
      + '\n\nSie werden ohne Konto gebucht und können später ergänzt werden. Fortfahren?');
    if (!proceed) return;
  }

  const wallet = importWallet.value;
  const statementNumber = importStatementNumber.value.trim();

  const rows = selected.map((item) => {
    const account = state.accounts.find((entry) => entry.code === item.accountCode);
    const percent = item.percent || '';
    const included = percent ? item.amount * (Number(percent) / (100 + Number(percent))) : 0;
    const description = [item.text, item.party].filter(Boolean).join(' · ') || 'Kontoauszug';
    return entryToRow({
      date: item.date,
      amount: item.amount,
      movementType: item.movementType,
      wallet,
      accountCode: item.accountCode,
      accountLabel: account ? account.label : '',
      description,
      statementNumber: statementNumber || item.statementNumber || '',
      text: description,
      percent,
      preTax: item.movementType === 'expense' ? included : 0,
      vat: item.movementType === 'income' ? included : 0,
      booked: item.date,
      receiptPath: '',
      receiptName: '',
      importHash: item.hash
    });
  });

  importConfirmBtn.disabled = true;
  try {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabaseClient.from('entries').insert(rows.slice(i, i + 200));
      if (error) throw error;
    }

    const createdRules = await createRulesFromImport(selected);

    state = await loadStateFromCloud();
    renderAccountSelect();
    renderSummary();
    renderEntries();
    renderAccounts();
    renderRules();

    closeImportModal();
    const ruleNote = createdRules ? ` ${createdRules} neue Regel(n) gespeichert.` : '';
    showToast(`${rows.length} Umsätze gebucht ✓`);
    statusEl.textContent = `${rows.length} Umsätze aus dem Kontoauszug gebucht.${ruleNote}`;
  } catch (error) {
    window.alert('Der Import ist fehlgeschlagen: ' + (error?.message || 'unbekannter Fehler')
      + '\n\nWurde supabase-setup.sql bereits ausgeführt? Die Spalte "import_hash" wird benötigt.');
  } finally {
    importConfirmBtn.disabled = false;
  }
}

// Aus den angehakten Zeilen Regeln anlegen, damit der nächste Import zuordnet.
async function createRulesFromImport(selected) {
  const candidates = selected.filter((item) => item.makeRule && item.accountCode);
  if (!candidates.length) return 0;

  const newRules = [];
  const seen = new Set();
  candidates.forEach((item) => {
    const { field, pattern } = suggestRulePattern(item);
    if (!pattern) return;
    const key = `${field}|${pattern.toLowerCase()}|${item.accountCode}`;
    if (seen.has(key)) return;
    seen.add(key);

    const alreadyKnown = state.rules.some((rule) => rule.matchField === field
      && rule.pattern.toLowerCase() === pattern.toLowerCase()
      && rule.accountCode === item.accountCode);
    if (alreadyKnown) return;

    newRules.push(ruleToRow({
      active: true,
      priority: 50,
      matchField: field,
      matchOp: 'contains',
      pattern,
      direction: item.movementType,
      accountCode: item.accountCode,
      percent: item.percent || '',
      note: 'beim Kontoauszug-Import angelegt'
    }));
  });

  if (!newRules.length) return 0;
  const { error } = await supabaseClient.from('import_rules').insert(newRules);
  if (error) return 0;
  return newRules.length;
}

// ---------------------------------------------------------------------------
// Einstellungen: Zuordnungsregeln pflegen
// ---------------------------------------------------------------------------

function renderRules() {
  renderRuleAccountSelect();
  ruleCountEl.textContent = `${state.rules.length} ${state.rules.length === 1 ? 'Regel' : 'Regeln'}`;

  if (!state.rules.length) {
    rulesTableBody.innerHTML = '<tr><td colspan="7">Noch keine Regeln. Lege hier welche an oder hake beim Kontoauszug-Import „Regel merken" an.</td></tr>';
    runRuleTest();
    return;
  }

  const sorted = [...state.rules].sort((a, b) => a.priority - b.priority || a.pattern.localeCompare(b.pattern, 'de'));
  rulesTableBody.innerHTML = sorted.map((rule) => {
    const account = state.accounts.find((entry) => entry.code === rule.accountCode);
    const accountLabel = rule.accountCode
      ? `${escapeHtml(rule.accountCode)}${account ? ` · ${escapeHtml(account.label)}` : ''}`
      : '—';
    const direction = rule.direction === 'income' ? 'Einnahme' : rule.direction === 'expense' ? 'Ausgabe' : 'beide';
    return `
      <tr class="${rule.active ? '' : 'rule-inactive'}">
        <td>${rule.priority}</td>
        <td class="rule-condition">${escapeHtml(ruleFieldLabels[rule.matchField] || rule.matchField)} ${escapeHtml(ruleOpLabels[rule.matchOp] || rule.matchOp)} <code>${escapeHtml(rule.pattern)}</code></td>
        <td>${direction}</td>
        <td>${accountLabel}</td>
        <td>${rule.percent === '' ? 'vom Konto' : rule.percent === '0' ? 'keine' : `${escapeHtml(rule.percent)}%`}</td>
        <td>${escapeHtml(rule.note || '—')}</td>
        <td>
          <button class="account-action-btn" type="button" data-action="toggle" data-id="${rule.id}">${rule.active ? 'Aktiv' : 'Inaktiv'}</button>
          <button class="account-action-btn" type="button" data-action="edit" data-id="${rule.id}">Bearbeiten</button>
          <button class="account-action-btn danger" type="button" data-action="delete" data-id="${rule.id}">Löschen</button>
        </td>
      </tr>
    `;
  }).join('');

  runRuleTest();
}

function renderRuleAccountSelect() {
  const current = ruleAccount.value;
  ruleAccount.innerHTML = importAccountOptions(current);
  ruleAccount.value = state.accounts.some((account) => account.code === current) ? current : '';
}

async function handleRuleSubmit(event) {
  event.preventDefault();

  const pattern = document.getElementById('rulePattern').value.trim();
  if (!pattern) return;

  if (document.getElementById('ruleMatchOp').value === 'regex') {
    try {
      new RegExp(pattern, 'i');
    } catch (error) {
      rulesStatus.textContent = 'Der reguläre Ausdruck ist ungültig.';
      return;
    }
  }

  const id = document.getElementById('ruleId').value;
  const rule = {
    active: true,
    priority: Number(document.getElementById('rulePriority').value) || 100,
    matchField: document.getElementById('ruleMatchField').value,
    matchOp: document.getElementById('ruleMatchOp').value,
    pattern,
    direction: document.getElementById('ruleDirection').value,
    accountCode: ruleAccount.value,
    percent: document.getElementById('rulePercent').value,
    note: document.getElementById('ruleNote').value.trim()
  };

  try {
    if (id) {
      const existing = state.rules.find((entry) => entry.id === id);
      const payload = ruleToRow({ ...rule, active: existing ? existing.active : true });
      const { error } = await supabaseClient.from('import_rules').update(payload).eq('id', id);
      if (error) throw error;
      state.rules = state.rules.map((entry) => entry.id === id ? { ...rule, id, active: entry.active } : entry);
    } else {
      const { data, error } = await supabaseClient.from('import_rules').insert(ruleToRow(rule)).select().single();
      if (error) throw error;
      state.rules.push(rowToRule(data));
    }
  } catch (error) {
    rulesStatus.textContent = 'Regel konnte nicht gespeichert werden. Wurde supabase-setup.sql ausgeführt?';
    return;
  }

  resetRuleForm();
  renderRules();
  rulesStatus.textContent = id ? 'Regel aktualisiert.' : 'Regel gespeichert.';
  showToast(id ? 'Regel aktualisiert ✓' : 'Regel gespeichert ✓');
}

async function handleRuleTableAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const id = button.dataset.id;
  const rule = state.rules.find((entry) => entry.id === id);
  if (!rule) return;

  if (button.dataset.action === 'toggle') {
    try {
      const { error } = await supabaseClient.from('import_rules').update({ active: !rule.active }).eq('id', id);
      if (error) throw error;
    } catch (error) {
      rulesStatus.textContent = 'Status konnte nicht geändert werden.';
      return;
    }
    rule.active = !rule.active;
    renderRules();
    return;
  }

  if (button.dataset.action === 'delete') {
    if (!window.confirm(`Regel „${rule.pattern}" wirklich löschen?`)) return;
    try {
      const { error } = await supabaseClient.from('import_rules').delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      rulesStatus.textContent = 'Regel konnte nicht gelöscht werden.';
      return;
    }
    state.rules = state.rules.filter((entry) => entry.id !== id);
    if (document.getElementById('ruleId').value === id) resetRuleForm();
    renderRules();
    rulesStatus.textContent = 'Regel gelöscht.';
    return;
  }

  document.getElementById('ruleId').value = rule.id;
  document.getElementById('ruleMatchField').value = rule.matchField;
  document.getElementById('ruleMatchOp').value = rule.matchOp;
  document.getElementById('rulePattern').value = rule.pattern;
  document.getElementById('ruleDirection').value = rule.direction || '';
  document.getElementById('rulePriority').value = rule.priority;
  document.getElementById('rulePercent').value = rule.percent;
  document.getElementById('ruleNote').value = rule.note || '';
  renderRuleAccountSelect();
  ruleAccount.value = rule.accountCode || '';
  document.getElementById('ruleSubmit').textContent = 'Änderungen speichern';
  activateTab('settings');
}

function resetRuleForm() {
  ruleForm.reset();
  document.getElementById('ruleId').value = '';
  document.getElementById('ruleMatchField').value = 'any';
  document.getElementById('ruleMatchOp').value = 'contains';
  document.getElementById('ruleDirection').value = '';
  document.getElementById('rulePriority').value = '100';
  document.getElementById('rulePercent').value = '';
  renderRuleAccountSelect();
  document.getElementById('ruleSubmit').textContent = 'Regel speichern';
}

function runRuleTest() {
  const value = ruleTestInput.value.trim();
  if (!value) {
    ruleTestResult.textContent = '';
    return;
  }

  const rule = findMatchingRule({ text: value, party: value, movementType: '' });
  if (!rule) {
    ruleTestResult.textContent = 'Keine Regel greift bei diesem Text.';
    return;
  }

  const account = state.accounts.find((entry) => entry.code === rule.accountCode);
  const accountLabel = rule.accountCode
    ? `${rule.accountCode}${account ? ` · ${account.label}` : ''}`
    : 'kein Konto hinterlegt';
  ruleTestResult.textContent = `Treffer: „${rule.pattern}" (Priorität ${rule.priority}) → ${accountLabel}`;
}

async function handleAccountSubmit(event) {
  event?.preventDefault();
  const id = document.getElementById('accountId').value;
  const code = document.getElementById('accountCode').value.trim();
  const label = document.getElementById('accountLabel').value.trim();
  const type = document.getElementById('accountType').value;
  const taxRate = accountTaxRate.value;
  const tax_rate = taxRate === '' ? null : taxRate;

  if (!code || !label) {
    return;
  }

  try {
    if (id) {
      const { error } = await supabaseClient.from('accounts').update({ code, label, type, tax_rate }).eq('id', id);
      if (error) throw error;
      state.accounts = state.accounts.map((account) => account.id === id ? { ...account, code, label, type, taxRate } : account);
    } else {
      const { data, error } = await supabaseClient.from('accounts').insert({ code, label, type, tax_rate }).select().single();
      if (error) throw error;
      state.accounts.push(rowToAccount(data));
    }
  } catch (error) {
    const msg = 'Konto konnte nicht gespeichert werden. Ist die Spalte "tax_rate" in Supabase angelegt?\n\nSQL: alter table accounts add column if not exists tax_rate text;\n\nDetails: ' + (error?.message || 'unbekannt');
    statusEl.textContent = 'Konto konnte nicht gespeichert werden (Spalte "tax_rate" fehlt?).';
    window.alert(msg);
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
  accountTaxRate.value = account.taxRate || '';
  activateTab('accounts');
}

function resetAccountForm() {
  accountForm.reset();
  document.getElementById('accountId').value = '';
  document.getElementById('accountType').value = 'asset';
  accountTaxRate.value = '';
}

// Bei Kontowahl im Buchungsformular den hinterlegten Steuersatz automatisch übernehmen.
function applyAccountTaxToForm() {
  const account = state.accounts.find((item) => item.code === accountSelect.value);
  document.getElementById('percent').value = account && account.taxRate ? account.taxRate : '';
  recalcTax();
}

// Einmalige Korrektur: bei Buchungen ohne Steuersatz den Satz des Kontos setzen.
async function applyTaxToExistingEntries() {
  const taxByCode = new Map(state.accounts.filter((a) => a.taxRate).map((a) => [a.code, a.taxRate]));
  const toFix = state.entries.filter((entry) => {
    const hasPercent = entry.percent !== '' && entry.percent != null;
    return !hasPercent && entry.accountCode && taxByCode.has(entry.accountCode);
  });

  if (!toFix.length) {
    window.alert('Keine passenden Buchungen gefunden.\n\nHinterlege zuerst im Kontenplan bei den betroffenen Konten (z. B. 37 Eintritt = 7 %, 78 Bandenwerbung = 19 %) den Steuersatz.');
    return;
  }
  if (!window.confirm(`${toFix.length} Buchung(en) ohne Steuersatz erhalten den Satz ihres Kontos. Fortfahren?`)) return;

  applyTaxBtn.disabled = true;
  let done = 0;
  try {
    for (const entry of toFix) {
      const percent = taxByCode.get(entry.accountCode);
      const included = entry.amount * (Number(percent) / (100 + Number(percent)));
      const preTax = entry.movementType === 'expense' ? included : 0;
      const vat = entry.movementType === 'income' ? included : 0;
      const { error } = await supabaseClient.from('entries').update({ percent, pre_tax: preTax, vat }).eq('id', entry.id);
      if (error) throw error;
      entry.percent = percent;
      entry.preTax = preTax;
      entry.vat = vat;
      done++;
    }
    renderSummary();
    renderEntries();
    window.alert(`${done} Buchung(en) mit dem jeweiligen Konto-Steuersatz aktualisiert.`);
    statusEl.textContent = `${done} Buchungen mit Steuersatz ergänzt.`;
  } catch (error) {
    window.alert(`Es wurden ${done} von ${toFix.length} aktualisiert, dann trat ein Fehler auf: ${error?.message || 'unbekannt'}`);
  } finally {
    applyTaxBtn.disabled = false;
  }
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

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// Bericht: Zusammenfassung der steuerlichen Vorfälle (Einnahmen mit MWSt + gebuchte Vorsteuer).
function exportTaxReport() {
  const year = reportYear.value;
  const yearEntries = state.entries.filter((entry) => (entry.date || '').slice(0, 4) === year);

  // Einnahmen mit Steuersatz, nach Konto gruppiert.
  const incomeVat = yearEntries
    .filter((entry) => entry.movementType === 'income' && Number(entry.percent) > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const groups = new Map();
  incomeVat.forEach((entry) => {
    const key = entry.accountCode || '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });

  const aoa = [];
  aoa.push(['Polizei-Sportvereinigung Bochum e.V.', '', '', `${year} Einnahmen mit MWSt und gebuchte Vorsteuer`, '', '', '', '', '', 'Fußballabteilung']);
  aoa.push(['', '', '', '', '', '', '', '', `USt-Berechnung Kj ${year}`]);
  aoa.push([]);
  aoa.push(['Datum', 'lfd. Nr.', 'Text', '%', 'Vorst. enth.', 'MWSt enth.', 'Einnahmen brutto', 'Ausgabe', 'gebucht', 'Einnahmen netto']);

  let mwstTotal = 0;
  [...groups.keys()]
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0))
    .forEach((accountCode) => {
      const list = groups.get(accountCode);
      const label = list[0].accountLabel || accountCode;
      aoa.push([]);
      aoa.push(['', '', label]);
      let sumBrutto = 0;
      let sumMwst = 0;
      let sumNetto = 0;
      list.forEach((entry) => {
        const mwst = includedTax(entry);
        const netto = entry.amount - mwst;
        sumBrutto += entry.amount;
        sumMwst += mwst;
        sumNetto += netto;
        aoa.push([entry.date, entry.statementNumber, entry.text || entry.description, `${entry.percent}%`, '', round2(mwst), round2(entry.amount), '', entry.accountCode, '']);
      });
      aoa.push(['', '', 'Summe', '', '', round2(sumMwst), round2(sumBrutto), '', '', round2(sumNetto)]);
      mwstTotal += sumMwst;
    });

  // Gesamte gebuchte Vorsteuer (Ausgaben mit Steuersatz) im Jahr.
  const vorsteuerTotal = yearEntries
    .filter((entry) => entry.movementType === 'expense' && Number(entry.percent) > 0)
    .reduce((sum, entry) => sum + includedTax(entry), 0);

  aoa.push([]);
  aoa.push(['', '', 'MWSt gesamt', '', '', round2(mwstTotal)]);
  aoa.push(['', '', `Vorsteuer ${year} lt. Buchhaltung`, '', '', -round2(vorsteuerTotal)]);
  aoa.push(['', '', `Zahllast Umsatzsteuer ${year}`, '', '', round2(mwstTotal - vorsteuerTotal)]);

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet['!cols'] = [{ wch: 12 }, { wch: 9 }, { wch: 45 }, { wch: 5 }, { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 10 }, { wch: 9 }, { wch: 15 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Steuerliche Vorfälle');
  XLSX.writeFile(workbook, `Steuerliche-Vorfaelle-${year}.xlsx`);
}

// Summen je Kontonummer für ein Jahr.
function yearSums(year) {
  const inc = {};
  const exp = {};
  state.entries.filter((entry) => (entry.date || '').slice(0, 4) === year).forEach((entry) => {
    const code = entry.accountCode || '';
    if (entry.movementType === 'income') inc[code] = (inc[code] || 0) + entry.amount;
    else exp[code] = (exp[code] || 0) + entry.amount;
  });
  return { inc, exp };
}

// Journal-Zeilen (Bank/Kasse) für ein Jahr, mit fortlaufendem Bestand (chronologisch).
function yearLedgerRows(wallet, year) {
  const sorted = [...state.entries].filter((entry) => entry.wallet === wallet).sort((a, b) => new Date(a.date) - new Date(b.date));
  let balance = 0;
  const rows = [['Datum', 'Auszug/lfd. Nr.', 'Text', '%', 'Vorst. enth.', 'MWSt enth.', 'Einnahmen', 'Ausgabe', 'gebucht', 'Bestand']];
  sorted.forEach((entry) => {
    balance += entry.movementType === 'income' ? entry.amount : -entry.amount;
    if ((entry.date || '').slice(0, 4) !== year) return;
    const tax = includedTax(entry);
    rows.push([
      entry.date,
      entry.statementNumber,
      entry.text || entry.description,
      entry.percent ? `${entry.percent}%` : '',
      entry.movementType === 'expense' && tax ? round2(tax) : '',
      entry.movementType === 'income' && tax ? round2(tax) : '',
      entry.movementType === 'income' ? round2(entry.amount) : '',
      entry.movementType === 'expense' ? round2(entry.amount) : '',
      entry.accountCode || '',
      round2(balance)
    ]);
  });
  return rows;
}

function closingBalance(wallet, year) {
  return round2(state.entries
    .filter((entry) => entry.wallet === wallet && (entry.date || '') <= `${year}-12-31`)
    .reduce((sum, entry) => sum + (entry.movementType === 'income' ? entry.amount : -entry.amount), 0));
}

// Bericht: Jahresabschluss – offizielles Formular-Layout mit automatisch summierten Konto-Beträgen.
function exportYearReport() {
  const year = reportYear.value;
  const sums = yearSums(year);
  const inc = (code) => round2(sums.inc[code] || 0);
  const exp = (code) => round2(sums.exp[code] || 0);
  const sumInc = (list) => round2(list.reduce((sum, code) => sum + (sums.inc[code] || 0), 0));
  const sumExp = (list) => round2(list.reduce((sum, code) => sum + (sums.exp[code] || 0), 0));
  const range = (a, b) => { const out = []; for (let i = a; i <= b; i++) out.push(String(i)); return out; };

  const rows = [];
  const R = (a = '', b = '', c = '', d = '', e = '') => rows.push([a, b, c, d, e]);

  R('Polizei-Sportvereinigung Bochum e.V.', '', '', '', 'Abteilung Fußball');
  R('', `Geschäftsjahr ${year}`);
  R('', 'AUTOMATISCH aus der Buchführung summiert – manuell umkategorisierte Posten (Durchläufe über HV usw.) bitte prüfen!');
  R();
  R('', '', 'Einnahmen', '', 'Ausgaben');
  R();

  // I. Steuerfreier Bereich
  R('I. Steuerfreier Bereich');
  R('', 'Einnahmen');
  R('A.', 'Ideeller Bereich');
  [['1', '1. Mitgliedsbeiträge'], ['2', '2. Aufnahmegebühren'], ['3', '3. Spenden'], ['4', '4. Zuschüsse'], ['5', '5. Anteilige Kosten'], ['6', '6. Kursgebühren'], ['7', '7. Sonstiges/Erstattungen/Überschussverteilung']].forEach(([a, l]) => R(a, l, inc(a)));
  R('B.', 'Vermögensverwaltung');
  [['8', '1. Zinserträge'], ['9', '2. Mahngebühren'], ['10', '3. Pachteinnahmen'], ['11', '4. Erlöse Geräteverkauf'], ['12', '5. Kreditaufnahme'], ['13', '6. Sonstiges']].forEach(([a, l]) => R(a, l, inc(a)));
  R('', 'Einnahmen (A + B)', sumInc(range(1, 13)));
  R('', 'Interne Buchungen (nachrichtlich):');
  [['14', 'AG Bochum Strafen über HV'], ['15', 'Spenden an Abteilung über HV'], ['16', 'Zuschüsse an Abteilung über HV (Übungsleiter LSB)'], ['17', 'Überschussverteilung des HV']].forEach(([a, l]) => R(a, l, inc(a)));
  R();
  R('', 'Ausgaben');
  [['18', '2. Verwaltungskosten der Abteilung'], ['19', '3. Bankgebühren'], ['20', '4. Beitragsrückerstattung'], ['21', '5. Ehrungen/Mitgliederpflege'], ['22', '6. Verbandsabgaben/Fachverband'], ['23', '7. Versicherungen PKW'], ['24', '8. Aufwandsentschädigung'], ['25', '9. Betriebskosten PKW'], ['26', '10. Büroausstattung'], ['27', '11. Werbung/Öffentlichkeitsarbeit'], ['28', '12. Reparaturen'], ['29', '13. Mitgliederversammlung'], ['30', '14. Unterhaltung Vereinslokal'], ['31', '15. Sonstige Ausgaben']].forEach(([a, l]) => R(a, l, '', '', exp(a)));
  R('', 'Interne Buchungen:');
  [['32', '1. Beiträge der Abteilung an HV'], ['33', '2. Umsatzsteueranteil'], ['34', '3. Anteil Sportstättenbenutzungsgeb.'], ['35', '4. Darlehenstilgung'], ['36', '5. Sonstiges']].forEach(([a, l]) => R(a, l, '', '', exp(a)));
  R();
  R('', 'Summe Abschnitt I', sumInc(range(1, 17)), '', sumExp(range(18, 36)));
  R();

  // II. Zweckbetrieb
  R('II. Zweckbetrieb – Sportliche Veranstaltungen');
  R('', 'Einnahmen');
  [['37', '1. Eintrittsgelder inkl. 7% MWSt'], ['38', '2. Eintrittsgelder inkl. 5% MWSt'], ['39', '3. Zuschuss'], ['40', '4. Eintritt Einnahmen-Teilung'], ['41', '5. Ausbildungsentschädigung'], ['42', '6. VKG-Erstattung v. Klaudia Post'], ['43', '7. Sonstiges/Erstattungen']].forEach(([a, l]) => R(a, l, inc(a)));
  R('', 'Ausgaben');
  [['44', '1. Kosten für Sportanlagen'], ['45', '2. Sportgeräte/Sportbekleidung'], ['46', '3. Startgelder'], ['47', '4. Fahrtkosten'], ['48', '5. Aufwandsentschädigungen'], ['49', '6. Schiedsrichter'], ['50', '7. Ordnungsgebühren (Verband)'], ['51', '8. Fürsorge'], ['52', '9. Sieger-/Sportlerehrungen'], ['53', '10. Versorgung'], ['54', '11. Ablösezahlung'], ['55', '12. Ablösezahlungen'], ['56', '13. Jugendleiter'], ['57', '14. Lehrgänge'], ['58', '15. Übungsleiter/Betreuer'], ['59', '16. Veranstaltungen'], ['81', '17. Entgelt Vertragsspieler'], ['82', '18. Minijobzentrale Vertragsspieler'], ['62', '19. Sonstiges'], ['63', '20. Einnahmeteilung an Gastverein']].forEach(([a, l]) => R(a, l, '', '', exp(a)));
  R();
  R('', 'Summe Abschnitt II', sumInc(range(37, 43)), '', sumExp([...range(44, 59), '81', '82', '62', '63']));
  R();

  // III. Wirtschaftliche Geschäftsbetriebe
  R('III. Wirtschaftliche Geschäftsbetriebe');
  R('1.', 'Gesellige Veranstaltungen');
  R('', 'Einnahmen');
  R('64', '1. Eintrittsgelder', inc('64'));
  R('', 'Ausgaben (brutto)');
  [['65', '1. Musik/Künstler/Hilfskräfte/Dekoration'], ['66', '2. sonstige Ausgaben'], ['67', '3. Mietkosten/Versicherungen']].forEach(([a, l]) => R(a, l, '', '', exp(a)));
  R('2.', 'Verkauf von Speisen und Getränken');
  R('', 'Einnahmen');
  [['68', '1. Verkauf Speisen/Getränke inkl. 19% MWSt'], ['69', '2. Werbeeinnahmen Fußballturnier inkl. 19% MWSt']].forEach(([a, l]) => R(a, l, inc(a)));
  R('', 'Ausgaben (brutto)');
  [['70', '1. Einkauf Speisen inkl. 7% MSt'], ['71', '2. Einkauf Getränke inkl. 19% MSt'], ['72', '3. Betriebsmittel inkl. 19% MSt'], ['73', '4. Verkaufsgenehmigung'], ['74', '5. Gebühren inkl. 7% MSt'], ['75', '6. TV-Gebühren'], ['76', '7. Zinsen'], ['77', '8. Sonstige']].forEach(([a, l]) => R(a, l, '', '', exp(a)));
  R('3.', 'Werbung');
  R('78', 'Einnahmen inkl. 19% MWSt', inc('78'));
  [['79', '1. Ausgaben'], ['80', '2. Ausgaben']].forEach(([a, l]) => R(a, l, '', '', exp(a)));
  const iiiInc = ['64', '68', '69', '78'];
  const iiiExp = ['65', '66', '67', '70', '71', '72', '73', '74', '75', '76', '77', '79', '80'];
  R();
  R('', 'Summe Abschnitt III', sumInc(iiiInc), '', sumExp(iiiExp));
  R();
  R();

  // Gesamtübersicht
  const incI = sumInc(range(1, 17));
  const incII = sumInc(range(37, 43));
  const incIII = sumInc(iiiInc);
  const expI = sumExp(range(18, 36));
  const expII = sumExp([...range(44, 59), '81', '82', '62', '63']);
  const expIII = sumExp(iiiExp);
  const totalInc = round2(incI + incII + incIII);
  const totalExp = round2(expI + expII + expIII);
  R('Gesamtübersicht');
  R('', 'Einnahmen Abschnitt I', incI);
  R('', 'Einnahmen Abschnitt II', incII);
  R('', 'Einnahmen Abschnitt III', incIII);
  R('', 'Einnahmen gesamt', totalInc);
  R();
  R('', 'Ausgaben Abschnitt I', '', '', expI);
  R('', 'Ausgaben Abschnitt II', '', '', expII);
  R('', 'Ausgaben Abschnitt III', '', '', expIII);
  R('', 'Ausgaben gesamt', '', '', totalExp);
  R();
  R('', 'Ergebnis (Einnahmen − Ausgaben)', round2(totalInc - totalExp));
  R();
  R('', `Kassenbestand am 31.12.${year}`, closingBalance('cash', year));
  R('', `Sparkasse (Bank) am 31.12.${year}`, closingBalance('bank', year));

  const formSheet = XLSX.utils.aoa_to_sheet(rows);
  formSheet['!cols'] = [{ wch: 6 }, { wch: 44 }, { wch: 14 }, { wch: 3 }, { wch: 14 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, formSheet, 'Jahresabschluss');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(yearLedgerRows('bank', year)), 'Bank');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(yearLedgerRows('cash', year)), 'Kasse');
  XLSX.writeFile(workbook, `Jahresabschluss-${year}.xlsx`);
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
