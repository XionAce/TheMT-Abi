'use strict';

(() => {
  const el = (id) => document.getElementById(id);
  const durations = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
  const freshTimer = (mode) => ({ mode, remaining: durations[mode] * 1000, endsAt: null });
  const defaults = () => ({
    timer: freshTimer('focus'),
    intentions: [],
    sessions: [],
  });
  let state = defaults();
  let readVersion = 0;
  let settling = false;
  let retrySettlementAfter = 0;
  let statusTimeout;
  const status = (message) => {
    el('cozy-status').textContent = message;
    clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => {
      el('cozy-status').textContent = '';
    }, 5500);
  };
  function settle(s) {
    if (!s.timer.endsAt || s.timer.endsAt > Date.now()) return;
    const timer = s.timer;
    let message = 'Break complete.';
    if (timer.mode === 'focus') {
      const sessions = s.sessions ??= [];
      const id = timer.sessionId || 'legacy-' + timer.endsAt;
      if (!sessions.some(session => session.id === id)) {
        sessions.push({
          id, completedAt: timer.endsAt, minutes: durations.focus / 60,
          eventId: timer.eventId ?? null, title: timer.title || 'Independent focus',
        });
      }
      message = '25 minutes logged. A new flower is growing in your garden.';
    }
    s.timer = freshTimer(timer.mode);
    return message;
  }
  async function change(action) {
    try {
      const message = await storageService.update('cozy', defaults, (s) => {
        const completion = settle(s);
        const notice = action(s);
        return notice || completion;
      });
      if (message) status(message);
      return true;
    } catch {
      status('This change could not be saved. Please try again.');
      return false;
    }
  }
  function clock() {
    const t = state.timer;
    const ms = t.endsAt === null ? t.remaining : Math.max(0, t.endsAt - Date.now());
    const seconds = Math.ceil(ms / 1000);
    el('clock-face').textContent =
      Math.floor(seconds / 60)
        .toString()
        .padStart(2, '0') +
      ':' +
      (seconds % 60).toString().padStart(2, '0');
    document
      .querySelector('.dial')
      .style.setProperty('--progress', (ms / (durations[t.mode] * 1000)) * 360 + 'deg');
    el('start-pause').textContent = t.endsAt ? 'Pause' : 'Start';
    for (const b of document.querySelectorAll('[data-mode]'))
      b.setAttribute('aria-pressed', String(b.dataset.mode === t.mode));
    if (t.endsAt && ms === 0 && !settling && Date.now() >= retrySettlementAfter) {
      settling = true;
      change(() => {}).then((saved) => {
        retrySettlementAfter = saved ? 0 : Date.now() + 60000;
        settling = false;
      });
    }
  }
  const create = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const burst = create('span');
    burst.className = 'confetti';
    burst.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 12; i++) {
      const bit = create('i');
      bit.style.setProperty('--angle', i * 30 + 'deg');
      burst.append(bit);
    }
    el('intention-card').append(burst);
    setTimeout(() => burst.remove(), 800);
  }
  function showWeek() {
    const now = new Date();
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    const week = (state.sessions || []).filter(s => s.completedAt >= monday && s.completedAt <= now);
    const minutes = week.reduce((sum, session) => sum + session.minutes, 0);
    el('study-week').textContent = 'Study this week · ' + minutes + ' min · ' + week.length +
      (week.length === 1 ? ' session' : ' sessions');
  }
  function render() {
    clock();
    showWeek();
    el('study-week').hidden = false;
    el('focus-subject').hidden = !state.timer.title;
    el('focus-subject').textContent = state.timer.title || '';
    const items = state.intentions.map((item) => {
      const row = create('li');
      const label = create('label');
      const check = create('input');
      check.type = 'checkbox';
      check.checked = item.done;
      check.onchange = async () => {
        const done = check.checked;
        const saved = await change((s) => {
          const intention = s.intentions.find((v) => v.id === item.id);
          if (intention) intention.done = done;
        });
        if (done && saved) confetti();
      };
      label.append(check, create('span', item.text));
      const remove = create('button', '×');
      remove.type = 'button';
      remove.className = 'soft-btn';
      remove.setAttribute('aria-label', 'Remove ' + item.text);
      remove.onclick = () => change((s) => {
        s.intentions = s.intentions.filter((v) => v.id !== item.id);
      });
      row.append(label, remove);
      return row;
    });
    if (!items.length) {
      const empty = create('li', 'Start small. Add one thing you’d like to finish this session.');
      empty.className = 'list-empty';
      items.push(empty);
    }
    el('intentions').replaceChildren(...items);
  }
  async function sync() {
    const version = ++readVersion;
    try {
      const saved = await storageService.get('cozy');
      if (version !== readVersion) return;
      state = saved ?? defaults();
      render();
    } catch {
      status('Your saved space could not be read.');
    }
  }
  storageService.subscribe((key) => {
    if (key === 'cozy' || key === '*') sync();
  });
  for (const b of document.querySelectorAll('[data-mode]'))
    b.onclick = () =>
      change((s) => {
        if (s.timer.mode !== b.dataset.mode) s.timer = freshTimer(b.dataset.mode);
      });
  el('start-pause').onclick = () =>
    change((s) => {
      const t = s.timer;
      if (t.endsAt) {
        t.remaining = Math.max(0, t.endsAt - Date.now());
        t.endsAt = null;
      } else {
        if (t.mode === 'focus') t.sessionId ??= crypto.randomUUID();
        t.endsAt = Date.now() + t.remaining;
      }
    });
  el('planner-page').addEventListener('click', async event => {
    const launch = event.target.closest('[data-focus-event]');
    if (!launch) return;
    const saved = await change(s => {
      const t = s.timer;
      const inProgress = t.endsAt || t.remaining < durations[t.mode] * 1000;
      if (inProgress && t.eventId !== launch.dataset.focusEvent) {
        return 'Another timer is in progress. Finish or reset it before starting this task.';
      }
      if (!inProgress) s.timer = freshTimer('focus');
      s.timer.sessionId ??= crypto.randomUUID();
      s.timer.eventId = launch.dataset.focusEvent;
      s.timer.title = launch.dataset.focusTitle;
      s.timer.endsAt ??= Date.now() + s.timer.remaining;
    });
    if (saved) location.hash = 'focus';
  });
  setInterval(() => {
    if (!document.hidden && !el('home-page').hidden && !el('study-week').hidden) showWeek();
  }, 60000);
  el('timer-reset').onclick = () =>
    change((s) => {
      s.timer = freshTimer(s.timer.mode);
    });
  el('intention-form').onsubmit = async (e) => {
    e.preventDefault();
    const input = el('intention');
    const text = input.value.trim();
    if (!text) return;
    const saved = await change((s) => {
      s.intentions.unshift({ id: crypto.randomUUID(), text, done: false });
    });
    if (saved) input.value = '';
  };
  setInterval(() => {
    if (state.timer.endsAt) clock();
  }, 500);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sync();
  });
  sync();
})();
