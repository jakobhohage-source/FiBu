// ===========================================================================
// Kalender: wiederkehrende Zahlungen im Blick behalten.
//
// Diese Datei definiert nur Funktionen. Aufgerufen werden sie aus app.js,
// das auch `state`, `supabaseClient` und die Helfer wie showToast bereitstellt
// und deshalb in index.html zuletzt geladen wird.
// ===========================================================================

const intervalLabels = {
  once: 'einmalig',
  month: 'monatlich',
  quarter: 'vierteljährlich',
  year: 'jährlich'
};

const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

let reminderElements = {};

function initCalendar() {
  reminderElements = {
    form: document.getElementById('reminderForm'),
    list: document.getElementById('reminderList'),
    grid: document.getElementById('calendarGrid'),
    year: document.getElementById('calendarYear'),
    count: document.getElementById('reminderCount'),
    badge: document.getElementById('calendarBadge'),
    status: document.getElementById('reminderStatus'),
    account: document.getElementById('reminderAccount')
  };

  reminderElements.form.addEventListener('submit', handleReminderSubmit);
  document.getElementById('reminderCancel').addEventListener('click', resetReminderForm);
  reminderElements.list.addEventListener('click', handleReminderAction);
  reminderElements.grid.addEventListener('click', handleReminderAction);
  reminderElements.year.addEventListener('change', renderCalendarGrid);
  document.getElementById('reminderNextDue').value = todayIso();
}

function todayIso() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  const from = Date.UTC(...fromIso.split('-').map((part, index) => index === 1 ? Number(part) - 1 : Number(part)));
  const to = Date.UTC(...toIso.split('-').map((part, index) => index === 1 ? Number(part) - 1 : Number(part)));
  return Math.round((to - from) / 86400000);
}

// Addiert Monate oder Jahre und begrenzt den Tag auf das Monatsende
// (31. Januar plus ein Monat ergibt den 28. bzw. 29. Februar).
function addInterval(isoDate, unit, count) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const months = unit === 'month' ? count : unit === 'quarter' ? count * 3 : unit === 'year' ? count * 12 : 0;
  if (!months) return isoDate;

  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDayOfMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDayOfMonth));
  return target.toISOString().slice(0, 10);
}

function reminderStatusOf(reminder, today) {
  if (!reminder.active) return 'inactive';
  const days = daysBetween(today, reminder.nextDue);
  if (days < 0) return 'overdue';
  if (days <= reminder.leadDays) return 'due';
  return 'upcoming';
}

function rowToReminder(row) {
  return {
    id: row.id,
    active: row.active !== false,
    title: row.title || '',
    note: row.note || '',
    nextDue: row.next_due || '',
    intervalUnit: row.interval_unit || 'year',
    intervalCount: Number(row.interval_count) || 1,
    leadDays: Number(row.lead_days) || 0,
    amount: row.amount == null ? null : Number(row.amount),
    movementType: row.movement_type || 'expense',
    wallet: row.wallet || 'bank',
    accountCode: row.account_code || '',
    percent: row.percent == null ? '' : String(row.percent),
    lastDone: row.last_done || ''
  };
}

function reminderToRow(reminder) {
  return {
    active: reminder.active,
    title: reminder.title,
    note: reminder.note || null,
    next_due: reminder.nextDue,
    interval_unit: reminder.intervalUnit,
    interval_count: reminder.intervalCount,
    lead_days: reminder.leadDays,
    amount: reminder.amount == null ? null : reminder.amount,
    movement_type: reminder.movementType || null,
    wallet: reminder.wallet || null,
    account_code: reminder.accountCode || null,
    percent: reminder.percent === '' ? null : String(reminder.percent),
    last_done: reminder.lastDone || null
  };
}

// ---------------------------------------------------------------------------
// Anzeige
// ---------------------------------------------------------------------------

function renderCalendar() {
  renderReminderAccountSelect();
  renderReminderList();
  renderCalendarGrid();
}

function renderReminderAccountSelect() {
  const current = reminderElements.account.value;
  reminderElements.account.innerHTML = importAccountOptions(current);
  reminderElements.account.value = state.accounts.some((account) => account.code === current) ? current : '';
}

function pendingReminders() {
  const today = todayIso();
  return state.reminders.filter((reminder) => {
    const status = reminderStatusOf(reminder, today);
    return status === 'overdue' || status === 'due';
  });
}

function renderReminderList() {
  const today = todayIso();
  const active = state.reminders.filter((reminder) => reminder.active);
  const inactive = state.reminders.filter((reminder) => !reminder.active);

  reminderElements.count.textContent = `${state.reminders.length} ${state.reminders.length === 1 ? 'Termin' : 'Termine'}`;

  const pending = pendingReminders().length;
  reminderElements.badge.hidden = pending === 0;
  reminderElements.badge.textContent = String(pending);

  if (!state.reminders.length) {
    reminderElements.list.innerHTML = '<p class="meta">Noch keine Termine angelegt. Trag unten die erste wiederkehrende Zahlung ein.</p>';
    return;
  }

  const sorted = [...active].sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  const groups = [
    { key: 'overdue', title: 'Überfällig', items: sorted.filter((r) => reminderStatusOf(r, today) === 'overdue') },
    { key: 'due', title: 'Jetzt fällig', items: sorted.filter((r) => reminderStatusOf(r, today) === 'due') },
    { key: 'upcoming', title: 'Später', items: sorted.filter((r) => reminderStatusOf(r, today) === 'upcoming') },
    { key: 'inactive', title: 'Abgeschlossen', items: inactive }
  ].filter((group) => group.items.length);

  reminderElements.list.innerHTML = groups.map((group) => `
    <div class="reminder-group">
      <h3 class="reminder-group-title ${group.key}">${group.title} <span class="pill">${group.items.length}</span></h3>
      ${group.items.map((reminder) => renderReminderCard(reminder, today)).join('')}
    </div>
  `).join('');
}

function renderReminderCard(reminder, today) {
  const status = reminderStatusOf(reminder, today);
  const days = daysBetween(today, reminder.nextDue);
  const timing = status === 'inactive'
    ? 'abgeschlossen'
    : days < 0 ? `seit ${Math.abs(days)} ${Math.abs(days) === 1 ? 'Tag' : 'Tagen'} überfällig`
    : days === 0 ? 'heute fällig'
    : `in ${days} ${days === 1 ? 'Tag' : 'Tagen'}`;

  const account = state.accounts.find((item) => item.code === reminder.accountCode);
  const details = [
    intervalLabels[reminder.intervalUnit] || reminder.intervalUnit,
    reminder.amount != null ? formatEuro(reminder.amount) : null,
    account ? account.label : null,
    reminder.wallet === 'cash' ? 'Kasse' : 'Bank'
  ].filter(Boolean).join(' · ');

  return `
    <article class="reminder-card ${status}">
      <div class="reminder-main">
        <strong>${escapeHtml(reminder.title)}</strong>
        <span class="meta">${escapeHtml(reminder.nextDue)} — ${escapeHtml(timing)}</span>
        <span class="meta">${escapeHtml(details)}</span>
        ${reminder.note ? `<span class="meta">${escapeHtml(reminder.note)}</span>` : ''}
      </div>
      <div class="reminder-actions">
        ${reminder.active ? `<button class="table-action-btn" type="button" data-reminder-action="book" data-id="${reminder.id}">Jetzt buchen</button>` : ''}
        ${reminder.active ? `<button class="table-action-btn" type="button" data-reminder-action="done" data-id="${reminder.id}">Erledigt</button>` : ''}
        <button class="table-action-btn" type="button" data-reminder-action="edit" data-id="${reminder.id}">Bearbeiten</button>
        <button class="table-action-btn danger" type="button" data-reminder-action="delete" data-id="${reminder.id}">Löschen</button>
      </div>
    </article>
  `;
}

// Zeigt für ein Jahr, in welchem Monat welcher Termin liegt – auch die
// künftigen Wiederholungen, die sich aus dem Intervall ergeben.
function renderCalendarGrid() {
  const years = new Set([new Date().getFullYear()]);
  state.reminders.forEach((reminder) => {
    const year = Number((reminder.nextDue || '').slice(0, 4));
    if (year) years.add(year);
  });
  const yearList = [...years].sort();

  const currentSelection = reminderElements.year.value;
  reminderElements.year.innerHTML = yearList.map((year) => `<option value="${year}">${year}</option>`).join('');
  reminderElements.year.value = yearList.includes(Number(currentSelection))
    ? currentSelection
    : String(new Date().getFullYear());

  const year = Number(reminderElements.year.value);
  const today = todayIso();
  const byMonth = Array.from({ length: 12 }, () => []);

  state.reminders.filter((reminder) => reminder.active).forEach((reminder) => {
    occurrencesInYear(reminder, year).forEach((date) => {
      byMonth[Number(date.slice(5, 7)) - 1].push({ reminder, date });
    });
  });

  const currentMonth = new Date().getMonth();
  const isCurrentYear = year === new Date().getFullYear();

  reminderElements.grid.innerHTML = monthNames.map((name, index) => {
    const items = byMonth[index].sort((a, b) => a.date.localeCompare(b.date));
    const highlight = isCurrentYear && index === currentMonth ? ' current' : '';
    return `
      <div class="calendar-month${highlight}">
        <h4>${name}</h4>
        ${items.length
          ? items.map(({ reminder, date }) => {
              const status = date < today ? 'past' : reminderStatusOf(reminder, today);
              return `<button class="calendar-entry ${status}" type="button" data-reminder-action="edit" data-id="${reminder.id}" title="${escapeHtml(reminder.title)}">
                        <span class="calendar-day">${date.slice(8, 10)}.</span>
                        <span class="calendar-label">${escapeHtml(reminder.title)}</span>
                      </button>`;
            }).join('')
          : '<p class="calendar-empty">—</p>'}
      </div>
    `;
  }).join('');
}

function occurrencesInYear(reminder, year) {
  const dates = [];
  if (!reminder.nextDue) return dates;

  if (reminder.intervalUnit === 'once') {
    if (reminder.nextDue.slice(0, 4) === String(year)) dates.push(reminder.nextDue);
    return dates;
  }

  const monthsPerStep = (reminder.intervalUnit === 'month' ? 1 : reminder.intervalUnit === 'quarter' ? 3 : 12)
    * (reminder.intervalCount || 1);
  if (monthsPerStep <= 0) return dates;

  // Jeder Termin wird direkt aus dem Ankerdatum berechnet, nicht schrittweise
  // aufaddiert – sonst würde die Monatsende-Begrenzung das Datum verschieben
  // (31.03. rückwärts auf den 28.02. und vorwärts nur noch auf den 28.03.).
  const [anchorYear, anchorMonth] = reminder.nextDue.split('-').map(Number);
  const anchor = anchorYear * 12 + (anchorMonth - 1);
  const firstMonth = year * 12;
  const lastMonth = year * 12 + 11;

  const steps = Math.ceil((firstMonth - anchor) / monthsPerStep);
  for (let month = anchor + steps * monthsPerStep; month <= lastMonth; month += monthsPerStep) {
    if (month >= firstMonth) dates.push(addInterval(reminder.nextDue, 'month', month - anchor));
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Bearbeiten
// ---------------------------------------------------------------------------

async function handleReminderSubmit(event) {
  event.preventDefault();

  const title = document.getElementById('reminderTitle').value.trim();
  const nextDue = document.getElementById('reminderNextDue').value;
  if (!title || !nextDue) return;

  const amountRaw = document.getElementById('reminderAmount').value;
  const id = document.getElementById('reminderId').value;
  const existing = state.reminders.find((item) => item.id === id);
  const reminder = {
    active: existing ? existing.active : true,
    title,
    note: document.getElementById('reminderNote').value.trim(),
    nextDue,
    intervalUnit: document.getElementById('reminderInterval').value,
    intervalCount: 1,
    leadDays: Number(document.getElementById('reminderLeadDays').value) || 0,
    amount: amountRaw === '' ? null : Number(amountRaw),
    movementType: document.getElementById('reminderMovementType').value,
    wallet: document.getElementById('reminderWallet').value,
    accountCode: reminderElements.account.value,
    percent: '',
    lastDone: existing ? existing.lastDone : ''
  };

  try {
    if (id) {
      const { error } = await supabaseClient.from('reminders').update(reminderToRow(reminder)).eq('id', id);
      if (error) throw error;
      state.reminders = state.reminders.map((item) => item.id === id ? { ...reminder, id } : item);
    } else {
      const { data, error } = await supabaseClient.from('reminders').insert(reminderToRow(reminder)).select().single();
      if (error) throw error;
      state.reminders.push(rowToReminder(data));
    }
  } catch (error) {
    reminderElements.status.textContent = 'Termin konnte nicht gespeichert werden. Wurde supabase-setup.sql erneut ausgeführt?';
    return;
  }

  resetReminderForm();
  renderCalendar();
  showToast(id ? 'Termin aktualisiert ✓' : 'Termin gespeichert ✓');
}

async function handleReminderAction(event) {
  const button = event.target.closest('button[data-reminder-action]');
  if (!button) return;

  const reminder = state.reminders.find((item) => item.id === button.dataset.id);
  if (!reminder) return;
  const action = button.dataset.reminderAction;

  if (action === 'edit') {
    populateReminderForm(reminder);
    activateTab('calendar');
    document.getElementById('reminderTitle').focus();
    return;
  }

  if (action === 'delete') {
    if (!window.confirm(`Termin „${reminder.title}" wirklich löschen?`)) return;
    try {
      const { error } = await supabaseClient.from('reminders').delete().eq('id', reminder.id);
      if (error) throw error;
    } catch (error) {
      reminderElements.status.textContent = 'Termin konnte nicht gelöscht werden.';
      return;
    }
    state.reminders = state.reminders.filter((item) => item.id !== reminder.id);
    if (document.getElementById('reminderId').value === reminder.id) resetReminderForm();
    renderCalendar();
    return;
  }

  if (action === 'book') {
    prefillBookingFromReminder(reminder);
    return;
  }

  if (action === 'done') {
    await completeReminder(reminder);
  }
}

// Übernimmt die Eckdaten ins Buchungsformular; gebucht wird erst nach dem Speichern.
function prefillBookingFromReminder(reminder) {
  resetBookingForm();
  document.getElementById('date').value = reminder.nextDue;
  document.getElementById('booked').value = reminder.nextDue;
  document.getElementById('movementType').value = reminder.movementType || 'expense';
  document.getElementById('wallet').value = reminder.wallet || 'bank';
  document.getElementById('description').value = reminder.title;
  if (reminder.amount != null) document.getElementById('amount').value = reminder.amount;
  if (reminder.accountCode) {
    accountSelect.value = reminder.accountCode;
    applyAccountTaxToForm();
  }
  recalcTax();

  pendingReminderId = reminder.id;
  activateTab('newBooking');
  showToast('Buchung vorbereitet – bitte prüfen und speichern.');
}

// Rückt den Termin auf den nächsten Turnus vor; einmalige Termine werden abgehakt.
async function completeReminder(reminder, silent = false) {
  const today = todayIso();
  const update = { last_done: today };

  if (reminder.intervalUnit === 'once') {
    update.active = false;
  } else {
    let next = addInterval(reminder.nextDue, reminder.intervalUnit, reminder.intervalCount);
    let guard = 0;
    // Bei lange liegengebliebenen Terminen so weit vorrücken, bis das Datum in der Zukunft liegt.
    while (next <= today && guard++ < 400) {
      next = addInterval(next, reminder.intervalUnit, reminder.intervalCount);
    }
    update.next_due = next;
  }

  try {
    const { error } = await supabaseClient.from('reminders').update(update).eq('id', reminder.id);
    if (error) throw error;
  } catch (error) {
    reminderElements.status.textContent = 'Termin konnte nicht fortgeschrieben werden.';
    return;
  }

  reminder.lastDone = today;
  if (update.active === false) reminder.active = false;
  if (update.next_due) reminder.nextDue = update.next_due;

  renderCalendar();
  if (!silent) {
    showToast(reminder.active ? `Nächster Termin: ${reminder.nextDue}` : 'Termin abgeschlossen ✓');
  }
}

function populateReminderForm(reminder) {
  document.getElementById('reminderId').value = reminder.id;
  document.getElementById('reminderTitle').value = reminder.title;
  document.getElementById('reminderNextDue').value = reminder.nextDue;
  document.getElementById('reminderInterval').value = reminder.intervalUnit;
  document.getElementById('reminderLeadDays').value = reminder.leadDays;
  document.getElementById('reminderAmount').value = reminder.amount == null ? '' : reminder.amount;
  document.getElementById('reminderMovementType').value = reminder.movementType || 'expense';
  document.getElementById('reminderWallet').value = reminder.wallet || 'bank';
  document.getElementById('reminderNote').value = reminder.note || '';
  renderReminderAccountSelect();
  reminderElements.account.value = reminder.accountCode || '';
  document.getElementById('reminderSubmit').textContent = 'Änderungen speichern';
}

function resetReminderForm() {
  reminderElements.form.reset();
  document.getElementById('reminderId').value = '';
  document.getElementById('reminderNextDue').value = todayIso();
  document.getElementById('reminderInterval').value = 'year';
  document.getElementById('reminderLeadDays').value = '14';
  document.getElementById('reminderMovementType').value = 'expense';
  document.getElementById('reminderWallet').value = 'bank';
  renderReminderAccountSelect();
  document.getElementById('reminderSubmit').textContent = 'Termin speichern';
}
