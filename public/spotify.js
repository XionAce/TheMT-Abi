'use strict';

(() => {
  const el = (id) => document.getElementById(id);
  const island = el('spotify-island'),
    toggle = el('music-toggle'),
    panel = el('music-panel'),
    setup = el('spotify-setup');
  const seek = el('seek'),
    cover = el('cover'),
    scope = 'user-read-currently-playing user-modify-playback-state user-library-modify';
  const builtInId = window.ABIVERSE_SPOTIFY_CLIENT_ID || '';
  const redirect = location.origin + location.pathname,
    accounts = 'https://accounts.spotify.com';
  let credentials = null,
    playback = null,
    loadedAt = 0,
    pollTimer,
    inFlight = false,
    pinned = false,
    seeking = false,
    command = false;
  let retryAt = 0,
    generation = 0,
    receivedId = '',
    savedUri = '';
  const status = (msg) => {
    el('music-status').textContent = msg;
  };
  const compact = () => {
    pinned = false;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };
  const expand = () => {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  };
  const encode = (bytes) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const random = (length) => encode(crypto.getRandomValues(new Uint8Array(length)));
  el('redirect-address').textContent = redirect;
  el('spotify-close').onclick = () => setup.close();

  async function authorize(id) {
    const state = random(24),
      verifier = random(64);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    await storageService.set('spotify.pending.' + state, {
      verifier,
      id,
      route: location.hash,
      at: Date.now(),
    });
    if (!builtInId) await storageService.set('spotify.client', id);
    const params = new URLSearchParams({
      client_id: id,
      response_type: 'code',
      redirect_uri: redirect,
      scope,
      state,
      code_challenge_method: 'S256',
      code_challenge: encode(new Uint8Array(digest)),
    });
    history.replaceState({ ...history.state, spotifySignInStarted: true }, '');
    location.assign(accounts + '/authorize?' + params);
  }
  async function connect() {
    const id = builtInId || (await storageService.get('spotify.client'));
    if (id) return authorize(id);
    showSetup('Set up Spotify once on this device.');
  }
  function showSetup(message) {
    el('spotify-form').hidden = Boolean(builtInId);
    el('auth-status').textContent = message;
    if (!setup.open) setup.showModal();
  }
  function authError(error) {
    const message = error.message || 'Spotify sign-in failed. Please try again.';
    showSetup(/redirect[ _-]*(uri|url)/i.test(message)
      ? 'Spotify rejected the redirect URI. Register ' + redirect + ' exactly in the Spotify app settings and try again.'
      : message);
  }
  // Spotify may refuse an unregistered URI on its own page, without a callback.
  window.addEventListener('pageshow', async () => {
    if (!history.state?.spotifySignInStarted) return;
    const { spotifySignInStarted, ...rest } = history.state;
    history.replaceState(rest, '');
    if (await storageService.get('spotify.auth').catch(() => null)) return;
    showSetup('Sign-in did not finish. If Spotify showed “Invalid redirect URI”, register ' + redirect + ' exactly in the Spotify app settings, then connect again.');
  });
  el('spotify-form').onsubmit = (e) => {
    e.preventDefault();
    authorize(builtInId || el('spotify-id').value.trim()).catch(authError);
  };
  async function tokenRequest(params) {
    const response = await fetch(accounts + '/api/token', {
      method: 'POST',
      body: new URLSearchParams(params),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error_description || 'Spotify sign-in failed.');
      error.reason = data.error;
      throw error;
    }
    return {
      access: data.access_token,
      refresh: data.refresh_token || params.refresh_token,
      expires: Date.now() + data.expires_in * 1000,
      client: params.client_id,
    };
  }
  async function callback() {
    const url = new URL(location.href);
    if (!url.searchParams.has('code') && !url.searchParams.has('error')) return;
    const key = 'spotify.pending.' + url.searchParams.get('state');
    const request = await storageService.get(key);
    const code = url.searchParams.get('code'),
      denied = url.searchParams.get('error'),
      detail = url.searchParams.get('error_description');
    for (const k of ['code', 'state', 'error', 'error_description']) url.searchParams.delete(k);
    url.hash = request?.route || '#home';
    history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    if (request) await storageService.set(key, null);
    if (!request || Date.now() - request.at > 600000)
      throw new Error('This sign-in has expired. Connect again.');
    if (denied) throw new Error(denied === 'access_denied' ? 'Spotify connection was cancelled.' : detail || denied);
    const token = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      code_verifier: request.verifier,
      client_id: request.id,
    });
    await storageService.set('spotify.auth', token);
  }
  async function access(stale) {
    const refresh = async () => {
      const current = await storageService.get('spotify.auth');
      if (!current) throw new Error('Connect Spotify to continue.');
      if (current.expires > Date.now() + 30000 && current.access !== stale) return current.access;
      try {
        const next = await tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: current.refresh,
          client_id: current.client,
        });
        if ((await storageService.get('spotify.auth'))?.refresh !== current.refresh)
          throw new Error('Spotify connection changed.');
        await storageService.set('spotify.auth', next);
        return next.access;
      } catch (err) {
        if (err.reason === 'invalid_grant') await storageService.set('spotify.auth', null);
        throw err;
      }
    };
    if (credentials && credentials.expires > Date.now() + 30000 && credentials.access !== stale)
      return credentials.access;
    return navigator.locks
      ? navigator.locks.request('abiverse.spotify.refresh', refresh)
      : refresh();
  }
  async function api(path, method = 'GET') {
    if (Date.now() < retryAt) throw new Error('Spotify is rate-limiting requests. Please wait.');
    let token = await access();
    const send = () =>
      fetch('https://api.spotify.com/v1/me/' + path, {
        method,
        headers: { Authorization: 'Bearer ' + token },
      });
    let response = await send();
    if (response.status === 401) {
      token = await access(token);
      response = await send();
    }
    if (response.status === 429)
      retryAt = Date.now() + 1000 * Math.max(5, Number(response.headers.get('Retry-After')) || 30);
    if (!response.ok) {
      const message = {
        403: 'Spotify restricted this action. Check Premium and app access.',
        404: 'Start playback on a Spotify device first.',
        429: 'Spotify is busy. Retrying after its rate limit.',
      };
      throw new Error(
        message[response.status] || 'Spotify request failed (' + response.status + ').',
      );
    }
    if (method !== 'GET' || response.status === 204) return null;
    return response.json();
  }
  function progress() {
    if (!playback?.item || seeking) return;
    const elapsed = playback.is_playing ? Date.now() - loadedAt : 0;
    seek.value = Math.min(Number(seek.max), playback.progress_ms + elapsed);
  }
  function draw() {
    const item = playback?.item;
    island.classList.toggle('connected', Boolean(credentials));
    island.classList.toggle('playing', Boolean(item && playback.is_playing));
    el('song').textContent = credentials ? item?.name || 'Spotify · Idle' : 'Connect Spotify';
    el('artist').textContent =
      item?.artists?.map((a) => a.name).join(', ') ||
      (credentials ? 'Open Spotify on a device to play music.' : '');
    const image = item?.album?.images?.at(-1)?.url;
    if (image !== receivedId) {
      receivedId = image;
      island.style.removeProperty('--album-color');
      if (image) {
        cover.hidden = false;
        cover.src = image;
        sampleColor(image);
      } else {
        cover.hidden = true;
        cover.removeAttribute('src');
      }
    }
    const link = el('song-link'),
      url = item?.external_urls?.spotify;
    link.hidden = !url?.startsWith('https://open.spotify.com/');
    if (!link.hidden) link.href = url;
    else link.removeAttribute('href');
    seek.max = item?.duration_ms || 1;
    seek.disabled = !item || command;
    progress();
    for (const b of island.querySelectorAll('[data-player]')) {
      const action = b.dataset.player;
      b.disabled = command || !credentials || (!item && action !== 'play');
      if (action === 'play') {
        b.textContent = playback?.is_playing ? 'Ⅱ' : '▶';
        b.setAttribute('aria-label', playback?.is_playing ? 'Pause' : 'Play');
      }
      if (action === 'heart') {
        const saved = !!item && savedUri === item.uri;
        b.textContent = saved ? '♥' : '♡';
        b.disabled ||= saved || item?.type !== 'track';
        b.setAttribute('aria-label', saved ? 'Saved to Liked Songs' : 'Save to Liked Songs');
      }
    }
  }
  function sampleColor(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (receivedId !== url) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 16;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 16, 16);
        const pixels = ctx.getImageData(0, 0, 16, 16).data,
          bins = new Map();
        for (let i = 0; i < pixels.length; i += 4) {
          const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]].map((v) =>
            Math.min(255, 32 + 64 * Math.floor(v / 64)),
          );
          const key = rgb.join(' ');
          bins.set(key, (bins.get(key) || 0) + 1);
        }
        const color = [...bins].sort((a, b) => b[1] - a[1])[0][0];
        island.style.setProperty('--album-color', 'rgb(' + color + ')');
      } catch {
        /* The neutral border works when artwork blocks pixel access. */
      }
    };
    img.src = url;
  }
  function schedule(delay = 5000) {
    clearTimeout(pollTimer);
    if (!document.hidden && credentials)
      pollTimer = setTimeout(poll, Math.max(delay, retryAt - Date.now()));
  }
  async function poll() {
    if (inFlight || document.hidden || !credentials) return;
    inFlight = true;
    const version = generation;
    try {
      const data = await api('player/currently-playing');
      if (version !== generation) return;
      playback = data;
      loadedAt = Date.now();
      status('');
      draw();
    } catch (e) {
      if (version === generation) status(e.message);
    } finally {
      inFlight = false;
      schedule();
    }
  }
  async function act(action) {
    if (command) return;
    const position = Math.round(Number(seek.value));
    command = true;
    draw();
    try {
      if (action === 'heart') {
        const uri = playback?.item?.uri;
        if (!uri) return;
        await api('library?' + new URLSearchParams({ uris: uri }), 'PUT');
        savedUri = uri;
      } else if (action === 'seek') {
        await api('player/seek?position_ms=' + position, 'PUT');
      } else if (action === 'play')
        await api('player/' + (playback?.is_playing ? 'pause' : 'play'), 'PUT');
      else await api('player/' + action, 'POST');
      schedule(300);
      status('');
    } catch (e) {
      status(e.message);
    } finally {
      command = false;
      seeking = false;
      draw();
    }
  }
  for (const b of island.querySelectorAll('[data-player]')) b.onclick = () => act(b.dataset.player);
  seek.oninput = () => {
    seeking = true;
  };
  seek.onchange = () => act('seek');
  seek.onpointerdown = () => {
    seeking = true;
  };
  seek.onpointercancel = seek.onblur = () => {
    seeking = false;
  };
  toggle.onclick = () => {
    if (!credentials) {
      connect().catch(authError);
      return;
    }
    pinned = !pinned;
    if (pinned) expand();
    else compact();
  };
  island.onpointerenter = (e) => {
    if (e.pointerType === 'mouse' && credentials) expand();
  };
  island.onpointerleave = () => {
    if (!pinned && !panel.contains(document.activeElement)) compact();
  };
  document.addEventListener('pointerdown', (e) => {
    if (!island.contains(e.target)) compact();
  });
  island.onkeydown = (e) => {
    if (e.key === 'Escape') {
      compact();
      toggle.focus();
    }
  };
  island.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !island.contains(e.relatedTarget)) compact();
  });
  el('disconnect').onclick = async () => {
    await storageService.set('spotify.auth', null);
    compact();
  };
  async function sync() {
    const prev = credentials;
    credentials = await storageService.get('spotify.auth');
    if (!credentials) {
      generation++;
      playback = null;
      savedUri = '';
      clearTimeout(pollTimer);
      compact();
    }
    draw();
    if (credentials && !prev) poll();
  }
  storageService.subscribe((key) => {
    if (key === 'spotify.auth' || key === '*') sync().catch(authError);
  });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(pollTimer);
    if (!document.hidden) poll();
  });
  setInterval(() => {
    if (!document.hidden && !panel.hidden) progress();
  }, 500);
  callback().catch(authError).then(sync).catch(authError);
})();
