'use strict';

// Keep provider keys, serialization, migrations and cross-tab coordination here.
const storageService = (() => {
  const prefix = 'abiverse.';
  const eventPrefix = 'themt-abi.event.';
  const themeKey = 'themt-abi.theme';
  const listeners = new Set();
  let activeUser = null;
  const owner = () => activeUser?.id;
  function keyFor(key) {
    if (key === 'theme') return themeKey;
    if (key.startsWith('spotify.')) {
      if (!owner()) throw new Error('Sign in to use Spotify.');
      return prefix + owner() + '.' + key;
    }
    return prefix + key;
  }
  function changed(key, external = false) {
    for (const listener of listeners) listener(key, external);
  }
  function read(key) {
    const value = localStorage.getItem(keyFor(key));
    if (value === null || key === 'theme') return value;
    return JSON.parse(value);
  }
  function write(key, value) {
    if (value === null) localStorage.removeItem(keyFor(key));
    else localStorage.setItem(keyFor(key), key === 'theme' ? value : JSON.stringify(value));
    changed(key);
  }
  window.addEventListener('storage', (e) => {
    if (owner() && e.key === keyFor('spotify.auth')) { changed('spotify.auth', true); return; }
    if (!e.key) changed('*', true);
    else if (e.key === themeKey) changed('theme', true);
    else if (e.key.startsWith(eventPrefix)) changed('events', true);
    else if (e.key.startsWith(prefix)) changed(e.key.slice(prefix.length), true);
  });
  function entries(start) {
    const values = [];
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(start)) continue;
      try {
        values.push([key.slice(start.length), JSON.parse(localStorage.getItem(key))]);
      } catch {
        /* One damaged record must not obscure the other items. */
      }
    }
    return values;
  }
  function dataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  // Older garden releases stored PNG blobs in IndexedDB. Import once, without
  // deleting originals; even a full localStorage must leave old memories readable.
  async function legacyDoodles() {
    if (!window.indexedDB) return [];
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('abiverse-garden');
      let missing = false;
      open.onupgradeneeded = () => {
        missing = true;
        open.transaction.abort();
      };
      open.onerror = () => (missing ? resolve([]) : reject(open.error));
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('doodles')) {
          db.close();
          resolve([]);
          return;
        }
        const request = db.transaction('doodles').objectStore('doodles').getAll();
        request.onsuccess = () => {
          db.close();
          resolve(request.result);
        };
        request.onerror = () => {
          db.close();
          reject(request.error);
        };
      };
    });
  }
  async function listDoodles() {
    const items = new Map(entries(prefix + 'doodle.'));
    if (!read('garden-imported')) {
      let complete = true;
      for (const item of await legacyDoodles()) {
        if (items.has(item.id)) continue;
        const record = { ...item, image: await dataURL(item.image) };
        items.set(item.id, record);
        try {
          write('doodle.' + item.id, record);
        } catch {
          complete = false;
        }
      }
      if (complete) {
        try {
          write('garden-imported', true);
        } catch {
          /* Retry next visit. */
        }
      }
    }
    return [...items.values()];
  }
  const projectUrl = 'https://jwbuvusjftowihjimfpr.supabase.co';
  const publishableKey = 'sb_publishable_VSitI9Qs1YqBHHdAsRp4-g_x0Ayt7no';
  const table = 'abiverse_records';
  const authRedirect = location.origin + '/login.html';
  let clientPromise;
  function client() {
    if (!clientPromise) {
      clientPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'vendor/supabase.js';
        script.onload = () => {
          try {
            resolve(window.supabase.createClient(projectUrl, publishableKey, {
              auth: { storageKey: 'abiverse-account', flowType:'pkce', detectSessionInUrl: false },
            }));
          } catch (error) { reject(error); }
        };
        script.onerror = () => reject(new Error('The cloud connection could not load. Try again.'));
        document.head.append(script);
      }).catch(error => { clientPromise = undefined; throw error; });
    }
    return clientPromise;
  }
  function data(result) {
    if (result.error) throw result.error;
    return result.data;
  }
  let connection = 'checking';
  function connectionState(next) {
    if (connection !== next) { connection = next; changed('cloud-state'); }
  }
  function databaseResult(result) {
    connectionState(result.error ? 'unavailable' : 'connected');
    return data(result);
  }
  async function workspace(userId = owner()) {
    const db = await client();
    const sessionResult = await db.auth.getSession();
    if (sessionResult.error) connectionState('unavailable');
    const { session } = data(sessionResult);
    if (!session || session.user.id !== userId) {
      connectionState('unavailable');
      throw new Error('Sign in again to access your cloud workspace.');
    }
    return { db, userId, email: session.user.email };
  }
  function query({ db, userId }, kind) {
    return db.from(table).select('record_key,payload,revision').eq('owner_id', userId).eq('kind', kind);
  }
  function record(target, kind, key, payload) {
    return { owner_id: target.userId, kind, record_key: key, payload };
  }
  async function listCloud(kind) {
    const target = await workspace();
    const rows = [];
    let after;
    const size = kind === 'doodle' ? 10 : 100;
    while (true) {
      let page = query(target, kind).order('record_key').limit(size);
      if (after !== undefined) page = page.gt('record_key', after);
      const records = databaseResult(await page);
      rows.push(...records.map(r => [r.record_key, r.payload]));
      if (records.length < size) return rows;
      after = records.at(-1).record_key;
    }
  }
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('abiverse-cloud') : null;
  if (channel) channel.onmessage = ({ data: message }) => {
    if (message.owner && message.owner === owner()) changed(message.key, true);
  };
  function notifyCloud(target, key) {
    if (target.userId === owner()) changed(key);
    channel?.postMessage({ owner: target.userId, key });
  }
  async function saveCloud(kind, key, payload, notification) {
    const target = await workspace();
    databaseResult(await target.db.from(table).upsert(record(target, kind, key, payload)));
    notifyCloud(target, notification);
  }
  async function cloudFocus(target) {
    return databaseResult(await query(target, 'focus').eq('record_key', 'current').maybeSingle());
  }
  // Reapply a focus action to the latest version when another device writes first.
  async function updateCloudFocus(target, initial, mutate) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await cloudFocus(target);
      const value = existing?.payload ?? initial();
      const result = mutate(value);
      if (existing) {
        const rows = databaseResult(await target.db.from(table)
          .update({ payload: value, revision: crypto.randomUUID() })
          .eq('owner_id', target.userId).eq('kind', 'focus').eq('record_key', 'current')
          .eq('revision', existing.revision).select('record_key'));
        if (!rows.length) continue;
      } else {
        const inserted = await target.db.from(table).insert(record(target, 'focus', 'current', value));
        if (inserted.error?.code === '23505') continue;
        databaseResult(inserted);
      }
      notifyCloud(target, 'cozy');
      return result;
    }
    throw new Error('Another device updated Focus. Please try again.');
  }
  async function signIn(email, password, register) {
    const db = await client();
    const result = register
      ? await db.auth.signUp({email, password, options:{emailRedirectTo:authRedirect}})
      : await db.auth.signInWithPassword({email, password});
    return Boolean(data(result).session);
  }
  async function signOut() {
    const db = await client();
    data(await db.auth.signOut({scope:'local'}));
    activeUser = null;
  }
  async function googleEnabled() {
    const response = await fetch(projectUrl + '/auth/v1/settings', {headers:{apikey:publishableKey}});
    if (!response.ok) throw new Error('Google sign-in is unavailable. Please try again later.');
    return (await response.json()).external?.google === true;
  }
  async function google(link = false) {
    const db = await client();
    if (!await googleEnabled()) throw new Error('Google sign-in is not enabled yet. Use email to sign in.');
    const options = {provider:'google', options:{redirectTo:authRedirect}};
    data(link ? await db.auth.linkIdentity(options) : await db.auth.signInWithOAuth(options));
  }
  async function openWorkspace(onAccountChange) {
    const db = await client();
    const {session} = data(await db.auth.getSession());
    if (!session) return null;
    const {user} = data(await db.auth.getUser());
    if (!user?.email_confirmed_at) throw new Error('Verify your email to open your workspace.');
    activeUser = user;
    db.auth.onAuthStateChange((_event, current) => {
      if (current?.user.id !== user.id) {
        activeUser = null;
        onAccountChange();
      }
    });
    const target = await workspace(user.id);
    data(await query(target,'event').limit(0));
    const desk = data(await db.from('mtverse_private_desks').select('note').eq('owner_id', user.id).maybeSingle());
    if (activeUser?.id !== user.id) throw new Error('Account changed. Sign in again.');
    return {user, desk};
  }
  async function mergeStudy(groups, local, target) {
    try {
      for (const [kind, items] of groups) {
        for (let offset = 0; offset < items.length; offset += 10) {
          const batch = items.slice(offset, offset + 10).map(([id, value]) => record(target, kind, id, value));
          databaseResult(await target.db.from(table).upsert(batch, {ignoreDuplicates:true}));
        }
      }
      if (local) {
        const initial = () => ({timer:local.timer, intentions:[], sessions:[]});
        const merge = state => {
          for (const name of ['intentions','sessions']) {
            const rows = state[name] ??= [];
            const ids = new Set(rows.map(row => row.id));
            for (const row of local[name] || []) {
              if (!ids.has(row.id)) { rows.push(row); ids.add(row.id); }
            }
          }
        };
        await updateCloudFocus(target, initial, merge);
      }
    } finally {
      notifyCloud(target, '*');
    }
  }
  async function importDevice() {
    const target = await workspace();
    const desk = data(await target.db.from('mtverse_private_desks').select('owner_id').eq('owner_id', target.userId).maybeSingle());
    if (!desk) throw new Error('Device migration is available to the original desk owner.');
    const groups = [
      ['event', entries(eventPrefix)],
      ['doodle', (await listDoodles()).map(item => [item.id, item])],
    ];
    await mergeStudy(groups, read('cozy'), target);
  }
  async function exportBackup() {
    const [events, doodles, focus] = await Promise.all([
      storageService.listEvents(), storageService.listDoodles(), storageService.get('cozy'),
    ]);
    return studyBackup.parse({app:'MTVerse', version:1, events:events.map(([id,e]) => ({...e,id})), doodles, focus});
  }
  async function importBackup(input) {
    const file = studyBackup.parse(input);
    const target = await workspace();
    const events = file.events.map(({id, ...value}) => [id, value]);
    await mergeStudy([['event', events], ['doodle', file.doodles.map(d => [d.id,d])]], file.focus, target);
  }
  // Recovery sessions live only in memory and never switch the active workspace.
  async function openEmailLink(type, tokens) {
    const db = await client();
    if (type !== 'recovery') {
      const {user} = data(await db.auth.getUser(tokens.access_token));
      if (!user?.email_confirmed_at) throw new Error('Email verification is incomplete.');
      return;
    }
    const recovery = window.supabase.createClient(projectUrl, publishableKey, {
      auth: {storageKey:'abiverse-recovery', persistSession:false, autoRefreshToken:false, detectSessionInUrl:false},
    });
    data(await recovery.auth.setSession(tokens));
    return async password => {
      data(await recovery.auth.updateUser({password}));
      await recovery.auth.signOut({scope:'local'});
    };
  }
  return {
    cloudEnabled: () => Boolean(owner()),
    signIn, signOut, google, googleEnabled, openWorkspace, importDevice, exportBackup, importBackup, openEmailLink,
    async exchangeCode(code, flowId) {
      const db = await client();
      return data(await db.auth.exchangeCodeForSession(code, flowId ? {flowId} : undefined)).redirectType;
    },
    async changeEmail(email) {
      const {db} = await workspace();
      data(await db.auth.updateUser({email}, {emailRedirectTo:authRedirect}));
    },
    async resetPassword(password) {
      const db = await client();
      data(await db.auth.updateUser({password}));
    },
    async saveDeskNote(note) {
      const {db,userId} = await workspace();
      data(await db.from('mtverse_private_desks').update({note}).eq('owner_id',userId).select('owner_id').single());
    },
    connection: () => connection,
    async checkCloud() {
      if (!owner()) return;
      try {
        const target = await workspace();
        databaseResult(await query(target, 'focus').limit(0));
      } catch { connectionState('unavailable'); }
    },
    async sendAccountEmail(email, recovery) {
      const db = await client();
      const redirect = authRedirect;
      if (recovery) data(await db.auth.resetPasswordForEmail(email, {redirectTo:redirect}));
      else data(await db.auth.resend({type:'signup', email, options:{emailRedirectTo:redirect}}));
    },
    async get(key) {
      if (key === 'cozy') return (await cloudFocus(await workspace()))?.payload ?? null;
      if (key === 'cloud-owner') return owner();
      return read(key);
    },
    async set(key, value) {
      write(key, value);
    },
    async update(key, initial, mutate) {
      if (key === 'cozy') return updateCloudFocus(await workspace(), initial, mutate);
      const commit = () => {
        const state = read(key) ?? initial();
        const result = mutate(state);
        write(key, state);
        return result;
      };
      return navigator.locks ? navigator.locks.request(keyFor(key), commit) : commit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async listEvents() {
      return listCloud('event');
    },
    async saveEvent(id, item) { return saveCloud('event', id, item, 'events'); },
    async deleteEvent(id) {
      const target = await workspace();
      databaseResult(await target.db.from(table).delete().eq('owner_id',target.userId).eq('kind','event').eq('record_key',id));
      notifyCloud(target, 'events');
    },
    async listDoodles() { return (await listCloud('doodle')).map(([,value]) => value); },
    async saveDoodle(item) {
      return saveCloud('doodle', item.id, {...item, image:await dataURL(item.image)}, 'doodle.' + item.id);
    },
  };
})();
