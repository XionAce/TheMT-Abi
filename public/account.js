'use strict';

(async () => {
  const el = id => document.getElementById(id);
  const app = el('study-app');
  const login = new URL('/login.html', location.origin);
  const route = location.hash.slice(1);
  if (['planner','focus','garden','review'].includes(route)) login.searchParams.set('next', route);
  const day = new URL(location.href).searchParams.get('plannerDay');
  if (route === 'planner' && /^\d{4}-\d{2}-\d{2}$/.test(day)) login.searchParams.set('plannerDay', day);
  el('session-login').href = login.href;
  el('retry-session').onclick = () => location.reload();
  const legacy = new URLSearchParams(location.hash.slice(1));
  if (legacy.has('access_token') || legacy.has('error_description')) {
    login.hash = location.hash;
    location.replace(login);
    return;
  }
  function leave() {
    const destination = app.hidden ? login : '/login.html';
    app.hidden = true;
    location.replace(destination);
  }
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  async function loadScripts(files) {
    for (const file of files) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = file + '.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('The study desk could not load.'));
        document.head.append(script);
      });
    }
  }
  async function openOffline() {
    const trusted = await storageService.get('offline-review');
    if (!trusted?.id) return false;
    reviewStore.init(trusted.id,false);
    document.body.classList.add('review-offline');
    el('brand-name').textContent = trusted.brand;
    document.title = 'Review · ' + trusted.brand;
    el('home-page').hidden = true;
    el('review-page').hidden = false;
    document.documentElement.dataset.theme = await storageService.get('theme') ||
      (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
    await loadScripts(['review']);
    el('session-check').hidden = true;
    app.hidden = false;
    const reconnect = el('review-reconnect');
    reconnect.hidden = false;
    reconnect.onclick = () => {
      history.replaceState(null, '', '/#review');
      location.reload();
    };
    window.addEventListener('online', async () => {
      try {
        const account = await storageService.openWorkspace(leave);
        if (account?.user.id !== trusted.id) { leave(); return; }
        reviewStore.init(trusted.id,true);
        await reviewStore.sync();
        reconnect.textContent = 'Open full workspace';
      } catch { el('rv-sync-status').textContent = 'Saved on this device. Reconnect to sync.'; }
    });
    storageService.subscribe(async key => {
      if ((key === 'offline-review' || key === '*') && (await storageService.get('offline-review'))?.id !== trusted.id) leave();
    });
    return true;
  }
  try {
    if (!navigator.onLine && await openOffline()) return;
    const account = await storageService.openWorkspace(leave);
    if (!account) { leave(); return; }
    const {user, desk} = account;
    const brand = desk ? 'AbiVerse' : 'MTVerse';
    el('brand-name').textContent = brand;
    el('brand-name').parentElement.setAttribute('aria-label', brand + ' home');
    if (desk) {
      el('greeting').textContent = 'Welcome,';
      el('desk-name').textContent = 'Abi.';
      el('private-desk').hidden = false;
      el('desk-note').value = desk.note;
      pinNote(desk.note);
    }
    function pinNote(text) {
      el('pinned-note').textContent = text;
      el('pinned-note').hidden = !text;
    }
    const status = el('cloud-status');
    async function run(action) {
      const controls = el('cloud-dialog').querySelectorAll('button:not(#cloud-close)');
      controls.forEach(b => b.disabled = true);
      status.textContent = 'One moment…';
      try { await action(); }
      catch (e) { status.textContent = e.message || 'Could not save. Please try again.'; }
      finally { controls.forEach(b => b.disabled = false); }
    }
    el('desk-note-form').onsubmit = event => {
      event.preventDefault();
      run(async () => {
        const note = el('desk-note').value.trim();
        await storageService.saveDeskNote(note);
        pinNote(note);
        status.textContent = note ? 'Note pinned to Home.' : 'Note removed.';
      });
    };
    function showStorage() {
      const state = storageService.connection();
      const mode = !navigator.onLine ? 'Offline' : state === 'unavailable' ? 'Could not reach your account' : 'Saved to your account';
      el('storage-mode').textContent = el('garden-save-location').textContent = mode;
    }
    storageService.subscribe(key => { if (key === 'cloud-state') showStorage(); });
    window.addEventListener('offline', showStorage);
    window.addEventListener('online', () => storageService.checkCloud());
    showStorage();
    el('account-email').textContent = user.email;
    const linked = user.identities?.some(i => i.provider === 'google');
    if (!linked) storageService.googleEnabled().then(enabled => {
      el('link-google').hidden = !enabled;
    }).catch(() => { /* Account management also works without Google. */ });
    el('cloud-settings').onclick = () => {
      status.textContent = linked ? 'Google is connected.' : '';
      el('cloud-dialog').showModal();
    };
    el('cloud-close').onclick = () => el('cloud-dialog').close();
    el('link-google').onclick = () => run(() => storageService.google(true));
    el('change-email-form').onsubmit = event => {
      event.preventDefault();
      run(async () => {
        await storageService.changeEmail(el('recovery-email').value.trim());
        status.textContent = 'Check your current and new inboxes for the confirmation instructions.';
        el('change-email-form').reset();
      });
    };
    el('cloud-signout').onclick = () => run(async () => { await storageService.signOut(); location.replace('/login.html'); });
    el('cloud-import').onclick = () => run(async () => {
      await storageService.importDevice();
      status.textContent = 'Device work copied. Existing account records were kept.';
    });
    // Load study modules only after the server verifies the account and workspace.
    reviewStore.init(user.id,true);
    await loadScripts(['backup','workspace-tools','planner','planner-reminders','desk','garden','cozy','ambient','vendor/spotify-config','spotify','review']);
    el('session-check').hidden = true;
    app.hidden = false;
  } catch (error) {
    if (!document.body.classList.contains('review-offline') &&
        (!navigator.onLine || error.name === 'AuthRetryableFetchError' || error.message === 'Failed to fetch')) {
      try { if (await openOffline()) return; } catch { /* Show the recovery controls below. */ }
    }
    app.hidden = true;
    const setup = ['PGRST205','42501'].includes(error.code);
    el('session-status').textContent = setup ? 'Your study desk is awaiting database setup. Please try again later.'
      : 'Could not verify your workspace. Check your connection or sign in again.';
    el('retry-session').hidden = false;
    el('exit-session').hidden = false;
    el('exit-session').onclick = async () => {
      try { await storageService.signOut(); location.replace('/login.html'); }
      catch { el('session-status').textContent = 'Could not sign out. Reconnect and try again.'; }
    };
  }
})();
