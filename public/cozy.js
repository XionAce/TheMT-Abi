'use strict';

(() => {
  const el = (id) => document.getElementById(id);
  const durations = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
  const freshTimer = (mode) => ({ mode, remaining: durations[mode] * 1000, endsAt: null });
  const defaults = () => ({
    timer: freshTimer('focus'),
    intentions: [],
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
    const message = s.timer.mode === 'focus' ? 'Focus session complete.' : 'Break complete.';
    s.timer = freshTimer(s.timer.mode);
    return message;
  }
  async function change(action) {
    try {
      const message = await storageService.update('cozy', defaults, (s) => {
        const completion = settle(s);
        action(s);
        return completion;
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
  function render() {
    clock();
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
      const empty = create('li', 'No intentions yet.');
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
      } else t.endsAt = Date.now() + t.remaining;
    });
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
