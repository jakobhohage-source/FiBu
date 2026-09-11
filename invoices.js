// ===========================================================================
// Rechnungen: erfassen, als PDF ausgeben, offene Posten verfolgen.
//
// Das Layout folgt der Vorlage Rechnung_2026-0001: Logo oben rechts,
// Absender links, Empfängeranschrift, Titelzeile mit Datum und Nummer,
// Vereinskonto, Positionen mit rechtsbündigen Beträgen, Summe und Grußformel.
//
// Wie calendar.js definiert diese Datei nur Funktionen; app.js ruft sie auf.
// ===========================================================================

const invoiceStatusLabels = { open: 'offen', paid: 'bezahlt', cancelled: 'storniert' };

// Vorbelegung, solange unter Einstellungen nichts eingetragen wurde.
const DEFAULT_ORG = {
  name: 'Polizei-Sportvereinigung Bochum e.V.',
  department: 'Abt. Fußball',
  contact: '',
  role: 'Kassenwart Fußballabteilung',
  street: '',
  city: '',
  bank: '',
  iban: '',
  taxNumber: '',
  vatId: '',
  footer: ''
};

let invoicePositions = [];
let invoiceElements = {};
let logoImage = null;

function initInvoices() {
  invoiceElements = {
    form: document.getElementById('invoiceForm'),
    body: document.getElementById('invoicesTableBody'),
    positionsBody: document.getElementById('positionsTableBody'),
    totals: document.getElementById('invoiceTotals'),
    status: document.getElementById('invoiceStatus'),
    badge: document.getElementById('invoiceBadge'),
    openSum: document.getElementById('invoiceOpenSum'),
    numberPreview: document.getElementById('invoiceNumberPreview'),
    account: document.getElementById('invoiceAccount'),
    filterStatus: document.getElementById('invoiceFilterStatus'),
    filterYear: document.getElementById('invoiceFilterYear'),
    payModal: document.getElementById('payModal'),
    payAccount: document.getElementById('payAccount'),
    paySummary: document.getElementById('paySummary'),
    orgForm: document.getElementById('orgForm'),
    orgStatus: document.getElementById('orgStatus')
  };

  invoiceElements.form.addEventListener('submit', handleInvoiceSubmit);
  document.getElementById('invoiceCancel').addEventListener('click', resetInvoiceForm);
  document.getElementById('invoiceAddPosition').addEventListener('click', () => addInvoicePosition());
  document.getElementById('invoicePreviewBtn').addEventListener('click', previewInvoicePdf);
  invoiceElements.positionsBody.addEventListener('input', handlePositionInput);
  invoiceElements.positionsBody.addEventListener('change', handlePositionInput);
  invoiceElements.positionsBody.addEventListener('click', handlePositionClick);
  invoiceElements.body.addEventListener('click', handleInvoiceTableAction);
  invoiceElements.filterStatus.addEventListener('change', renderInvoiceList);
  invoiceElements.filterYear.addEventListener('change', renderInvoiceList);

  document.getElementById('payForm').addEventListener('submit', handlePaySubmit);
  document.getElementById('payCancelBtn').addEventListener('click', closePayModal);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !invoiceElements.payModal.hidden) closePayModal();
  });

  invoiceElements.orgForm.addEventListener('submit', handleOrgSubmit);

  preloadLogo();
  resetInvoiceForm();
}

function preloadLogo() {
  const image = new Image();
  image.addEventListener('load', () => { logoImage = image; });
  image.src = 'logo-print.png';
}

function getOrg() {
  return { ...DEFAULT_ORG, ...(state.settings && state.settings.org ? state.settings.org : {}) };
}

function rowToInvoice(row) {
  return {
    id: row.id,
    number: row.number || '',
    invoiceDate: row.invoice_date || '',
    dueDate: row.due_date || '',
    servicePeriod: row.service_period || '',
    recipientName: row.recipient_name || '',
    recipientAddress: row.recipient_address || '',
    positions: Array.isArray(row.positions) ? row.positions : [],
    totalNet: Number(row.total_net) || 0,
    totalVat: Number(row.total_vat) || 0,
    totalGross: Number(row.total_gross) || 0,
    status: row.status || 'open',
    paidDate: row.paid_date || '',
    entryId: row.entry_id || '',
    wallet: row.wallet || 'bank',
    accountCode: row.account_code || '',
    note: row.note || ''
  };
}

function invoiceToRow(invoice) {
  return {
    number: invoice.number,
    invoice_date: invoice.invoiceDate,
    due_date: invoice.dueDate || null,
    service_period: invoice.servicePeriod || null,
    recipient_name: invoice.recipientName,
    recipient_address: invoice.recipientAddress || null,
    positions: invoice.positions,
    total_net: invoice.totalNet,
    total_vat: invoice.totalVat,
    total_gross: invoice.totalGross,
    status: invoice.status,
    paid_date: invoice.paidDate || null,
    entry_id: invoice.entryId || null,
    wallet: invoice.wallet || null,
    account_code: invoice.accountCode || null,
    note: invoice.note || null
  };
}

// ---------------------------------------------------------------------------
// Rechnen
// ---------------------------------------------------------------------------

function invoiceTotals(positions) {
  const byRate = new Map();
  let net = 0;
  let vat = 0;

  positions.forEach((position) => {
    const lineNet = round2((Number(position.quantity) || 0) * (Number(position.unitPrice) || 0));
    const rate = Number(position.vatRate) || 0;
    const lineVat = round2(lineNet * rate / 100);
    net = round2(net + lineNet);
    vat = round2(vat + lineVat);
    if (rate > 0) byRate.set(rate, round2((byRate.get(rate) || 0) + lineVat));
  });

  return { net, vat, gross: round2(net + vat), byRate };
}

function nextInvoiceNumber(year) {
  const prefix = `${year}-`;
  const used = state.invoices
    .map((invoice) => invoice.number)
    .filter((number) => number.startsWith(prefix))
    .map((number) => Number(number.slice(prefix.length)))
    .filter((number) => Number.isFinite(number));
  const next = used.length ? Math.max(...used) + 1 : 1;
  return prefix + String(next).padStart(4, '0');
}

function formatGermanDate(isoDate) {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

function formatPdfEuro(value) {
  return `${Number(value).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
}

function formatQuantity(value) {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? String(number) : number.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Positionen im Formular
// ---------------------------------------------------------------------------

function addInvoicePosition(position) {
  invoicePositions.push(position || { description: '', quantity: 1, unitPrice: 0, vatRate: 19 });
  renderPositions();
}

function renderPositions() {
  if (!invoicePositions.length) {
    invoiceElements.positionsBody.innerHTML = '<tr><td colspan="6">Noch keine Position. Über „Position hinzufügen" die erste anlegen.</td></tr>';
    renderInvoiceTotals();
    return;
  }

  invoiceElements.positionsBody.innerHTML = invoicePositions.map((position, index) => {
    const lineNet = round2((Number(position.quantity) || 0) * (Number(position.unitPrice) || 0));
    return `
      <tr data-position="${index}">
        <td><textarea data-field="description" rows="2" placeholder="z. B. Bannerwerbung sowie Präsentation Ihres Logos auf unserer Homepage">${escapeHtml(position.description || '')}</textarea></td>
        <td><input type="number" step="0.01" min="0" data-field="quantity" value="${escapeHtml(String(position.quantity))}" /></td>
        <td><input type="number" step="0.01" min="0" data-field="unitPrice" value="${escapeHtml(String(position.unitPrice))}" /></td>
        <td>
          <select data-field="vatRate">
            ${[0, 7, 19].map((rate) => `<option value="${rate}"${Number(position.vatRate) === rate ? ' selected' : ''}>${rate}%</option>`).join('')}
          </select>
        </td>
        <td class="entry-amount positive">${formatEuro(lineNet)}</td>
        <td><button class="table-action-btn danger" type="button" data-position-action="remove" data-index="${index}">Entfernen</button></td>
      </tr>
    `;
  }).join('');

  renderInvoiceTotals();
}

function renderInvoiceTotals() {
  const totals = invoiceTotals(invoicePositions);
  const vatLines = [...totals.byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, amount]) => `<div><span>Mehrwertsteuer (${rate}%)</span><span>${formatEuro(amount)}</span></div>`)
    .join('');

  invoiceElements.totals.innerHTML = `
    <div><span>Summe netto</span><span>${formatEuro(totals.net)}</span></div>
    ${vatLines}
    <div class="invoice-total-gross"><span>Gesamtbetrag</span><span>${formatEuro(totals.gross)}</span></div>
  `;
}

function handlePositionInput(event) {
  const row = event.target.closest('tr[data-position]');
  const field = event.target.dataset.field;
  if (!row || !field) return;

  const position = invoicePositions[Number(row.dataset.position)];
  if (!position) return;

  position[field] = field === 'description' ? event.target.value : Number(event.target.value) || 0;

  if (field === 'description') {
    renderInvoiceTotals();
    return;
  }
  // Bei Zahlen die Zeilensumme aktualisieren, ohne das Feld neu aufzubauen.
  const lineNet = round2((Number(position.quantity) || 0) * (Number(position.unitPrice) || 0));
  const cell = row.querySelector('.entry-amount');
  if (cell) cell.textContent = formatEuro(lineNet);
  renderInvoiceTotals();
}

function handlePositionClick(event) {
  const button = event.target.closest('button[data-position-action="remove"]');
  if (!button) return;
  invoicePositions.splice(Number(button.dataset.index), 1);
  renderPositions();
}

// ---------------------------------------------------------------------------
// Rechnungsliste
// ---------------------------------------------------------------------------

function renderInvoices() {
  renderInvoiceAccountSelects();
  renderInvoiceList();
  if (!document.getElementById('invoiceId').value) {
    const year = (document.getElementById('invoiceDate').value || todayIso()).slice(0, 4);
    const suggestion = nextInvoiceNumber(year);
    document.getElementById('invoiceNumber').value = suggestion;
    invoiceElements.numberPreview.textContent = `Vorschlag: ${suggestion}`;
  }
}

function renderInvoiceAccountSelects() {
  [invoiceElements.account, invoiceElements.payAccount].forEach((select) => {
    const current = select.value;
    select.innerHTML = importAccountOptions(current);
    select.value = state.accounts.some((account) => account.code === current) ? current : '';
  });
}

function renderInvoiceList() {
  const years = [...new Set(state.invoices.map((invoice) => invoice.invoiceDate.slice(0, 4)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
  const currentYear = invoiceElements.filterYear.value;
  invoiceElements.filterYear.innerHTML = `<option value="">Alle Jahre</option>${years.map((year) => `<option value="${year}">${year}</option>`).join('')}`;
  invoiceElements.filterYear.value = years.includes(currentYear) ? currentYear : '';

  const openInvoices = state.invoices.filter((invoice) => invoice.status === 'open');
  const openSum = round2(openInvoices.reduce((sum, invoice) => sum + invoice.totalGross, 0));
  invoiceElements.openSum.textContent = openInvoices.length
    ? `${openInvoices.length} offen · ${formatEuro(openSum)}`
    : 'nichts offen';

  const today = todayIso();
  const overdue = openInvoices.filter((invoice) => invoice.dueDate && invoice.dueDate < today).length;
  invoiceElements.badge.hidden = overdue === 0;
  invoiceElements.badge.textContent = String(overdue);

  const statusFilter = invoiceElements.filterStatus.value;
  const yearFilter = invoiceElements.filterYear.value;
  const visible = state.invoices
    .filter((invoice) => !statusFilter || invoice.status === statusFilter)
    .filter((invoice) => !yearFilter || invoice.invoiceDate.startsWith(yearFilter))
    .sort((a, b) => b.number.localeCompare(a.number, 'de'));

  if (!visible.length) {
    invoiceElements.body.innerHTML = '<tr><td colspan="6">Keine Rechnungen vorhanden.</td></tr>';
    return;
  }

  invoiceElements.body.innerHTML = visible.map((invoice) => {
    const isOverdue = invoice.status === 'open' && invoice.dueDate && invoice.dueDate < today;
    const statusText = isOverdue
      ? `überfällig seit ${formatGermanDate(invoice.dueDate)}`
      : invoice.status === 'paid'
        ? `bezahlt${invoice.paidDate ? ` am ${formatGermanDate(invoice.paidDate)}` : ''}`
        : invoiceStatusLabels[invoice.status] || invoice.status;

    return `
      <tr class="${isOverdue ? 'invoice-overdue' : ''}">
        <td>${escapeHtml(invoice.number)}</td>
        <td>${escapeHtml(formatGermanDate(invoice.invoiceDate))}</td>
        <td>${escapeHtml(invoice.recipientName)}</td>
        <td class="entry-amount positive">${formatEuro(invoice.totalGross)}</td>
        <td><span class="invoice-status ${invoice.status}${isOverdue ? ' overdue' : ''}">${escapeHtml(statusText)}</span></td>
        <td>
          <button class="account-action-btn" type="button" data-invoice-action="pdf" data-id="${invoice.id}">PDF</button>
          ${invoice.status === 'open' ? `<button class="account-action-btn" type="button" data-invoice-action="pay" data-id="${invoice.id}">Bezahlt</button>` : ''}
          <button class="account-action-btn" type="button" data-invoice-action="edit" data-id="${invoice.id}">Bearbeiten</button>
          <button class="account-action-btn danger" type="button" data-invoice-action="delete" data-id="${invoice.id}">Löschen</button>
        </td>
      </tr>
    `;
  }).join('');
}

// ---------------------------------------------------------------------------
// Speichern und bearbeiten
// ---------------------------------------------------------------------------

function collectInvoiceFromForm() {
  const totals = invoiceTotals(invoicePositions);
  return {
    number: document.getElementById('invoiceNumber').value.trim(),
    invoiceDate: document.getElementById('invoiceDate').value,
    dueDate: document.getElementById('invoiceDueDate').value,
    servicePeriod: document.getElementById('invoiceServicePeriod').value.trim(),
    recipientName: document.getElementById('invoiceRecipient').value.trim(),
    recipientAddress: document.getElementById('invoiceAddress').value.trim(),
    positions: invoicePositions.map((position) => ({
      description: position.description || '',
      quantity: Number(position.quantity) || 0,
      unitPrice: Number(position.unitPrice) || 0,
      vatRate: Number(position.vatRate) || 0
    })),
    totalNet: totals.net,
    totalVat: totals.vat,
    totalGross: totals.gross,
    wallet: document.getElementById('invoiceWallet').value,
    accountCode: invoiceElements.account.value,
    note: document.getElementById('invoiceNote').value.trim()
  };
}

async function handleInvoiceSubmit(event) {
  event.preventDefault();

  const id = document.getElementById('invoiceId').value;
  const existing = state.invoices.find((invoice) => invoice.id === id);
  const invoice = collectInvoiceFromForm();

  if (!invoice.number || !invoice.recipientName || !invoice.invoiceDate) return;
  if (!invoice.positions.length) {
    invoiceElements.status.textContent = 'Die Rechnung braucht mindestens eine Position.';
    return;
  }

  const duplicate = state.invoices.some((other) => other.number === invoice.number && other.id !== id);
  if (duplicate) {
    invoiceElements.status.textContent = `Die Nummer ${invoice.number} ist schon vergeben.`;
    return;
  }

  invoice.status = existing ? existing.status : 'open';
  invoice.paidDate = existing ? existing.paidDate : '';
  invoice.entryId = existing ? existing.entryId : '';

  try {
    if (id) {
      const { error } = await supabaseClient.from('invoices').update(invoiceToRow(invoice)).eq('id', id);
      if (error) throw error;
      state.invoices = state.invoices.map((item) => item.id === id ? { ...invoice, id } : item);
    } else {
      const { data, error } = await supabaseClient.from('invoices').insert(invoiceToRow(invoice)).select().single();
      if (error) throw error;
      state.invoices.push(rowToInvoice(data));
    }
  } catch (error) {
    invoiceElements.status.textContent = 'Rechnung konnte nicht gespeichert werden. Wurde supabase-setup.sql erneut ausgeführt?';
    return;
  }

  const saved = state.invoices.find((item) => item.number === invoice.number);
  resetInvoiceForm();
  renderInvoices();
  showToast(id ? 'Rechnung aktualisiert ✓' : 'Rechnung gespeichert ✓');
  if (saved) openInvoicePdf(saved);
}

async function handleInvoiceTableAction(event) {
  const button = event.target.closest('button[data-invoice-action]');
  if (!button) return;

  const invoice = state.invoices.find((item) => item.id === button.dataset.id);
  if (!invoice) return;
  const action = button.dataset.invoiceAction;

  if (action === 'pdf') {
    openInvoicePdf(invoice);
    return;
  }

  if (action === 'edit') {
    populateInvoiceForm(invoice);
    activateTab('invoices');
    return;
  }

  if (action === 'pay') {
    openPayModal(invoice);
    return;
  }

  if (action === 'delete') {
    const extra = invoice.entryId ? '\n\nDie zugehörige Buchung bleibt bestehen und müsste separat gelöscht werden.' : '';
    if (!window.confirm(`Rechnung ${invoice.number} wirklich löschen?${extra}`)) return;
    try {
      const { error } = await supabaseClient.from('invoices').delete().eq('id', invoice.id);
      if (error) throw error;
    } catch (error) {
      invoiceElements.status.textContent = 'Rechnung konnte nicht gelöscht werden.';
      return;
    }
    state.invoices = state.invoices.filter((item) => item.id !== invoice.id);
    if (document.getElementById('invoiceId').value === invoice.id) resetInvoiceForm();
    renderInvoices();
  }
}

function populateInvoiceForm(invoice) {
  document.getElementById('invoiceId').value = invoice.id;
  document.getElementById('invoiceNumber').value = invoice.number;
  document.getElementById('invoiceDate').value = invoice.invoiceDate;
  document.getElementById('invoiceDueDate').value = invoice.dueDate || '';
  document.getElementById('invoiceRecipient').value = invoice.recipientName;
  document.getElementById('invoiceAddress').value = invoice.recipientAddress || '';
  document.getElementById('invoiceServicePeriod').value = invoice.servicePeriod || '';
  document.getElementById('invoiceWallet').value = invoice.wallet || 'bank';
  document.getElementById('invoiceNote').value = invoice.note || '';
  renderInvoiceAccountSelects();
  invoiceElements.account.value = invoice.accountCode || '';

  invoicePositions = invoice.positions.map((position) => ({ ...position }));
  renderPositions();

  document.getElementById('invoiceFormTitle').textContent = `Rechnung ${invoice.number} bearbeiten`;
  document.getElementById('invoiceSubmit').textContent = 'Änderungen speichern';
  invoiceElements.numberPreview.textContent = invoiceStatusLabels[invoice.status] || '';
  invoiceElements.status.textContent = '';
}

function resetInvoiceForm() {
  invoiceElements.form.reset();
  document.getElementById('invoiceId').value = '';
  document.getElementById('invoiceDate').value = todayIso();
  document.getElementById('invoiceWallet').value = 'bank';
  document.getElementById('invoiceFormTitle').textContent = 'Neue Rechnung';
  document.getElementById('invoiceSubmit').textContent = 'Rechnung speichern';
  invoicePositions = [{ description: '', quantity: 1, unitPrice: 0, vatRate: 19 }];
  renderPositions();
  renderInvoiceAccountSelects();
  invoiceElements.status.textContent = '';

  const suggestion = nextInvoiceNumber(todayIso().slice(0, 4));
  document.getElementById('invoiceNumber').value = suggestion;
  invoiceElements.numberPreview.textContent = `Vorschlag: ${suggestion}`;
}

// ---------------------------------------------------------------------------
// Zahlungseingang als Buchung
// ---------------------------------------------------------------------------

function openPayModal(invoice) {
  document.getElementById('payInvoiceId').value = invoice.id;
  document.getElementById('payDate').value = todayIso();
  document.getElementById('payWallet').value = invoice.wallet || 'bank';
  renderInvoiceAccountSelects();
  invoiceElements.payAccount.value = invoice.accountCode || '';
  invoiceElements.paySummary.textContent = `${invoice.number} · ${invoice.recipientName} · ${formatEuro(invoice.totalGross)}`;
  invoiceElements.payModal.hidden = false;
}

function closePayModal() {
  invoiceElements.payModal.hidden = true;
}

async function handlePaySubmit(event) {
  event.preventDefault();

  const invoice = state.invoices.find((item) => item.id === document.getElementById('payInvoiceId').value);
  if (!invoice) return;

  const paidDate = document.getElementById('payDate').value;
  const wallet = document.getElementById('payWallet').value;
  const accountCode = invoiceElements.payAccount.value;
  const account = state.accounts.find((item) => item.code === accountCode);

  // Nur wenn alle Positionen denselben Satz haben, lässt er sich eindeutig übernehmen.
  const rates = [...new Set(invoice.positions.map((position) => Number(position.vatRate) || 0))];
  const percent = rates.length === 1 && rates[0] > 0 ? String(rates[0]) : '';
  const included = percent ? invoice.totalGross * (Number(percent) / (100 + Number(percent))) : 0;
  const description = `Rechnung ${invoice.number} · ${invoice.recipientName}`;

  const confirmBtn = document.getElementById('payConfirmBtn');
  confirmBtn.disabled = true;
  try {
    const { data, error } = await supabaseClient
      .from('entries')
      .insert(entryToRow({
        date: paidDate,
        amount: invoice.totalGross,
        movementType: 'income',
        wallet,
        accountCode,
        accountLabel: account ? account.label : '',
        description,
        statementNumber: '',
        text: description,
        percent,
        preTax: 0,
        vat: included,
        booked: paidDate,
        receiptPath: '',
        receiptName: '',
        importHash: ''
      }))
      .select()
      .single();
    if (error) throw error;

    const { error: updateError } = await supabaseClient
      .from('invoices')
      .update({ status: 'paid', paid_date: paidDate, entry_id: data.id, wallet, account_code: accountCode || null })
      .eq('id', invoice.id);
    if (updateError) throw updateError;

    state.entries.push(rowToEntry(data));
    Object.assign(invoice, { status: 'paid', paidDate, entryId: data.id, wallet, accountCode });
  } catch (error) {
    window.alert('Die Buchung konnte nicht angelegt werden: ' + (error?.message || 'unbekannter Fehler'));
    return;
  } finally {
    confirmBtn.disabled = false;
  }

  closePayModal();
  renderSummary();
  renderEntries();
  renderInvoices();
  showToast(`Zahlungseingang für ${invoice.number} gebucht ✓`);
}

// ---------------------------------------------------------------------------
// Vereinsdaten
// ---------------------------------------------------------------------------

function renderOrgForm() {
  const org = getOrg();
  const fields = {
    orgName: 'name', orgDepartment: 'department', orgContact: 'contact', orgRole: 'role',
    orgStreet: 'street', orgCity: 'city', orgBank: 'bank', orgIban: 'iban',
    orgTaxNumber: 'taxNumber', orgVatId: 'vatId', orgFooter: 'footer'
  };
  Object.entries(fields).forEach(([elementId, key]) => {
    document.getElementById(elementId).value = org[key] || '';
  });
}

async function handleOrgSubmit(event) {
  event.preventDefault();

  const org = {
    name: document.getElementById('orgName').value.trim(),
    department: document.getElementById('orgDepartment').value.trim(),
    contact: document.getElementById('orgContact').value.trim(),
    role: document.getElementById('orgRole').value.trim(),
    street: document.getElementById('orgStreet').value.trim(),
    city: document.getElementById('orgCity').value.trim(),
    bank: document.getElementById('orgBank').value.trim(),
    iban: document.getElementById('orgIban').value.trim(),
    taxNumber: document.getElementById('orgTaxNumber').value.trim(),
    vatId: document.getElementById('orgVatId').value.trim(),
    footer: document.getElementById('orgFooter').value.trim()
  };

  try {
    const { error } = await supabaseClient
      .from('app_settings')
      .upsert({ key: 'org', value: org, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
  } catch (error) {
    invoiceElements.orgStatus.textContent = 'Vereinsdaten konnten nicht gespeichert werden. Wurde supabase-setup.sql erneut ausgeführt?';
    return;
  }

  state.settings = { ...state.settings, org };
  invoiceElements.orgStatus.textContent = 'Vereinsdaten gespeichert.';
  showToast('Vereinsdaten gespeichert ✓');
}

// ---------------------------------------------------------------------------
// PDF nach dem Muster der Vorlage
// ---------------------------------------------------------------------------

function previewInvoicePdf() {
  const invoice = collectInvoiceFromForm();
  if (!invoice.recipientName) {
    invoiceElements.status.textContent = 'Für die Vorschau fehlt noch der Empfänger.';
    return;
  }
  if (!invoice.positions.length) {
    invoiceElements.status.textContent = 'Für die Vorschau fehlt noch eine Position.';
    return;
  }
  openInvoicePdf(invoice);
}

function openInvoicePdf(invoice) {
  try {
    const doc = buildInvoicePdf(invoice);
    // Im neuen Tab anzeigen; von dort lässt sich das PDF speichern oder drucken.
    const url = doc.output('bloburl');
    const viewer = window.open(url, '_blank', 'noopener');
    if (!viewer) doc.save(`Rechnung_${invoice.number}.pdf`);
  } catch (error) {
    window.alert('Das PDF konnte nicht erzeugt werden: ' + (error?.message || 'unbekannter Fehler'));
  }
}

function buildInvoicePdf(invoice) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const org = getOrg();

  const left = 25;
  const right = 190;
  const textWidth = 108;
  // Unterhalb dieser Höhe beginnt der Fußbereich (Trennlinie bei 269,6 mm).
  // jsPDF bricht nicht von selbst um – ohne diese Grenze würden Positionen
  // einer langen Rechnung unsichtbar neben der Seite landen.
  const contentBottom = 262;
  const ensureSpace = (needed) => {
    if (y + needed <= contentBottom) return;
    doc.addPage();
    y = 28;
  };

  if (logoImage) {
    doc.addImage(logoImage, 'PNG', right - 28, 14, 28, 28);
  }

  // Absender
  let y = 20;
  doc.setFont('helvetica', 'bold').setFontSize(11);
  doc.text(org.name || '', left, y);
  doc.setFont('helvetica', 'normal').setFontSize(10);
  y += 5;
  [org.department, org.contact, org.street, org.city].filter(Boolean).forEach((line) => {
    doc.text(line, left, y);
    y += 4.6;
  });

  // Empfänger
  y = 62;
  doc.setFont('helvetica', 'bold').setFontSize(11);
  doc.text(invoice.recipientName || '', left, y);
  doc.setFont('helvetica', 'normal');
  y += 5.4;
  String(invoice.recipientAddress || '').split('\n').map((line) => line.trim()).filter(Boolean).forEach((line) => {
    doc.text(line, left, y);
    y += 5.4;
  });

  // Titelzeile mit Datum und Nummer
  y = 104;
  doc.setFont('helvetica', 'bold').setFontSize(15);
  doc.text('Rechnung', left, y);
  doc.setFont('helvetica', 'normal').setFontSize(11);
  doc.text(formatGermanDate(invoice.invoiceDate), right, y, { align: 'right' });
  y += 6.5;
  doc.text(`Rechn.-Nr.: ${invoice.number}`, right, y, { align: 'right' });

  // Vereinskonto
  y += 14;
  if (org.bank || org.iban) {
    doc.text('Bitte überweisen Sie den Rechnungsbetrag auf unser Konto:', left, y);
    y += 5.6;
    [org.bank, org.iban].filter(Boolean).forEach((line) => {
      doc.text(line, left, y);
      y += 5.2;
    });
    y += 6;
  }

  if (invoice.servicePeriod) {
    doc.text(`Leistungszeitraum: ${invoice.servicePeriod}`, left, y);
    y += 9;
  }

  // Positionen, Betrag rechtsbündig wie in der Vorlage
  invoice.positions.forEach((position) => {
    const lineNet = round2((Number(position.quantity) || 0) * (Number(position.unitPrice) || 0));
    const lines = doc.splitTextToSize(position.description || '', textWidth);
    if (!lines.length) lines.push('');

    // Eine Position möglichst nicht über den Seitenrand hinweg trennen.
    ensureSpace(lines.length * 5.2 + 7);

    lines.forEach((line, index) => {
      ensureSpace(5.2);
      doc.text(line, left, y);
      if (index === lines.length - 1) doc.text(formatPdfEuro(lineNet), right, y, { align: 'right' });
      y += 5.2;
    });

    if (Number(position.quantity) !== 1) {
      doc.setFontSize(9).setTextColor(110);
      doc.text(`${formatQuantity(position.quantity)} × ${formatPdfEuro(position.unitPrice)}`, left, y);
      doc.setFontSize(11).setTextColor(0);
      y += 5;
    }
    y += 2;
  });

  // Summen
  const totals = invoiceTotals(invoice.positions);
  ensureSpace(totals.byRate.size * 5.6 + 22);
  y += 2;
  if (invoice.positions.length > 1) {
    doc.text('Summe netto', left, y);
    doc.text(formatPdfEuro(totals.net), right, y, { align: 'right' });
    y += 5.6;
  }
  [...totals.byRate.entries()].sort((a, b) => a[0] - b[0]).forEach(([rate, amount]) => {
    doc.text(`Mehrwertsteuer (${rate}%)`, left, y);
    doc.text(formatPdfEuro(amount), right, y, { align: 'right' });
    y += 5.6;
  });

  doc.setDrawColor(120).setLineWidth(0.3);
  doc.line(right - 45, y - 3.4, right, y - 3.4);
  y += 1.5;
  doc.setFont('helvetica', 'bold');
  doc.text('Gesamtbetrag', left, y);
  doc.text(formatPdfEuro(totals.gross), right, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  y += 10;

  if (invoice.dueDate) {
    ensureSpace(10);
    doc.text(`Zahlbar ohne Abzug bis zum ${formatGermanDate(invoice.dueDate)}.`, left, y);
    y += 10;
  }

  // Grußformel: auf einer kurzen Rechnung unten am Blatt, sonst direkt im Anschluss.
  const signatureLines = [org.contact, org.name, org.role].filter(Boolean);
  if (doc.getNumberOfPages() === 1 && y < 214) y = 214;
  ensureSpace(13 + signatureLines.length * 5.2);
  doc.text('Mit freundlichen Grüßen', left, y);
  y += 13; // Platz für die Unterschrift
  signatureLines.forEach((line) => {
    doc.text(line, left, y);
    y += 5.2;
  });

  // Fußzeile mit den steuerlichen Pflichtangaben – auf jeder Seite.
  const footerLines = [
    [org.name, org.department].filter(Boolean).join(' · '),
    [org.street, org.city].filter(Boolean).join(', '),
    [org.taxNumber ? `Steuernummer: ${org.taxNumber}` : '', org.vatId ? `USt-IdNr.: ${org.vatId}` : '']
      .filter(Boolean).join(' · '),
    [org.bank, org.iban].filter(Boolean).join(' · '),
    org.footer
  ].filter(Boolean);

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setFontSize(8).setTextColor(120);
    let footerY = 289 - (footerLines.length - 1) * 3.6;
    doc.setDrawColor(200).setLineWidth(0.2);
    doc.line(left, footerY - 5, right, footerY - 5);
    footerLines.forEach((line) => {
      doc.text(line, left, footerY);
      footerY += 3.6;
    });
    if (pageCount > 1) {
      doc.text(`Seite ${page} von ${pageCount}`, right, 289 - (footerLines.length - 1) * 3.6, { align: 'right' });
      // Auf Seite 1 steht dort schon das Datum neben dem Logo.
      if (page > 1) doc.text(`Rechnung ${invoice.number}`, right, 20, { align: 'right' });
    }
    doc.setFontSize(11).setTextColor(0);
  }

  return doc;
}
