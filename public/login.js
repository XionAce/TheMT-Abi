'use strict';

(() => {
  const el = id => document.getElementById(id);
  const params = new URL(location.href).searchParams;
  const routes = ['home','planner','focus','garden'];
  const route = routes.includes(params.get('next')) ? params.get('next') : 'home';
  const day = params.get('plannerDay');
  const enter = () => location.replace('/' + (route === 'planner' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? '?plannerDay=' + day : '') + '#' + route);
  let mode, updatePassword;
  let googleAvailable = false;
  function showGoogle() {
    el('google-login').hidden = el('login-divider').hidden = !googleAvailable || !['login','register'].includes(mode);
  }
  const copy = {
    login:['Welcome back.', 'Sign in to your study desk.', 'Sign in'],
    register:['Create an account.', 'Keep your planner, focus sessions, and garden together.', 'Create account'],
    forgot:['Reset your password.', 'Enter your verified account email. Open the link in this browser.', 'Email me a reset link'],
    reset:['Choose a password.', 'Use at least 12 characters for your new password.', 'Save new password'],
  };
  function show(next) {
    mode = next;
    const [title, intro, submit] = copy[mode];
    el('login-title').textContent = title;
    el('login-intro').textContent = intro;
    el('submit-login').textContent = submit;
    showGoogle();
    el('email-label').hidden = el('email').disabled = mode === 'reset';
    el('password-label').hidden = el('password').disabled = mode === 'forgot';
    el('password').value = '';
    el('password').minLength = ['register','reset'].includes(mode) ? 12 : 1;
    el('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    el('change-mode').textContent = mode === 'login' ? 'Create an account' : 'Back to sign in';
    el('change-mode').hidden = mode === 'reset';
    el('forgot').hidden = mode !== 'login';
    el('resend').hidden = mode !== 'register';
    el('login-status').textContent = '';
  }
  async function run(action) {
    const buttons = document.querySelectorAll('.login-card button');
    buttons.forEach(b => b.disabled = true);
    el('login-status').textContent = 'One moment…';
    try { await action(); }
    catch (e) {
      const messages = {
        email_address_not_authorized:'Email delivery is limited to project team addresses during testing.',
        over_email_send_rate_limit:'Too many emails have been requested. Please wait before requesting another.',
      };
      el('login-status').textContent = messages[e.code] || e.message || 'Could not connect. Please try again.';
    }
    finally { buttons.forEach(b => b.disabled = false); }
  }
  el('change-mode').onclick = () => show(mode === 'login' ? 'register' : 'login');
  el('forgot').onclick = () => show('forgot');
  el('google-login').onclick = () => run(() => storageService.google());
  el('resend').onclick = () => {
    if (el('email').reportValidity()) run(async () => {
      await storageService.sendAccountEmail(el('email').value.trim(), false);
      el('login-status').textContent = 'If verification is pending, check your email for a new link.';
    });
  };
  el('login-form').onsubmit = event => {
    event.preventDefault();
    run(async () => {
      const email = el('email').value.trim(), password = el('password').value;
      if (mode === 'reset') {
        await updatePassword(password);
        show('login');
        el('login-status').textContent = 'Password saved. You can sign in now.';
      } else if (mode === 'forgot') {
        await storageService.sendAccountEmail(email, true);
        el('login-status').textContent = 'If this address has an account, check your inbox for a reset link.';
      } else if (await storageService.signIn(email, password, mode === 'register')) enter();
      else {
        el('password').value = '';
        el('login-status').textContent = 'Check your email to confirm your account. Open the link in this browser.';
      }
    });
  };
  show('login');
  storageService.googleEnabled().then(enabled => {
    googleAvailable = enabled;
    showGoogle();
  }).catch(() => { /* Email sign-in stays available if the settings request fails. */ });
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (params.has('code') || params.has('error') || fragment.has('access_token') || fragment.has('error')) {
    history.replaceState(null, '', '/login.html');
    run(async () => {
      if (params.has('error') || fragment.has('error')) throw new Error('Sign-in or verification was cancelled or expired. Please try again.');
      if (params.has('code')) {
        let type;
        try { type = await storageService.exchangeCode(params.get('code'), params.get('sb_flow_id')); }
        catch { throw new Error('This link could not be completed. Open it in the browser where you started, or request a fresh link.'); }
        if (type !== 'recovery') { enter(); return; }
        updatePassword = async password => {
          await storageService.resetPassword(password);
          await storageService.signOut();
        };
      } else {
        updatePassword = await storageService.openEmailLink(fragment.get('type'), {
          access_token:fragment.get('access_token'), refresh_token:fragment.get('refresh_token'),
        });
      }
      if (updatePassword) show('reset');
      else el('login-status').textContent = 'Email verified. You can sign in now.';
    });
  }
  storageService.get('theme').then(theme => {
    document.documentElement.dataset.theme = theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
  }).catch(() => {});
})();
