'use strict';

(() => {
  const el = id => document.getElementById(id);
  const dialog = el('cloud-dialog');
  const form = el('cloud-auth');
  const status = el('cloud-status');
  // The email verification link can return tokens in the fragment. Sign-in is
  // explicit here so checking email on another device cannot switch its workspace.
  if (new URLSearchParams(location.hash.slice(1)).has('access_token')) {
    history.replaceState(null, '', location.pathname + location.search + '#home');
  }
  const enabled = storageService.cloudEnabled();
  el('cloud-settings').textContent = enabled ? 'Cloud account' : 'Cloud sync';
  form.hidden = enabled;
  el('cloud-account-actions').hidden = !enabled;
  if (enabled) {
    el('garden-save-location').textContent = 'Saved to your account';
    el('storage-note').textContent = 'Your planner is saved to your account.';
  }
  el('cloud-settings').onclick = async () => {
    status.textContent = '';
    dialog.showModal();
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
  el('cloud-signout').onclick = () => run(async () => {
    await storageService.signOut();
    location.reload();
  });
  el('cloud-import').onclick = () => run(async () => {
    await storageService.importDevice();
    status.textContent = 'Device work copied. Existing account records were kept.';
  });
})();
