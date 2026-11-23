'use strict';

(() => {
  const el = id => document.getElementById(id);
  const dialog = el('cloud-dialog');
  const form = el('cloud-auth');
  const status = el('cloud-status');
  const fragment = new URLSearchParams(location.hash.slice(1));
  const emailLink = fragment.has('access_token') || fragment.has('error_description') || fragment.has('error');
  if (emailLink) history.replaceState(null, '', location.pathname + location.search + '#home');
  let updatePassword;
  const enabled = storageService.cloudEnabled();
  el('cloud-settings').textContent = enabled ? 'Cloud account' : 'Cloud sync';
  form.hidden = enabled;
  el('cloud-account-actions').hidden = !enabled;
  function showStorage() {
    const state = storageService.connection();
    const mode = !enabled ? 'Saved only on this device'
      : !navigator.onLine ? 'Cloud storage · Offline'
      : state === 'connected' ? 'Cloud storage · Connected'
      : state === 'checking' ? 'Cloud storage · Connecting…' : 'Cloud storage · Unavailable';
    el('storage-mode').textContent = mode;
    el('garden-save-location').textContent = mode;
    if (enabled) el('storage-note').textContent = mode;
  }
  storageService.subscribe(key => { if (key === 'cloud-state') showStorage(); });
  window.addEventListener('offline', showStorage);
  window.addEventListener('online', () => { showStorage(); storageService.checkCloud(); });
  showStorage();
  if (enabled) storageService.checkCloud();
  el('cloud-settings').onclick = async () => {
    status.textContent = '';
    dialog.showModal();
    if (updatePassword) { el('new-password').focus(); return; }
    if (!enabled) return;
    try {
      const email = await storageService.accountEmail();
      form.hidden = true;
      status.textContent = 'Signed in as ' + email;
    } catch {
      form.hidden = false;
      status.textContent = 'Sign in again to access your saved work.';
    }
  };
  el('cloud-close').onclick = () => dialog.close();
  async function run(action) {
    const controls = dialog.querySelectorAll('button:not(#cloud-close)');
    controls.forEach(b => b.disabled = true);
    status.textContent = 'Connecting…';
    try { await action(); }
    catch (e) {
      status.textContent = ['PGRST205', '42501'].includes(e.code)
        ? 'Cloud storage is awaiting database setup. Your device workspace is available.'
        : e.message || 'Could not reach your account. Please try again.';
    } finally { controls.forEach(b => b.disabled = false); }
  }
  form.onsubmit = event => {
    event.preventDefault();
    const register = event.submitter?.id === 'cloud-register';
    run(async () => {
      const signedIn = await storageService.signIn(el('cloud-email').value.trim(), el('cloud-password').value, register);
      el('cloud-password').value = '';
      if (signedIn) location.reload();
      else status.textContent = 'Check your email to confirm your account, then sign in here.';
    });
  };
  for (const [id, recovery] of [['forgot-password', true], ['resend-email', false]]) {
    el(id).onclick = () => {
      const email = el('cloud-email');
      if (!email.reportValidity()) return;
      run(async () => {
        await storageService.sendAccountEmail(email.value.trim(), recovery);
        status.textContent = recovery ? 'If your account exists, check your email for a reset link.'
          : 'Check your inbox for a verification link if your email is awaiting confirmation.';
      });
    };
  }
  if (emailLink) {
    dialog.showModal();
    run(async () => {
      if (fragment.has('error') || fragment.has('error_description'))
        throw new Error('This email link is invalid or expired. Request a new link.');
      const tokens = {access_token:fragment.get('access_token'), refresh_token:fragment.get('refresh_token')};
      fragment.delete('access_token');
      fragment.delete('refresh_token');
      updatePassword = await storageService.openEmailLink(fragment.get('type'), tokens);
      if (updatePassword) {
        form.hidden = el('cloud-account-actions').hidden = true;
        el('reset-form').hidden = false;
        status.textContent = 'Choose a new password for your account.';
        el('new-password').focus();
      } else status.textContent = 'Email verified. You can now sign in.';
    });
  }
  el('reset-form').onsubmit = e => {
    e.preventDefault();
    run(async () => {
      await updatePassword(el('new-password').value);
      updatePassword = null;
      el('reset-form').reset();
      el('reset-form').hidden = true;
      form.hidden = enabled;
      el('cloud-account-actions').hidden = !enabled;
      status.textContent = 'Password updated.';
    });
  };
  el('cloud-signout').onclick = () => run(async () => {
    await storageService.signOut();
    location.reload();
  });
  el('cloud-import').onclick = () => run(async () => {
    await storageService.importDevice();
    status.textContent = 'Device work copied. Existing account records were kept.';
  });
})();
