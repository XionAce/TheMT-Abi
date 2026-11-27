'use strict';

const byId = id => document.getElementById(id);
const kinds = ['Class', 'Exam', 'Study'];
const events = new Map();
const editor = byId('editor');
const form = byId('entry');
let selected = makeDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
let calendarView = 'month';
let editingId = null;
let editingDay = null;
let confirmDelete = false;
let scheduleRead = 0;
let scheduleState = 'loading';

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

function validDay(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) &&
    key >= '0001-01-01' && dateKey(parseDate(key)) === key;
}

function addDays(date, days) {
  return makeDate(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function validWeekly(rule) {
  return rule && Array.isArray(rule.days) && rule.days.length > 0 && rule.days.length <= 7 &&
    new Set(rule.days).size === rule.days.length &&
    rule.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6);
}

function occursOn(item, date, key) {
  if (!item.weekly) return item.date === key;
  return key >= item.date && (!item.weekly.until || key <= item.weekly.until) &&
    item.weekly.days.includes(date.getDay());
}

function nextOccurrence(item, now) {
  const today = dateKey(now);
  const time = now.toTimeString().slice(0, 5);
  if (!item.weekly) {
    return item.date > today || (item.date === today && (!item.time || item.time >= time)) ? item : null;
  }
  const start = parseDate(item.date > today ? item.date : today);
  for (let i = 0; i <= 7; i++) {
    const date = addDays(start, i), key = dateKey(date);
    if (date.getFullYear() > 9999 || (item.weekly.until && key > item.weekly.until)) break;
    if (occursOn(item, date, key) && !(key === today && item.time && item.time < time)) return {...item, date:key};
  }
  return null;
}

function validEvent(item) {
  return item && typeof item.title === 'string' && item.title.trim() &&
    kinds.includes(item.kind) && validDay(item.date) &&
    (item.weekly == null || (item.kind === 'Class' && validWeekly(item.weekly) &&
      (item.weekly.until === '' || (validDay(item.weekly.until) && item.weekly.until >= item.date)))) &&
    (item.time === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) && typeof item.notes === 'string';
}

async function loadEvents() {
  const version = ++scheduleRead;
  try {
    const stored = await storageService.listEvents();
    if (version !== scheduleRead) return;
    byId('storage-note').textContent = storageService.cloudEnabled() ? 'Your planner is saved to your account.' : 'Events are saved in this browser.';
    scheduleState = 'ready';
    events.clear();
    for (const [id,item] of stored) if (validEvent(item)) events.set(id,item);
  } catch {
    if (version !== scheduleRead) return;
    scheduleState = 'error';
    byId('storage-note').textContent = storageService.cloudEnabled() ? 'Unable to load your cloud planner. Check your connection and account.' : 'Browser storage is unavailable.';
  }
  displaySchedule();
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
  row.append(element('small', '', item.kind + (item.weekly ? ' · Weekly' : '') + ' · ' + eventTime(item)), element('b', '', item.title));
  row.setAttribute('aria-label', 'Edit ' + item.title + ', ' + eventTime(item));
  row.addEventListener('click', () => openEditor(id, item.date));
  const focus = element('button', 'soft-btn', 'Focus');
  focus.type = 'button';
  focus.dataset.focusEvent = id;
  focus.dataset.focusTitle = item.title;
  focus.setAttribute('aria-label', 'Start focus for ' + item.title);
  const group = element('div', 'planner-focus-row');
  group.append(row, focus);
  return group;
}

function countdown(item, now) {
  const start = parseDate(item.date);
  if (!item.time) {
    const todayAtNoon = makeDate(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((start - todayAtNoon) / 86400000);
    return days ? 'in ' + days + (days === 1 ? ' day' : ' days') : 'Today';
  }
  const [hours, minutes] = item.time.split(':').map(Number);
  start.setHours(hours, minutes, 0, 0);
  const left = Math.ceil((start - now) / 60000);
  if (left <= 0) return 'Now';
  if (left < 60) return 'in ' + left + ' min';
  const totalHours = Math.floor(left / 60);
  if (totalHours < 24) return 'in ' + totalHours + ' hr' + (left % 60 ? ' ' + left % 60 + ' min' : '');
  const days = Math.floor(totalHours / 24);
  return 'in ' + days + (days === 1 ? ' day' : ' days') + (totalHours % 24 ? ' ' + totalHours % 24 + ' hr' : '');
}

function updateUpcoming(now) {
  const day = dateKey(now);
  const upcoming = [...events.values()].map(item => nextOccurrence(item, now)).filter(Boolean)
    .sort((a,b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
  const exams = upcoming.filter(item => item.kind === 'Exam');
  byId('exam-panel').hidden = !exams.length || scheduleState !== 'ready';
  byId('exam-countdowns').replaceChildren(...exams.map(exam => {
    const row = element('li');
    row.append(element('strong', '', exam.title), element('span', '',
      format(parseDate(exam.date), {month:'short',day:'numeric'}) + ' · ' + eventTime(exam) + ' · ' + countdown(exam, now)));
    return row;
  }));
  const next = upcoming[0];
  const link = byId('home-today'), label = byId('home-schedule');
  link.dataset.date = next?.date || day;
  link.dataset.action = scheduleState === 'ready' && !next ? 'add' : 'view';
  label.setAttribute('aria-busy', String(scheduleState === 'loading'));
  if (scheduleState === 'loading') label.textContent = 'Loading upcoming events…';
  else if (scheduleState === 'error') label.textContent = 'Couldn’t load your schedule. Open Planner.';
  else if (!next) label.textContent = events.size ? 'You’re all caught up. Add an event' : 'Nothing scheduled yet. Add your first event';
  else label.textContent = [next.title, format(parseDate(next.date), {month:'short', day:'numeric'}), eventTime(next), countdown(next, now)].join(' · ');
}

function displaySchedule() {
  const today = new Date();
  const monthStart = makeDate(selected.getFullYear(), selected.getMonth(), 1);
  const monthEnd = makeDate(selected.getFullYear(), selected.getMonth() + 1, 0);
  const monthKey = dateKey(selected).slice(0, 7);
  const selectedKey = dateKey(selected);
  const week = calendarView === 'week';
  const anchor = week ? selected : monthStart;
  const offset = (anchor.getDay() + 6) % 7;
  const first = addDays(anchor, -offset);
  const cellCount = week ? 7 : Math.ceil((offset + monthEnd.getDate()) / 7) * 7;
  const grouped = new Map();
  byId('date-line').textContent = format(today, {weekday:'long', month:'long', day:'numeric', year:'numeric'});
  updateUpcoming(today);
  byId('desk-date').textContent = format(today, {weekday:'long', month:'long', day:'numeric'});
  byId('desk-date').dateTime = dateKey(today);
  byId('icon-day').textContent = today.getDate();
  const last = addDays(first, cellCount - 1);
  const rangeFormat = new Intl.DateTimeFormat('en-US', {month:'short',day:'numeric',year:'numeric'});
  byId('month').textContent = week ? rangeFormat.formatRange(first, last)
    : format(monthStart, {month:'long', year:'numeric'});
  byId('previous').disabled = week ? dateKey(first) <= '0001-01-01' : monthKey === '0001-01';
  byId('next').disabled = week ? last.getFullYear() > 9999 || dateKey(last) === '9999-12-31' : monthKey === '9999-12';
  for (const [id,label] of [['previous','Previous'],['next','Next']]) {
    byId(id).setAttribute('aria-label', label + (week ? ' week' : ' month'));
  }
  byId('month-panel').hidden = calendarView === 'agenda';
  byId('agenda').hidden = calendarView === 'month';
  for (const [id,view] of [['month-view','month'],['week-view','week'],['list-view','agenda']]) {
    byId(id).setAttribute('aria-pressed', String(calendarView === view));
  }
  const days = document.createDocumentFragment();
  for (let i = 0; i < cellCount; i++) {
    const date = addDays(first, i);
    const key = dateKey(date);
    const daily = validDay(key) ? [...events].filter(([, item]) => occursOn(item, date, key))
      .map(([id,item]) => [id, item.weekly ? {...item, date:key} : item])
      .sort(([,a],[,b]) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title)) : [];
    if (daily.length) grouped.set(key, daily);
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
    if (!week && !key.startsWith(monthKey + '-')) continue;
    agenda.append(element('h3', '', format(parseDate(key), {weekday:'long', month:'short', day:'numeric'})));
    agenda.append(...daily.map(eventRow));
  }
  if (!agenda.childNodes.length) agenda.append(element('p', 'empty', week ? 'No events this week.' : 'No events this month.'));
  byId('agenda').replaceChildren(agenda);
  const daily = grouped.get(selectedKey) || [];
  byId('day-number').textContent = String(selected.getDate()).padStart(2, '0');
  byId('day-heading').textContent = format(selected, {weekday:'long'}) + ' · ' + format(selected, {month:'long'});
  byId('count').textContent = String(daily.length);
  byId('day-events').replaceChildren(...(daily.length ? daily.map(eventRow) : [element('p', 'empty', 'Nothing scheduled for this day.')]));
}

function changePeriod(delta) {
  if (calendarView === 'week') {
    const date = addDays(selected, 7 * delta);
    selected = date.getFullYear() < 1 ? parseDate('0001-01-01') :
      date.getFullYear() > 9999 ? parseDate('9999-12-31') : date;
    displaySchedule();
    return;
  }
  const lastDay = makeDate(selected.getFullYear(), selected.getMonth() + delta + 1, 0);
  selected = makeDate(lastDay.getFullYear(), lastDay.getMonth(), Math.min(selected.getDate(), lastDay.getDate()));
  displaySchedule();
}

const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
for (const day of [1,2,3,4,5,6,0]) {
  const label = element('label');
  const check = element('input');
  check.type = 'checkbox';
  check.value = day;
  label.append(check, weekdays[day]);
  byId('class-days').append(label);
}

function updateClassOptions() {
  const isClass = byId('kind').value === 'Class';
  const weekly = isClass && byId('repeat-class').checked;
  byId('class-options').hidden = !isClass;
  byId('class-rule').hidden = byId('class-rule').disabled = !weekly;
  byId('repeat-until').min = byId('when').value;
  if (weekly && byId('when').value && !byId('class-days').querySelector(':checked')) {
    byId('class-days').querySelector('[value="' + parseDate(byId('when').value).getDay() + '"]').checked = true;
  }
}
for (const id of ['kind','repeat-class','when']) byId(id).addEventListener('change', updateClassOptions);

function openEditor(id = null, occurrenceDay = null) {
  editingId = id;
  editingDay = occurrenceDay;
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
  byId('repeat-class').checked = Boolean(item?.weekly);
  for (const input of byId('class-days').querySelectorAll('input')) input.checked = item?.weekly?.days.includes(Number(input.value)) || false;
  byId('repeat-until').value = item?.weekly?.until || '';
  byId('series-note').hidden = !item?.weekly;
  updateClassOptions();
  byId('delete').hidden = !item;
  byId('delete').textContent = item?.weekly ? 'Delete series' : 'Delete event';
  byId('editor-title').textContent = item ? 'Edit event' : 'Add event';
  editor.showModal();
  byId('title').focus();
}

function storageError() {
  byId('error').textContent = 'Couldn’t save this change. Check your storage or connection and try again.';
  byId('error').hidden = false;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const item = {title:byId('title').value.trim(), kind:byId('kind').value, date:byId('when').value, time:byId('time').value, notes:byId('notes').value.trim()};
  let savedDay = item.date;
  if (!item.title) {
    byId('title').setCustomValidity('Enter an event name.');
    byId('title').reportValidity();
    return;
  }
  if (item.kind === 'Class' && byId('repeat-class').checked) {
    const days = [...byId('class-days').querySelectorAll(':checked')].map(input => Number(input.value));
    item.weekly = {days, until:byId('repeat-until').value};
    const start = parseDate(item.date);
    start.setHours(0,0,0,0);
    const first = nextOccurrence(item, start);
    if (!days.length || !first) {
      byId('error').textContent = 'Choose a class day within the schedule dates.';
      byId('error').hidden = false;
      return;
    }
    savedDay = editingDay && occursOn(item, parseDate(editingDay), editingDay) ? editingDay : first.date;
  }
  if (!validEvent(item)) return;
  const id = editingId || crypto.randomUUID();
  try {
    await storageService.saveEvent(id,item);
  } catch { storageError(); return; }
  events.set(id, item);
  selected = parseDate(savedDay);
  editor.close();
  displaySchedule();
  byId('feedback').textContent = 'Saved ' + item.title;
});

byId('delete').addEventListener('click', async () => {
  if (!confirmDelete) {
    confirmDelete = true;
    byId('delete').textContent = events.get(editingId)?.weekly ? 'Confirm delete series' : 'Confirm delete';
    return;
  }
  try { await storageService.deleteEvent(editingId); } catch { storageError(); return; }
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
byId('previous').addEventListener('click', () => changePeriod(-1));
byId('next').addEventListener('click', () => changePeriod(1));
byId('today').addEventListener('click', () => { selected = parseDate(dateKey(new Date())); displaySchedule(); });
for (const [id,view] of [['month-view','month'],['week-view','week'],['list-view','agenda']]) {
  byId(id).onclick = () => { calendarView = view; displaySchedule(); };
}
byId('add-event').addEventListener('click', () => openEditor());
byId('add-to-day').addEventListener('click', () => openEditor());
byId('close').addEventListener('click', () => editor.close());
byId('title').addEventListener('input', () => byId('title').setCustomValidity(''));

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  byId('theme').setAttribute('aria-pressed', String(theme === 'dark'));
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#201a1c' : '#f7f4fa';
}
async function restoreTheme() {
  let value;
  try { value = await storageService.get('theme'); } catch { /* Use device appearance. */ }
  setTheme(['light','dark'].includes(value) ? value : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
byId('theme').addEventListener('click', async () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(theme);
  try { await storageService.set('theme',theme); } catch { /* Keep the choice for this visit. */ }
});
storageService.subscribe(key => {
  if (key === 'events' || key === '*') loadEvents();
  if (key === 'theme' || key === '*') restoreTheme();
});
byId('home-today').addEventListener('click', event => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  if (event.currentTarget.dataset.action === 'add') {
    window.addEventListener('hashchange', () => {
      if (location.hash === '#planner') openEditor();
    }, {once:true});
  }
  selected = parseDate(byId('home-today').dataset.date || dateKey(new Date()));
  displaySchedule();
});
window.addEventListener('focus', () => {
  if (editor.open) return;
  if (storageService.cloudEnabled()) loadEvents();
  else displaySchedule();
});
function refreshHomeCountdown() {
  if (!document.hidden) updateUpcoming(new Date());
}
window.addEventListener('hashchange', refreshHomeCountdown);
document.addEventListener('visibilitychange', refreshHomeCountdown);
setInterval(refreshHomeCountdown, 30000);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', restoreTheme);
restoreTheme();
loadEvents();
