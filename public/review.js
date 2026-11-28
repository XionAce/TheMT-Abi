'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const page = $('review-page'), store = reviewStore, core = reviewCore;
  const offlineShell = document.body.classList.contains('review-offline');
  const grades = ['Again','Hard','Good','Easy'];
  let rows = [], deck = core.defaultDeck, view = 'files', drafts = [], editing;
  let current, revealed = false, snapshot, readVersion = 0, visibleCount = 30, busy = false, imagesPending = 0;
  const blank = () => ({front:'',back:'',frontImage:'',backImage:'',selected:true});
  const text = (tag,value) => Object.assign(document.createElement(tag),{textContent:value});
  const note = message => { ($('rv-editor').open ? $('rv-edit-message') : $('review-message')).textContent = message; };
  function button(label, action) {
    const b = text('button',label);
    b.type = 'button'; b.className = 'soft-btn'; b.onclick = action;
    return b;
  }
  async function act(action) {
    if (busy) return;
    busy = true;
    try { await action(); }
    catch (e) { note(e.name === 'QuotaExceededError' ? 'Device storage is full. Your draft is still here.' : e.message || 'Could not save. Please retry.'); }
    finally { busy = false; }
  }
  const liveCards = records => records.filter(r=>r.kind === 'card' && !r.data.deleted && r.data.deck === deck);
  function selectView(name) {
    view = name;
    for (const b of page.querySelectorAll('[data-review-view]')) {
      const selected = b.dataset.reviewView === name;
      b.setAttribute('aria-pressed',String(selected));
      $('rv-'+b.dataset.reviewView).hidden = !selected;
    }
    render();
  }
  for (const b of page.querySelectorAll('[data-review-view]')) b.onclick = () => selectView(b.dataset.reviewView);
  function showSide(target, card, side) {
    const display=card.type==='cloze' && side==='front' ? card.front.replace(/\{\{c1::[^{}]+\}\}/,'[…]') : card[side];
    target.replaceChildren(text('span',display));
    if (side==='back' && card.source) target.append(text('small',card.source.file+' · p. '+card.source.page+' · “'+card.source.quote+'”'));
    if (card[side+'Image']) {
      const img = new Image(); img.src = card[side+'Image']; img.alt = side === 'front' ? 'Question image' : 'Answer image';
      target.append(img);
    }
  }
  function renderStudy() {
    const next = snapshot.queue[0];
    if (next?.id !== current?.id || next?.stamp !== current?.stamp) revealed = false;
    current = next;
    $('rv-position').textContent = next ? snapshot.queue.length+' available in this deck' :
      liveCards(rows).length ? 'All caught up for now. You can browse your cards anytime.' : 'Your deck is ready. Create cards from files or paste them in Quick-add.';
    if (next) showSide($('rv-question'),next.data,'front'); else $('rv-question').replaceChildren();
    $('rv-reveal').hidden = !next || revealed;
    $('rv-answer').hidden = !next || !revealed;
    $('rv-grades').replaceChildren();
    if (next && revealed) {
      showSide($('rv-answer'),next.data,'back');
      const intervals = core.intervals(snapshot.states.get(next.id),Date.now());
      const previous = snapshot.last?.id;
      for (const [i,label] of grades.entries()) $('rv-grades').append(button(label+' · '+intervals[i],()=>rate(next.id,i+1,previous)));
    }
    $('rv-undo').hidden = !snapshot.last;
  }
  function rate(id, grade, previous) {
    return act(async () => {
      await store.edit(latest => {
        const time = Date.now(), s = core.session(latest,time,deck);
        if (s.queue[0]?.id !== id || s.last?.id !== previous) throw new Error('This session changed. Check the current card.');
        return [core.make('rating',{card:id,grade,at:time,day:core.studyDay(time)})];
      });
      revealed = false; await refresh(); note('Rating saved.');
      (current ? $('rv-reveal') : $('rv-undo')).focus();
    });
  }
  $('rv-reveal').onclick = () => { revealed = true; renderStudy(); $('rv-grades').firstElementChild?.focus(); };
  $('rv-undo').onclick = () => act(async () => {
    const target = snapshot.last?.id;
    await store.edit(latest => {
      if (!target || core.session(latest,Date.now()).last?.id !== target) throw new Error('The last rating has changed.');
      return [core.make('undo',{target})];
    });
    revealed = false; await refresh(); note('Last rating undone.');
  });
  function render() {
    const decks = [[core.defaultDeck,'My first deck'],...rows.filter(r=>r.kind === 'deck').map(r=>[r.id,r.data.name]).sort((a,b)=>a[1].localeCompare(b[1]))];
    $('review-deck').replaceChildren(...decks.map(([id,name])=>new Option(name,id)));
    $('review-deck').value = deck;
    snapshot = core.session(rows,Date.now(),deck);
    $('review-progress').textContent = snapshot.reviewed+(snapshot.reviewed===1 ? ' review' : ' reviews')+' this study day · '+snapshot.introduced+' of '+snapshot.limit+' new '+(snapshot.limit===1 ? 'card' : 'cards')+
      (snapshot.streak ? ' · '+snapshot.streak+'-day streak' : '');
    if (document.activeElement !== $('rv-limit')) $('rv-limit').value = snapshot.limit;
    if (view === 'study') renderStudy();
    if (view === 'library') renderLibrary();
    if (view === 'add') draftCounts();
  }
  async function refresh() {
    const version = ++readVersion;
    const result = await store.read();
    if (version !== readVersion) return;
    rows = result;
    render();
  }
  $('review-deck').onchange = e => { deck = e.target.value; revealed = false; visibleCount = 30; render(); };
  $('review-new-deck').onsubmit = e => {
    e.preventDefault();
    act(async () => {
      const name = $('review-deck-name').value.trim();
      if (!name) throw new Error('Enter a deck name.');
      const entry = core.make('deck',{name});
      await store.edit(latest => {
        if ([{data:{name:'My first deck'}},...latest.filter(r=>r.kind==='deck')].some(r=>r.data.name.toLowerCase() === name.toLowerCase()))
          throw new Error('A deck already has that name.');
        return [entry];
      });
      deck = entry.id; $('review-deck-name').value = ''; await refresh(); note('Deck created.');
    });
  };
  $('rv-limit-form').onsubmit = e => {
    e.preventDefault();
    act(async () => {
      const limit = $('rv-limit').valueAsNumber;
      await store.edit(latest=>[core.make('settings',{limit},'limit',latest.find(r=>r.id==='limit'))]);
      await refresh(); note('Daily new-card limit saved.');
    });
  };

  /** Decode locally, remove metadata and cap both pixel dimensions and encoded bytes. */
  async function compressImage(file) {
    if (!file || !/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.type)) throw new Error('Choose a PNG, JPEG, WebP, GIF or AVIF image.');
    if (file.size > 20*1024*1024) throw new Error('Choose an image smaller than 20 MB.');
    const src = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = src; await img.decode();
      let scale = Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
      for (let i=0;i<6;i++) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1,Math.round(img.naturalWidth*scale));
        canvas.height = Math.max(1,Math.round(img.naturalHeight*scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white'; ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        const result = canvas.toDataURL('image/jpeg',0.8);
        if (result.length <= 450000 && result.startsWith('data:image/jpeg;')) return result;
        scale *= 0.75;
      }
      throw new Error('Could not shrink the image enough. Try a cropped copy.');
    } finally { URL.revokeObjectURL(src); }
  }
  function pastedImage(clipboard) {
    return [...clipboard.items].find(i=>i.kind==='file' && i.type.startsWith('image/'))?.getAsFile() ||
      [...clipboard.files].find(f=>f.type.startsWith('image/'));
  }
  async function attach(file,draft,side,paint) {
    imagesPending++; draftCounts();
    try { draft[side+'Image'] = await compressImage(file); paint(); note('Image attached.'); }
    catch (e) { note(e.message || 'Could not open this image. Try Choose image.'); }
    finally { imagesPending--; draftCounts(); }
  }
  function fields(draft,onEdit) {
    const grid = document.createElement('div'); grid.className = 'rv-fields';
    for (const side of ['front','back']) {
      const section = document.createElement('div'), name = side === 'front' ? 'Front' : 'Back';
      const label = text('label',name);
      const area = document.createElement('textarea'); area.maxLength = 8000; area.rows = 2; area.value = draft[side];
      area.oninput = () => { draft[side] = area.value; if (onEdit) onEdit(side,area.value); else draftCounts(); };
      label.append(area);
      if (onEdit) {section.append(label);grid.append(section);continue;}
      const imageLabel = text('label','Choose image for '+side);
      const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
      imageLabel.append(file);
      const preview = document.createElement('div');
      function paint() {
        preview.replaceChildren();
        if (!draft[side+'Image']) return;
        const img = new Image(); img.src = draft[side+'Image']; img.alt = name+' attachment';
        preview.append(img, button('Remove '+side+' image',()=>{draft[side+'Image']='';paint();draftCounts();}));
      }
      area.onpaste = e => {
        const pic = pastedImage(e.clipboardData);
        if (pic) { e.preventDefault(); attach(pic,draft,side,paint); }
      };
      file.onchange = () => { if (file.files[0]) attach(file.files[0],draft,side,paint); file.value=''; };
      paint(); section.append(label,preview,imageLabel); grid.append(section);
    }
    return grid;
  }
  function inspectDrafts(records) {
    const seen = new Set(liveCards(records).map(r=>core.signature(r.data)));
    return drafts.map(d => {
      if (!d.selected) return 'Skipped';
      if (!(d.front.trim() || d.frontImage) || !(d.back.trim() || d.backImage)) return 'Complete both sides';
      if (d.front.length>8000 || d.back.length>8000) return 'Shorten each side to 8,000 characters';
      const key = core.signature(d);
      if (seen.has(key)) return 'Duplicate · skipped';
      seen.add(key); return '';
    });
  }
  function draftCounts() {
    const issues = inspectDrafts(rows); let count = 0;
    for (const [i,msg] of issues.entries()) {
      if (!msg) count++;
      const hint = drafts[i].hint;
      if (hint && hint.textContent !== msg) hint.textContent = msg;
    }
    $('rv-save').hidden = !drafts.length;
    $('rv-save').disabled = !count || Boolean(imagesPending);
    $('rv-save').textContent = 'Save '+count+(count === 1 ? ' card' : ' cards');
  }
  function drawDrafts() {
    const list = document.createDocumentFragment();
    for (const [i,d] of drafts.entries()) {
      const row = document.createElement('div'); row.className = 'rv-draft';
      const header = document.createElement('header'), label = document.createElement('label');
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = d.selected;
      check.onchange = () => {d.selected=check.checked;draftCounts();}; label.append(check,'Row '+(i+1));
      header.append(label,button('Remove row '+(i+1),()=>{drafts=drafts.filter(x=>x!==d);drawDrafts();}));
      d.hint = text('p',''); row.append(header,fields(d),d.hint); list.append(row);
    }
    $('rv-drafts').replaceChildren(list); draftCounts();
  }
  function addRows(pairs) {
    drafts.push(...pairs.map(pair=>({...blank(),...pair}))); drawDrafts();
  }
  $('rv-preview').onclick = () => {
    const pairs = core.parseLines($('rv-paste').value);
    if (!pairs.length) { note('Paste text first or add a blank row.'); return; }
    addRows(pairs); $('rv-paste').value=''; note('Check the rows, then save the cards you want.');
  };
  $('rv-blank').onclick = () => { addRows([{}]); $('rv-drafts').lastElementChild.querySelector('textarea').focus(); };
  $('rv-paste').onpaste = e => {
    const clip = e.clipboardData, markup = clip.getData('text/html');
    // Template contents are inert. Never mount clipboard markup or load remote images.
    if (markup) {
      const template = document.createElement('template'); template.innerHTML = markup;
      const table = template.content.querySelector('table');
      if (table) {
        const pairs = [...table.rows].map(row=>[...row.cells].map(c=>c.textContent.trim()))
          .filter(cells=>cells.some(Boolean)).map(cells=>({front:cells[0],back:cells.slice(1).join(' · ')}));
        if (pairs.length) { e.preventDefault(); addRows(pairs); note('Table added to preview.'); return; }
      }
    }
    const pic = pastedImage(clip);
    if (pic) { e.preventDefault(); const d=blank(); drafts.push(d); drawDrafts(); attach(pic,d,'front',drawDrafts); }
    else if (/<img\b/i.test(markup)) note('This app supplied an image link. Use Copy Image or Choose image to attach the picture.');
  };
  $('rv-save').onclick = () => act(async () => {
    if (imagesPending) return;
    let saved;
    await store.edit(latest=>{
      const issues = inspectDrafts(latest);
      saved = drafts.filter((_,i)=>!issues[i]);
      return saved.map(d=>core.make('card',{deck,front:d.front.trim(),back:d.back.trim(),frontImage:d.frontImage,backImage:d.backImage}));
    });
    drafts=drafts.filter(d=>!saved.includes(d)); drawDrafts(); await refresh(); note(saved.length+' cards saved.');
  });
  function editCard(row) {
    editing = {id:row.id,draft:{...row.data}};
    $('rv-edit-fields').replaceChildren(fields(editing.draft)); $('rv-edit-message').textContent='';
    $('rv-editor').showModal();
  }
  $('rv-edit-cancel').onclick = () => $('rv-editor').close();
  $('rv-edit-save').onclick = () => act(async () => {
    if (imagesPending) {note('Wait for your image to finish.');return;}
    const {id,draft} = editing;
    await store.edit(latest=>{
      const old = latest.find(r=>r.id===id);
      if (!old || old.data.deleted) throw new Error('This card was deleted.');
      if (!(draft.front.trim() || draft.frontImage) || !(draft.back.trim() || draft.backImage)) throw new Error('Complete both sides before saving.');
      return [core.make('card',draft,id,old)];
    });
    $('rv-editor').close(); await refresh(); note('Card updated.');
  });
  function renderLibrary() {
    const q = $('rv-search').value.trim().toLowerCase();
    const cards = liveCards(rows).filter(r=>(r.data.front+' '+r.data.back).toLowerCase().includes(q));
    const list = document.createDocumentFragment();
    if (!cards.length) list.append(text('p',q ? 'No matching cards.' : 'Cards you save in this deck will appear here.'));
    for (const row of cards.slice(0,visibleCount)) {
      const item = document.createElement('div'); item.className = 'rv-result';
      const del = button('Delete',()=>{
        if (del.textContent !== 'Confirm delete') { del.textContent='Confirm delete';return; }
        act(async ()=>{
          await store.edit(latest=>[core.make('card',{deleted:true},row.id,latest.find(r=>r.id===row.id))]);
          await refresh(); note('Card deleted.');
        });
      });
      item.append(text('strong',row.data.front || 'Image question'),text('p',row.data.back || 'Image answer'),button('Edit',()=>editCard(row)),del);list.append(item);
    }
    $('rv-results').replaceChildren(list); $('rv-more').hidden = cards.length <= visibleCount;
  }
  $('rv-search').oninput = () => { visibleCount=30; renderLibrary(); };
  $('rv-more').onclick = () => { visibleCount+=30;renderLibrary(); };
  let trusted = false;
  function trustLabel() {
    $('rv-trust').textContent = trusted ? 'Disable offline reopening' : 'Enable offline reopening on this device';
  }
  $('rv-trust').hidden = offlineShell;
  $('rv-trust').onclick = () => act(async () => {
    if (trusted) {
      await storageService.set('offline-review',null);
      trusted = false; trustLabel();
      $('rv-persistence').textContent = 'Offline reopening disabled.';
      return;
    }
    if (!('serviceWorker' in navigator)) throw new Error('Offline reopening needs a browser with service worker support.');
    const persistence = navigator.storage?.persist?.().catch(()=>false);
    const reg = await navigator.serviceWorker.register('/sw.js');
    if (!reg.active) {
      await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Offline files are still installing. Try again.')),20000))]);
    }
    await storageService.enableOfflineReview($('brand-name').textContent);
    trusted = true; trustLabel();
    $('rv-persistence').textContent = await persistence ? 'Offline reopening enabled. Storage persistence granted.' :
      'Offline reopening enabled. Your browser manages storage space; keep a backup.';
  });
  $('rv-sync').hidden = offlineShell;
  $('rv-sync').onclick = () => act(async()=>{ await store.sync(); await refresh(); });
  store.events.addEventListener('status',()=>{ $('rv-sync-status').textContent=store.status; });
  store.events.addEventListener('change',()=>refresh().catch(e=>note(e.message)));
  async function enter() {
    if (!(offlineShell || location.hash === '#review')) return;
    try {
      await refresh();
      trusted = Boolean(await storageService.get('offline-review')); trustLabel();
      $('rv-sync-status').textContent = navigator.onLine && !offlineShell ? store.status : 'Saved on this device · Offline';
      if (!offlineShell) store.requestSync();
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
      if (ios && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches && !await storageService.get('review-ios-tip')) {
        $('rv-ios').hidden=false; await storageService.set('review-ios-tip',true);
      }
    } catch { note('Could not open device storage. Check available space and retry.'); }
  }
  window.addEventListener('hashchange',enter);
  // Retry the persisted outbox after temporary server failures, even without a new edit.
  setInterval(()=>{ if (!document.hidden && navigator.onLine && !offlineShell &&
    store.status.includes('Sync unavailable')) store.requestSync(); },60000);
  window.addEventListener('online',()=>{ if (!offlineShell) store.requestSync(); });
  window.addEventListener('offline',()=>{ $('rv-sync-status').textContent='Saved on this device · Offline'; });
  document.addEventListener('visibilitychange',()=>{ if (!document.hidden) enter(); });
  setInterval(()=>{ if (!document.hidden && !page.hidden && view==='study' && !revealed) render(); },30000);
  if (!offlineShell && location.hash !== '#review') {
    // A queued edit should also resume when the PWA reopens on Home.
    store.read().then(records => { if (records.some(r=>r.dirty)) store.requestSync(); }).catch(()=>{});
  }
  const uploads=initReviewUpload({fields,button,text,selectDeck:async id=>{
    deck=id; await refresh(); selectView('study');
  }});
  function openUploads() {
    if (offlineShell || location.hash==='#review') uploads.open().catch(e=>note(e.message));
  }
  window.addEventListener('hashchange',openUploads);
  window.addEventListener('online',openUploads);
  enter(); openUploads();
})();
