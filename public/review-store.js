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
      const open = indexedDB.open('mtverse-review-' + owner,2);
      open.onupgradeneeded = () => {
        for (const name of ['records','sources','sections'])
          if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name,{keyPath:'id'});
      };
      open.onsuccess = () => {
        open.result.onversionchange = () => { open.result.close(); dbPromise=null; };
        resolve(open.result);
      };
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
  // Drafts and source blobs never enter the cloud outbox. Mutations read the
  // latest section inside the transaction so edits survive other tabs.
  async function localDrafts(stores,mode,operation) {
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(stores,mode);
      let value,reason;
      const done=result=>{value=result;};
      const fail=err=>{reason=err;tx.abort();};
      tx.oncomplete=()=>resolve(value);
      tx.onabort=()=>reject(reason || tx.error || new Error('Device save interrupted.'));
      operation(tx,done,fail);
    });
  }
  const allSections=()=>localDrafts(['sections'],'readonly',(tx,done)=>{
    const q=tx.objectStore('sections').getAll(); q.onsuccess=()=>done(q.result);
  });
  const getSource=id=>localDrafts(['sources'],'readonly',(tx,done)=>{
    const q=tx.objectStore('sources').get(id); q.onsuccess=()=>done(q.result?.file);
  });
  const addFile=(id,file,sections)=>localDrafts(['sources','sections'],'readwrite',(tx)=>{
    tx.objectStore('sources').put({id,file});
    const store=tx.objectStore('sections');
    for (const section of sections) {
      const q=store.get(section.id); q.onsuccess=()=>{if (!q.result) store.add(section);};
    }
  });
  const updateSection=(id,change)=>localDrafts(['sections'],'readwrite',(tx,done,fail)=>{
    const store=tx.objectStore('sections'), q=store.get(id);
    q.onsuccess=()=>{try {
      if (!q.result) return;
      const row=change(q.result);
      if (row) {store.put(row);done(row);}
    } catch(e) {fail(e);}};
  });
  const clearDrafts=()=>localDrafts(['sections','sources'],'readwrite',tx=>{
    tx.objectStore('sections').clear(); tx.objectStore('sources').clear();
  });
  const restoreDrafts=sections=>localDrafts(['records','sections'],'readwrite',tx=>{
    const records=tx.objectStore('records').getAllKeys(), store=tx.objectStore('sections');
    records.onsuccess=()=>{
      const approved=new Set(records.result);
      for (const incoming of sections) {
        const read=store.get(incoming.id);
        read.onsuccess=()=>{
          const existing=read.result, cards=existing?.cards || [];
          const known=new Set(cards.map(c=>c.id));
          const extra=incoming.cards.filter(c=>!approved.has(c.id) && !known.has(c.id));
          if (extra.length) store.put({...incoming,...existing,state:'ready',lease:null,cards:[...cards,...extra]});
        };
      }
    };
  });
  return {init,read,edit,sync,requestSync,exportRows,restore,events,allSections,getSource,addFile,updateSection,clearDrafts,restoreDrafts,get status(){return status;}};
})();
