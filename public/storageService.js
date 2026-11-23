'use strict';

// Keep provider keys, serialization, migrations and cross-tab coordination here.
const storageService = (() => {
  const prefix = 'abiverse.';
  const eventPrefix = 'themt-abi.event.';
  const themeKey = 'themt-abi.theme';
  const listeners = new Set();
  const keyFor = (key) => (key === 'theme' ? themeKey : prefix + key);
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
    if (e.key === keyFor('cloud-owner')) { location.reload(); return; }
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
  // A device can keep working locally until its owner chooses cloud storage.
  // An expired cloud session must never redirect a save into the guest workspace.
  const projectUrl = 'https://jwbuvusjftowihjimfpr.supabase.co';
  const publishableKey = 'sb_publishable_VSitI9Qs1YqBHHdAsRp4-g_x0Ayt7no';
  const table = 'abiverse_records';
  function owner() {
    try { return read('cloud-owner'); } catch { return null; }
  }
  let clientPromise;
  function client() {
    if (!clientPromise) {
      clientPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'vendor/supabase.js';
        script.onload = () => {
          try {
            resolve(window.supabase.createClient(projectUrl, publishableKey, {
              auth: { storageKey: 'abiverse-account', detectSessionInUrl: false },
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
  async function workspace(userId = owner()) {
    const db = await client();
    const { session } = data(await db.auth.getSession());
    if (!session || session.user.id !== userId) throw new Error('Sign in again to access your cloud workspace.');
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
      const records = data(await page);
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
    data(await target.db.from(table).upsert(record(target, kind, key, payload)));
    notifyCloud(target, notification);
  }
  async function cloudFocus(target) {
    return data(await query(target, 'focus').eq('record_key', 'current').maybeSingle());
  }
  // Reapply a focus action to the latest version when another device writes first.
  async function updateCloudFocus(target, initial, mutate) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await cloudFocus(target);
      const value = existing?.payload ?? initial();
      const result = mutate(value);
      if (existing) {
        const rows = data(await target.db.from(table)
          .update({ payload: value, revision: crypto.randomUUID() })
          .eq('owner_id', target.userId).eq('kind', 'focus').eq('record_key', 'current')
          .eq('revision', existing.revision).select('record_key'));
        if (!rows.length) continue;
      } else {
        const inserted = await target.db.from(table).insert(record(target, 'focus', 'current', value));
        if (inserted.error?.code === '23505') continue;
        data(inserted);
      }
      notifyCloud(target, 'cozy');
      return result;
    }
    throw new Error('Another device updated Focus. Please try again.');
  }
  async function signIn(email, password, register) {
    const db = await client();
    const result = register
      ? await db.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
      : await db.auth.signInWithPassword({ email, password });
    const { session } = data(result);
    if (!session) return false;
    // Switch workspaces only after the table is available to this account.
    data(await db.from(table).select('record_key').eq('owner_id', session.user.id).limit(1));
    write('cloud-owner', session.user.id);
    return true;
  }
  async function signOut() {
    const db = await client();
    data(await db.auth.signOut({ scope: 'local' }));
    write('cloud-owner', null);
  }
  async function importDevice() {
    const target = await workspace();
    const groups = [
      ['event', entries(eventPrefix)],
      ['doodle', (await listDoodles()).map(item => [item.id, item])],
    ];
    for (const [kind, items] of groups) {
      for (let offset = 0; offset < items.length; offset += 10) {
        const batch = items.slice(offset, offset + 10).map(([id, value]) => record(target, kind, id, value));
        data(await target.db.from(table).upsert(batch, { ignoreDuplicates: true }));
      }
    }
    const local = read('cozy');
    if (local?.timer && Array.isArray(local.intentions)) {
      await updateCloudFocus(target, () => ({ timer: local.timer, intentions: [] }), state => {
        const ids = new Set(state.intentions.map(item => item.id));
        state.intentions.push(...local.intentions.filter(item => !ids.has(item.id)));
        const sessions = state.sessions ??= [];
        const imported = new Set(sessions.map(session => session.id));
        sessions.push(...(local.sessions || []).filter(session => !imported.has(session.id)));
      });
    }
    notifyCloud(target, '*');
  }
  return {
    cloudEnabled: () => Boolean(owner()),
    signIn, signOut, importDevice,
    async accountEmail() { return (await workspace()).email; },
    async get(key) {
      if (key === 'cozy' && owner()) return (await cloudFocus(await workspace()))?.payload ?? null;
      return read(key);
    },
    async set(key, value) {
      write(key, value);
    },
    async update(key, initial, mutate) {
      if (key === 'cozy' && owner()) return updateCloudFocus(await workspace(), initial, mutate);
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
      return owner() ? listCloud('event') : entries(eventPrefix);
    },
    async saveEvent(id, item) {
      if (owner()) return saveCloud('event', id, item, 'events');
      localStorage.setItem(eventPrefix + id, JSON.stringify(item));
      changed('events');
    },
    async deleteEvent(id) {
      if (owner()) {
        const target = await workspace();
        data(await target.db.from(table).delete().eq('owner_id', target.userId).eq('kind', 'event').eq('record_key', id));
        notifyCloud(target, 'events');
        return;
      }
      localStorage.removeItem(eventPrefix + id);
      changed('events');
    },
    async listDoodles() {
      return owner() ? (await listCloud('doodle')).map(([, value]) => value) : listDoodles();
    },
    async saveDoodle(item) {
      const value = { ...item, image: await dataURL(item.image) };
      if (owner()) return saveCloud('doodle', item.id, value, 'doodle.' + item.id);
      write('doodle.' + item.id, value);
    },
  };
})();
