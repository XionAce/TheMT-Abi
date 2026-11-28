'use strict';

// Each verified account has a separate database. A dirty row is the durable
// outbox entry: writing content and queuing it are one IndexedDB transaction.
const reviewStore = (() => {
  let owner, dbPromise, running, retry, again = false, onlineAccess = false;
  let status = 'Saved on this device';
  const events = new EventTarget();
  let channel;
  function signal(type) { events.dispatchEvent(new Event(type)); }
  function announce(message) { status = message; signal('status'); }
  function init(id, verified) {
    if (owner && owner !== id) throw new Error('Please reopen your workspace.');
    owner = id;
    onlineAccess = verified;
    if (!channel && typeof BroadcastChannel === 'function') {
      channel = new BroadcastChannel('mtverse-review-' + id);
      channel.onmessage = () => signal('change');
    }
  }
  function database() {
    if (!owner) throw new Error('Open your account before using Review.');
    if (!dbPromise) dbPromise = new Promise((resolve,reject) => {
      const open = indexedDB.open('mtverse-review-' + owner,1);
      open.onupgradeneeded = () => open.result.createObjectStore('records',{keyPath:'id'});
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('Close other Review tabs and retry.'));
    }).catch(error => { dbPromise = null; throw error; });
    return dbPromise;
  }
  async function read() {
    const db = await database();
    return new Promise((resolve,reject) => {
      const request = db.transaction('records').objectStore('records').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  /** The callback must be synchronous so validation and writes share the same transaction. */
  async function transaction(change) {
    const db = await database();
    return new Promise((resolve,reject) => {
      const tx = db.transaction('records','readwrite');
      const store = tx.objectStore('records'), request = store.getAll();
      let reason, count = 0;
      request.onsuccess = () => {
        try {
          for (const row of change(request.result)) { store.put(row); count++; }
        } catch (error) { reason = error; tx.abort(); }
      };
      tx.oncomplete = () => {
        if (count) { signal('change'); channel?.postMessage('change'); }
        resolve(count);
      };
      tx.onabort = () => reject(reason || tx.error || new Error('Local save failed.'));
      tx.onerror = () => reject(tx.error);
    });
  }
  /** @param {(current:ReviewRow[])=>ReviewRow[]} build */
  async function edit(build) {
    const count = await transaction(current => reviewCore.checkBackup(build(current)).map(row=>({...row,dirty:true})));
    if (count) { announce('Saved on this device'); requestSync(); }
    return count;
  }
  function requestSync(delay = 400) {
    if (!onlineAccess || !navigator.onLine) return;
    if (running) { again = true; return; }
    clearTimeout(retry);
    retry = setTimeout(() => sync().catch(() => {}),delay);
  }
  async function exchange() {
    const cloud = await storageService.reviewCloud(owner);
    const local = await read();
    const pending = local.filter(row=>row.dirty);
    for (const appendOnly of [true,false]) {
      const rows = pending.filter(row=>reviewCore.immutable(row.kind) === appendOnly);
      for (let i=0;i<rows.length;i+=5) await cloud.push(rows.slice(i,i+5),appendOnly);
    }
    // Fetch a light manifest first. Unchanged card records, including their images, stay local.
    const manifest = await cloud.manifest();
    const previous = new Map(local.map(r=>[r.id,r]));
    const needed = manifest.filter(r => previous.get(r.id)?.stamp !== r.stamp);
    const remote = [];
    for (let i=0;i<needed.length;i+=5) remote.push(...await cloud.fetch(needed.slice(i,i+5).map(r=>r.id)));
    reviewCore.checkBackup(remote);
    const ack = new Map(manifest.map(r=>[r.id,r.stamp]));
    await transaction(current => {
      const byId = new Map(current.map(r=>[r.id,r]));
      const writes = new Map();
      for (const row of current) {
        if (row.dirty && ack.get(row.id) === row.stamp) writes.set(row.id,{...row,dirty:false});
      }
      for (const row of remote) {
        const existing = byId.get(row.id);
        // Last-edit-wins for cards (including delete). Immutable IDs converge
        // to the first accepted event; undo is another event, never a deletion.
        if (!existing || reviewCore.immutable(row.kind) || existing.stamp <= row.stamp)
          writes.set(row.id,{...row,dirty:false});
      }
      return writes.values();
    });
    if ((await read()).some(r=>r.dirty)) { again = true; announce('Saved on this device'); }
    else announce('Synced');
  }
  function sync() {
    if (!onlineAccess || !navigator.onLine) { announce('Saved on this device · Offline'); return Promise.resolve(); }
    if (running) return running;
    clearTimeout(retry);
    announce('Syncing…');
    running = exchange().catch(error => {
      announce(error.code === 'PGRST205' ? 'Saved on this device · Cloud setup pending' :
        'Saved on this device · Sync unavailable. Retry when connected.');
      throw error;
    }).finally(() => {
      running = null;
      if (again) { again = false; requestSync(); }
    });
    return running;
  }
  async function syncForBackup() {
    if (onlineAccess && navigator.onLine) {
      try { await sync(); } catch (error) { if (error.code !== 'PGRST205') throw error; }
    }
  }
  async function exportRows() {
    await syncForBackup();
    return reviewCore.checkBackup(await read());
  }
  async function restore(rows) {
    const clean = reviewCore.checkBackup(rows);
    // A newly signed-in device may not have downloaded the account's existing
    // cards yet. Preserve those IDs too when merging a backup.
    await syncForBackup();
    await edit(current => {
      const existing = new Set(current.map(row=>row.id));
      return clean.filter(row=>!existing.has(row.id));
    });
  }
  return {init,read,edit,sync,requestSync,exportRows,restore,events,get status(){return status;}};
})();
