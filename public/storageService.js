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
  return {
    async get(key) {
      return read(key);
    },
    async set(key, value) {
      write(key, value);
    },
    async update(key, initial, mutate) {
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
      return entries(eventPrefix);
    },
    async saveEvent(id, item) {
      localStorage.setItem(eventPrefix + id, JSON.stringify(item));
      changed('events');
    },
    async deleteEvent(id) {
      localStorage.removeItem(eventPrefix + id);
      changed('events');
    },
    listDoodles,
    async saveDoodle(item) {
      write('doodle.' + item.id, { ...item, image: await dataURL(item.image) });
    },
  };
})();
