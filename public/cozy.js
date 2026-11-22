'use strict';

(() => {
  const el = (id) => document.getElementById(id);
  const durations = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
  const freshTimer = (mode) => ({ mode, remaining: durations[mode] * 1000, endsAt: null });
  const defaults = () => ({
    timer: freshTimer('focus'),
    stars: 0,
    intentions: [],
    pins: [],
    history: [],
    coupons: [
      { id: 'coffee', name: '1 Iced Coffee Delivery', cost: 3 },
      { id: 'movie', name: 'Movie Night Pick', cost: 5 },
      { id: 'food', name: 'Food Craving Run', cost: 7 },
    ],
  });
  let state = defaults();
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
    if (!s.timer.endsAt || s.timer.endsAt > Date.now()) return false;
    if (s.timer.mode === 'focus') {
      s.stars++;
      status('Focus session complete. One star added to your jar.');
    } else status('Break complete.');
    s.timer = freshTimer(s.timer.mode);
    return true;
  }
  async function change(action) {
    try {
      await storageService.update('cozy', defaults, (s) => {
        settle(s);
        action(s);
      });
      return true;
    } catch (error) {
      status(
        error.message === 'More stars needed.'
          ? error.message
          : 'This change could not be saved in this browser.',
      );
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
  function button(text, handler, name) {
    const b = create('button', text);
    b.type = 'button';
    b.className = 'soft-btn';
    if (name) b.setAttribute('aria-label', name);
    b.onclick = handler;
    return b;
  }
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
  function list(id, rows, make, empty) {
    const content = rows.map(make);
    if (!content.length) {
      const li = create('li', empty);
      li.className = 'list-empty';
      content.push(li);
    }
    el(id).replaceChildren(...content);
  }
  function render() {
    clock();
    el('balance').textContent = state.stars + (state.stars === 1 ? ' star' : ' stars');
    list(
      'intentions',
      state.intentions,
      (item) => {
        const row = create('li'),
          label = create('label'),
          check = create('input');
        check.type = 'checkbox';
        check.checked = item.done;
        check.onchange = async () => {
          const done = check.checked;
          if (
            (await change((s) => {
              const t = s.intentions.find((v) => v.id === item.id);
              if (t) t.done = done;
            })) &&
            done
          )
            confetti();
        };
        label.append(check, create('span', item.text));
        row.append(
          label,
          button(
            '×',
            () =>
              change((s) => {
                s.intentions = s.intentions.filter((v) => v.id !== item.id);
              }),
            'Remove ' + item.text,
          ),
        );
        return row;
      },
      'No intentions yet.',
    );
    list(
      'pins',
      state.pins,
      (item) => {
        const row = create('li');
        row.append(
          create('p', item.text),
          button(
            '×',
            () =>
              change((s) => {
                s.pins = s.pins.filter((v) => v.id !== item.id);
              }),
            'Unpin note',
          ),
        );
        return row;
      },
      'Your first note goes here.',
    );
    list(
      'coupons',
      state.coupons,
      (item) => {
        const row = create('li'),
          info = create('div');
        info.append(create('strong', item.name), create('small', item.cost + ' stars'));
        const edit = button(
          'Edit',
          () => {
            el('coupon-form').closest('details').open = true;
            el('coupon-id').value = item.id;
            el('coupon-name').value = item.name;
            el('coupon-cost').value = item.cost;
            el('coupon-cancel').hidden = false;
            el('coupon-name').focus();
          },
          'Edit ' + item.name,
        );
        const use = button(
          'Redeem',
          () =>
            change((s) => {
              const coupon = s.coupons.find((v) => v.id === item.id);
              if (!coupon || s.stars < coupon.cost) throw new Error('More stars needed.');
              s.stars -= coupon.cost;
              s.history.unshift({
                id: crypto.randomUUID(),
                name: coupon.name,
                cost: coupon.cost,
                at: Date.now(),
              });
              status('Redeemed ' + coupon.name + '.');
            }),
          'Redeem ' + item.name,
        );
        use.disabled = state.stars < item.cost;
        row.append(info, edit, use);
        return row;
      },
      'Add a reward coupon below.',
    );
    list(
      'receipts',
      state.history,
      (item) => {
        const row = create('li'),
          info = create('div');
        info.append(
          create('strong', item.name),
          create('small', new Date(item.at).toLocaleDateString() + ' · ' + item.cost + ' stars'),
        );
        row.append(info);
        return row;
      },
      'Redeemed coupons will appear here.',
    );
  }
  async function sync() {
    try {
      state = (await storageService.get('cozy')) ?? defaults();
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
  el('add-star').onclick = () =>
    change((s) => {
      s.stars++;
    });
  for (const [formId, inputId, key] of [
    ['pin-form', 'pin', 'pins'],
    ['intention-form', 'intention', 'intentions'],
  ]) {
    el(formId).onsubmit = async (e) => {
      e.preventDefault();
      const input = el(inputId),
        text = input.value.trim();
      if (!text) return;
      if (
        await change((s) => {
          s[key].unshift({ id: crypto.randomUUID(), text, done: false });
        })
      )
        input.value = '';
    };
  }
  function clearCoupon() {
    el('coupon-form').reset();
    el('coupon-id').value = '';
    el('coupon-cancel').hidden = true;
  }
  el('coupon-cancel').onclick = clearCoupon;
  el('coupon-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = el('coupon-id').value || crypto.randomUUID();
    const name = el('coupon-name').value.trim(),
      cost = Number(el('coupon-cost').value);
    if (!name || !Number.isInteger(cost) || cost < 1 || cost > 9999) return;
    if (
      await change((s) => {
        const existing = s.coupons.find((v) => v.id === id);
        if (existing) Object.assign(existing, { name, cost });
        else s.coupons.push({ id, name, cost });
      })
    )
      clearCoupon();
  };
  setInterval(() => {
    if (state.timer.endsAt) clock();
  }, 500);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sync();
  });
  sync();
})();
