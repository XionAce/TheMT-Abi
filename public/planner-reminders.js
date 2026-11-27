'use strict';

(() => {
  const button = byId('reminder-toggle');
  const status = byId('reminder-status');
  const supported = window.isSecureContext && 'Notification' in window &&
    'serviceWorker' in navigator && typeof window.ServiceWorkerRegistration?.prototype.showNotification === 'function';
  let enabled = false;
  let checking = false;
  let preference, sentKey;

  function render() {
    const denied = supported && Notification.permission === 'denied';
    button.disabled = !supported || !preference || (denied && !enabled);
    button.textContent = enabled ? 'Disable reminders' : 'Enable reminders';
    button.setAttribute('aria-pressed', String(enabled));
    if (!supported) status.textContent = 'Reminders are unavailable here. On iPhone, try opening AbiVerse from your Home Screen.';
    else if (denied) status.textContent = 'Notifications are blocked. You can allow them in your browser or device settings.';
    else if (enabled && Notification.permission === 'granted') status.textContent = 'Reminders are on for this device.';
    else status.textContent = 'Reminders are off for this device.';
  }

  function dueReminders(records, now) {
    const due = [];
    for (const date of [now, addDays(now, 1)]) {
      const key = dateKey(date);
      for (const [id, item] of records) {
        if (!validEvent(item) || !occursOn(item, date, key)) continue;
        const start = parseDate(key);
        const [hour, minute] = (item.time || '09:00').split(':').map(Number);
        start.setHours(hour, minute, 0, 0);
        const left = start - now;
        if (item.time ? left < 0 || left > 600000 : left > 0 || left <= -60000) continue;
        due.push({item, date:key, tag:[preference,id,key,item.time].join('/')});
      }
    }
    return due;
  }

  async function check() {
    if (!enabled || !supported || checking || Notification.permission !== 'granted') return;
    checking = true;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration?.active) return;
      const due = dueReminders(await storageService.listEvents(), new Date());
      if (!due.length) return;
      async function deliver() {
        if (!await storageService.get(preference)) return;
        const cutoff = Date.now() - 2 * 86400000;
        const sent = (await storageService.get(sentKey) || []).filter(row => row.at >= cutoff);
        for (const {item, date, tag} of due) {
          if (sent.some(row => row.tag === tag)) continue;
          await registration.showNotification(item.title, {
            body:item.kind + ' · ' + (item.time ? 'Starts at ' + eventTime(item) : 'All day today'),
            icon:'/icon-192.png', tag, data:{date},
          });
          sent.push({tag, at:Date.now()});
          await storageService.set(sentKey, sent);
        }
      }
      if (navigator.locks) await navigator.locks.request(sentKey, deliver);
      else await deliver();
    } catch {
      status.textContent = 'Could not check reminders. AbiVerse will try again while open.';
    } finally { checking = false; }
  }

  async function readPreference() {
    enabled = await storageService.get(preference) === true;
    render();
    if (enabled) await check();
  }

  button.onclick = async () => {
    button.disabled = true;
    try {
      if (!enabled && Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') { render(); return; }
      }
      await storageService.set(preference, !enabled);
      await readPreference();
    } catch {
      render();
      status.textContent = 'Could not update reminders. Please check your browser settings.';
    }
  };

  function openDay(date) {
    if (!validDay(date)) return;
    selected = parseDate(date);
    location.hash = 'planner';
    displaySchedule();
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'planner-reminder') openDay(event.data.date);
  });
  const url = new URL(location.href);
  if (validDay(url.searchParams.get('plannerDay')) && url.hash === '#planner') {
    openDay(url.searchParams.get('plannerDay'));
    url.searchParams.delete('plannerDay');
    window.history.replaceState(null, '', url);
  }

  async function init() {
    render();
    if (!supported) return;
    try {
      preference = 'planner-reminders.' + (await storageService.get('cloud-owner') || 'device');
      sentKey = preference + '.sent';
      await readPreference();
      storageService.subscribe((key, external) => {
        if (external && (key === preference || key === '*')) readPreference().catch(render);
        else if (key === 'events' || key === '*') check();
      });
      window.addEventListener('focus', () => { render(); check(); });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      setInterval(check, 30000);
    } catch {
      button.disabled = true;
      status.textContent = 'Your browser storage is unavailable for reminder settings.';
    }
  }
  init();
})();
