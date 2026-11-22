'use strict';

const byId = id => document.getElementById(id);
const eventPrefix = 'themt-abi.event.';
const themeKey = 'themt-abi.theme';
const kinds = ['Class', 'Exam', 'Study'];
const events = new Map();
const editor = byId('editor');
const form = byId('entry');
let selected = makeDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
let agendaView = false;
let editingId = null;
let confirmDelete = false;

function makeDate(year, month, day) {
  const date = new Date(2000, 0, 1, 12);
  date.setFullYear(year, month, day);
  return date;
}

function dateKey(date) {
  return [String(date.getFullYear()).padStart(4, '0'), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function parseDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return makeDate(year, month - 1, day);
}

function format(date, options) {
  return date.toLocaleDateString('en-US', options);
}

function validEvent(item) {
  return item && typeof item.title === 'string' && item.title.trim() &&
    kinds.includes(item.kind) && /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
    dateKey(parseDate(item.date)) === item.date && item.date >= '0001-01-01' &&
    (item.time === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) && typeof item.notes === 'string';
}

function loadEvents() {
  events.clear();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(eventPrefix)) continue;
      try {
        const item = JSON.parse(localStorage.getItem(key));
        if (validEvent(item)) events.set(key.slice(eventPrefix.length), item);
      } catch { /* Ignore an unreadable entry so the other dates still open. */ }
    }
  } catch {
    byId('storage-note').textContent = 'Browser storage is unavailable. Enable it to save events.';
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function eventTime(event) {
  if (!event.time) return 'All day';
  const [hours, minutes] = event.time.split(':').map(Number);
  return (hours % 12 || 12) + ':' + String(minutes).padStart(2, '0') + (hours < 12 ? ' AM' : ' PM');
}

function eventRow([id, item]) {
  const row = element('button', 'event-row');
  row.type = 'button';
  row.dataset.kind = item.kind;
  row.append(element('small', '', item.kind + ' · ' + eventTime(item)), element('b', '', item.title));
  row.setAttribute('aria-label', 'Edit ' + item.title + ', ' + eventTime(item));
  row.addEventListener('click', () => openEditor(id));
  return row;
}

function displaySchedule() {
  const today = new Date();
  const monthStart = makeDate(selected.getFullYear(), selected.getMonth(), 1);
  const monthEnd = makeDate(selected.getFullYear(), selected.getMonth() + 1, 0);
  const monthKey = dateKey(selected).slice(0, 7);
  const selectedKey = dateKey(selected);
  const sorted = [...events].sort(([, a], [, b]) =>
    a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
  const grouped = new Map();
  for (const entry of sorted) {
    const date = entry[1].date;
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push(entry);
  }
  byId('date-line').textContent = format(today, {weekday:'long', month:'long', day:'numeric', year:'numeric'});
  byId('month').textContent = format(monthStart, {month:'long', year:'numeric'});
  byId('previous').disabled = monthKey === '0001-01';
  byId('next').disabled = monthKey === '9999-12';
  byId('month-panel').hidden = agendaView;
  byId('agenda').hidden = !agendaView;
  byId('month-view').setAttribute('aria-pressed', String(!agendaView));
  byId('list-view').setAttribute('aria-pressed', String(agendaView));

  const offset = (monthStart.getDay() + 6) % 7;
  const cellCount = Math.ceil((offset + monthEnd.getDate()) / 7) * 7;
  const days = document.createDocumentFragment();
  for (let i = 0; i < cellCount; i++) {
    const date = makeDate(selected.getFullYear(), selected.getMonth(), 1 - offset + i);
    const key = dateKey(date);
    const daily = grouped.get(key) || [];
    const day = element('button', 'cell');
    day.type = 'button';
    day.dataset.date = key;
    day.disabled = date.getFullYear() < 1 || date.getFullYear() > 9999;
    day.classList.toggle('other', date.getMonth() !== selected.getMonth());
    day.classList.toggle('chosen', key === selectedKey);
    day.classList.toggle('current', key === dateKey(today));
    day.setAttribute('aria-pressed', String(key === selectedKey));
    if (key === dateKey(today)) day.setAttribute('aria-current', 'date');
    day.setAttribute('aria-label', format(date,{dateStyle:'full'}) + ', ' + daily.length + ' events');
    day.append(element('span', 'number', date.getDate()));
    for (const [, item] of daily.slice(0, 2)) {
      const chip = element('span', 'entry-chip', item.title);
      chip.dataset.kind = item.kind;
      day.append(chip);
    }
    if (daily.length > 2) day.append(element('span', 'extra', '+' + (daily.length - 2)));
    days.append(day);
  }
  byId('days').replaceChildren(days);

  const agenda = document.createDocumentFragment();
  for (const [key, daily] of grouped) {
    if (!key.startsWith(monthKey + '-')) continue;
    agenda.append(element('h3', '', format(parseDate(key), {weekday:'long', month:'short', day:'numeric'})));
    agenda.append(...daily.map(eventRow));
  }
  if (!agenda.childNodes.length) agenda.append(element('p', 'empty', 'No events this month.'));
  byId('agenda').replaceChildren(agenda);
  const daily = grouped.get(selectedKey) || [];
  byId('day-number').textContent = String(selected.getDate()).padStart(2, '0');
  byId('day-heading').textContent = format(selected, {weekday:'long'}) + ' · ' + format(selected, {month:'long'});
  byId('count').textContent = String(daily.length);
  byId('day-events').replaceChildren(...(daily.length ? daily.map(eventRow) : [element('p', 'empty', 'Nothing scheduled for this day.')]));
}

function changeMonth(delta) {
  const lastDay = makeDate(selected.getFullYear(), selected.getMonth() + delta + 1, 0);
  selected = makeDate(lastDay.getFullYear(), lastDay.getMonth(), Math.min(selected.getDate(), lastDay.getDate()));
  displaySchedule();
}

function openEditor(id = null) {
  editingId = id;
  confirmDelete = false;
  const item = events.get(id);
  form.reset();
  byId('error').hidden = true;
  byId('title').setCustomValidity('');
  byId('title').value = item?.title || '';
  byId('kind').value = item?.kind || 'Class';
  byId('when').value = item?.date || dateKey(selected);
  byId('time').value = item?.time || '';
  byId('notes').value = item?.notes || '';
  byId('delete').hidden = !item;
  byId('delete').textContent = 'Delete event';
  byId('editor-title').textContent = item ? 'Edit event' : 'Add event';
  editor.showModal();
  byId('title').focus();
}

function storageError() {
  byId('error').textContent = 'Your browser couldn’t save this change. Check available storage and try again.';
  byId('error').hidden = false;
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const item = {title:byId('title').value.trim(), kind:byId('kind').value, date:byId('when').value, time:byId('time').value, notes:byId('notes').value.trim()};
  if (!item.title) {
    byId('title').setCustomValidity('Enter an event name.');
    byId('title').reportValidity();
    return;
  }
  if (!validEvent(item)) return;
  const id = editingId || crypto.randomUUID();
  try {
    localStorage.setItem(eventPrefix + id, JSON.stringify(item));
  } catch { storageError(); return; }
  events.set(id, item);
  selected = parseDate(item.date);
  editor.close();
  displaySchedule();
  byId('feedback').textContent = 'Saved ' + item.title;
});

byId('delete').addEventListener('click', () => {
  if (!confirmDelete) {
    confirmDelete = true;
    byId('delete').textContent = 'Confirm delete';
    return;
  }
  try { localStorage.removeItem(eventPrefix + editingId); } catch { storageError(); return; }
  events.delete(editingId);
  editor.close();
  displaySchedule();
  byId('feedback').textContent = 'Event deleted.';
});

byId('days').addEventListener('click', event => {
  const cell = event.target.closest('button[data-date]');
  if (!cell || cell.disabled) return;
  selected = parseDate(cell.dataset.date);
  displaySchedule();
  byId('days').querySelector('.chosen').focus({preventScroll:true});
});
byId('previous').addEventListener('click', () => changeMonth(-1));
byId('next').addEventListener('click', () => changeMonth(1));
byId('today').addEventListener('click', () => { selected = parseDate(dateKey(new Date())); displaySchedule(); });
byId('month-view').addEventListener('click', () => { agendaView = false; displaySchedule(); });
byId('list-view').addEventListener('click', () => { agendaView = true; displaySchedule(); });
byId('add-event').addEventListener('click', () => openEditor());
byId('add-to-day').addEventListener('click', () => openEditor());
byId('close').addEventListener('click', () => editor.close());
byId('title').addEventListener('input', () => byId('title').setCustomValidity(''));

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const nextLabel = theme === 'dark' ? 'Light mode' : 'Dark mode';
  byId('theme-label').textContent = nextLabel;
  byId('theme').setAttribute('aria-label', 'Switch to ' + nextLabel.toLowerCase());
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#201a1c' : '#f7f4fa';
}
function restoreTheme() {
  let value;
  try { value = localStorage.getItem(themeKey); } catch { /* Use device appearance. */ }
  setTheme(['light','dark'].includes(value) ? value : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
byId('theme').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(theme);
  try { localStorage.setItem(themeKey, theme); } catch { /* Keep the choice for this visit. */ }
});
window.addEventListener('storage', event => {
  if (!event.key || event.key.startsWith(eventPrefix)) { loadEvents(); displaySchedule(); }
  if (!event.key || event.key === themeKey) restoreTheme();
});
window.addEventListener('focus', () => { if (!editor.open) displaySchedule(); });
restoreTheme();
loadEvents();
displaySchedule();
