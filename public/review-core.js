'use strict';

// FSRS state is derived from the immutable rating log. No editable copy can
// overwrite a review from another device. An undo appends a reference to a rating.
const reviewCore = (() => {
  const lib = typeof module === 'object' ? require('ts-fsrs') : globalThis.FSRS;
  const scheduler = lib.fsrs({enable_fuzz:false});
  const defaultDeck = 'inbox';
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  /** @typedef {{deck:string, front:string, back:string, frontImage:string, backImage:string}} CardContent */
  /** @typedef {{card:string, grade:number, at:number, day:string}} RatingEvent */
  /** @typedef {{id:string,kind:'card'|'deck'|'settings'|'rating'|'undo',stamp:string,data:object}} ReviewRow */
  /** @param {string} value */
  const validId = value => typeof value === 'string' && uuid.test(value);
  /** @param {string} text */
  function parseLines(text) {
    return text.replace(/\r\n?/g,'\n').split('\n').filter(line => line.trim()).map(line => {
      const match = /::|\t/.exec(line);
      if (!match) return {front:line.trim(),back:''};
      return {front:line.slice(0,match.index).trim(),back:line.slice(match.index+match[0].length).trim()};
    });
  }
  const norm = text => text.trim().replace(/\s+/g,' ').toLowerCase();
  const signature = card => JSON.stringify([norm(card.front),norm(card.back),card.frontImage || '',card.backImage || '']);
  /** A study day begins at 04:00 wall-clock time, including DST transitions. */
  function studyDay(time) {
    const d = new Date(time);
    if (d.getHours() < 4) d.setDate(d.getDate()-1);
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  }
  const immutable = kind => kind === 'rating' || kind === 'undo';
  function make(kind, data, id = crypto.randomUUID(), previous) {
    const ms = Math.max(Date.now(), previous ? Date.parse(previous.stamp.slice(0,24))+1 : 0);
    return {kind,id,stamp:new Date(ms).toISOString()+'~'+crypto.randomUUID(),data};
  }
  const imageOK = value => value === '' || (typeof value === 'string' && value.length <= 450000 &&
    /^data:image\/(?:jpeg;base64,\/9j\/|webp;base64,UklGR)[A-Za-z0-9+/]+=*$/.test(value));
  function validate(row) {
    const {id,kind,stamp,data:d} = row || {};
    const text = (v,max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
    if (!d || typeof d !== 'object' || Array.isArray(d) || typeof stamp !== 'string' ||
        stamp.length !== 61 || stamp[24] !== '~' || !uuid.test(stamp.slice(25)) ||
        !Number.isFinite(Date.parse(stamp.slice(0,24))) || (!validId(id) && id !== 'limit')) return false;
    if (kind === 'settings') return id === 'limit' && Number.isInteger(d.limit) && d.limit >= 0 && d.limit <= 999;
    if (id === 'limit') return false;
    if (kind === 'deck') return text(d.name,100);
    if (kind === 'undo') return validId(d.target);
    if (kind === 'rating') return validId(d.card) && Number.isInteger(d.grade) && d.grade >= 1 && d.grade <= 4 &&
      Number.isSafeInteger(d.at) && d.at > 0 && d.at < 253402300800000 && /^\d{4}-\d{2}-\d{2}$/.test(d.day);
    if (kind !== 'card') return false;
    if (d.deleted === true) return true;
    if (d.type !== undefined && !['basic','cloze'].includes(d.type)) return false;
    if (d.type === 'cloze' && !validCloze(d.front,d.back)) return false;
    if (d.source !== undefined && !(text(d.source?.file,255) && text(d.source?.quote,360) &&
        Number.isInteger(d.source?.page) && d.source.page>=1 && d.source.page<=50)) return false;
    return (d.deck === defaultDeck || validId(d.deck)) && typeof d.front === 'string' && d.front.length <= 8000 &&
      typeof d.back === 'string' && d.back.length <= 8000 && imageOK(d.frontImage) && imageOK(d.backImage) &&
      Boolean(d.front.trim() || d.frontImage) && Boolean(d.back.trim() || d.backImage);
  }
  function checkBackup(rows) {
    if (!Array.isArray(rows) || !rows.every(validate) || new Set(rows.map(r=>r.id)).size !== rows.length)
      throw new Error('Invalid Review records in backup.');
    return rows.map(({id,kind,stamp,data}) => {
      const keys = {card:data.deleted === true ? ['deleted'] : ['deck','front','back','frontImage','backImage'],
        deck:['name'],settings:['limit'],rating:['card','grade','at','day'],undo:['target']};
      const content=Object.fromEntries(keys[kind].map(key=>[key,data[key]]));
      if (kind==='card' && !data.deleted) {
        if (data.type) content.type=data.type;
        if (data.source) {
          const {file,page,quote}=data.source;
          content.source={file,page,quote};
        }
      }
      return {id,kind,stamp,data:content};
    });
  }
  /** @param {ReviewRow[]} rows @param {Date|number} now @param {string} deck */
  function session(rows, now, deck = '') {
    const day = studyDay(now);
    const undone = new Set(rows.filter(r=>r.kind === 'undo').map(r=>r.data.target));
    const history = rows.filter(r=>r.kind === 'rating' && !undone.has(r.id))
      .sort((a,b)=>a.data.at-b.data.at || a.id.localeCompare(b.id));
    const states = new Map(), days = new Set();
    let introduced = 0, reviewed = 0;
    for (const {data:r} of history) {
      const prev = states.get(r.card);
      if (r.day === day) { reviewed++; if (!prev) introduced++; }
      days.add(r.day);
      const card = prev || lib.createEmptyCard(new Date(r.at));
      states.set(r.card,scheduler.next(card,new Date(r.at),r.grade).card);
    }
    const limit = rows.find(r=>r.kind === 'settings')?.data.limit ?? 15;
    const cards = rows.filter(r=>r.kind === 'card' && !r.data.deleted && (!deck || r.data.deck === deck));
    const due = cards.filter(r => states.has(r.id) && +states.get(r.id).due <= +now)
      .sort((a,b)=>states.get(a.id).due-states.get(b.id).due || a.id.localeCompare(b.id));
    const fresh = cards.filter(r=>!states.has(r.id)).sort((a,b)=>a.stamp.localeCompare(b.stamp))
      .slice(0,Math.max(0,limit-introduced));
    const cursor = new Date(day+'T12:00:00');
    if (!days.has(day)) cursor.setDate(cursor.getDate()-1);
    let streak = 0;
    while (days.has(studyDay(cursor))) { streak++; cursor.setDate(cursor.getDate()-1); }
    return {queue:[...due,...fresh], states, introduced, reviewed, limit, streak, last:history.at(-1)};
  }
  /** @param {import('ts-fsrs').Card|undefined} state @param {number} time */
  function intervals(state, time) {
    const now = new Date(time);
    return [1,2,3,4].map(grade => {
      const due = scheduler.next(state || lib.createEmptyCard(now),now,grade).card.due;
      const minutes = Math.max(1,Math.round((due-now)/60000));
      return minutes < 60 ? minutes+' min' : minutes < 1440 ? Math.round(minutes/60)+' hr' : Math.round(minutes/1440)+' d';
    });
  }
  function validCloze(front,back) {
    const match=typeof front==='string' && /\{\{c1::([^{}]+)\}\}/.exec(front);
    return Boolean(match && match[1]===back && !/[{}]/.test(front.replace(match[0],'')));
  }
  // Draft backups carry editable text and provenance. Original files remain on
  // the device; matching a reselected file by SHA-256 restores source viewing.
  function backupDrafts(sections) {
    if (!Array.isArray(sections)) throw new Error('Invalid draft backup.');
    const ids=new Set();
    return sections.map(s=>{
      if (!s || !/^[a-f0-9]{64}$/.test(s.fileId) || s.id!==s.fileId+'-'+s.start+'-'+s.end ||
          ids.has(s.id) || !validId(s.deck) || typeof s.name!=='string' || !s.name.trim() || s.name.length>255 ||
          typeof s.pdf!=='boolean' || !Number.isInteger(s.start) || !Number.isInteger(s.end) ||
          s.start<1 || s.end<s.start || s.end>50 || s.end-s.start>=5 || !Array.isArray(s.cards) || s.cards.length>25)
        throw new Error('Invalid draft section in backup.');
      ids.add(s.id);
      const cards=s.cards.map(c=>{
        if (!c || !validId(c.id) || ids.has(c.id) || !['basic','cloze'].includes(c.type) ||
            !Number.isInteger(c.sourcePage) || c.sourcePage<s.start || c.sourcePage>s.end ||
            !['front','back','quote'].every(k=>typeof c[k]==='string' && c[k].length<=(k==='quote'?360:8000)) ||
            !c.quote.trim()) throw new Error('Invalid draft card in backup.');
        ids.add(c.id);
        const {id,type,front,back,sourcePage,quote}=c;
        return {id,type,front,back,sourcePage,quote,selected:c.selected!==false};
      });
      const {id,fileId,deck,name,start,end,pdf}=s;
      return {id,fileId,deck,name,start,end,pdf,cards,approved:s.approved===true,
        created:Number.isSafeInteger(s.created)?s.created:0,state:'ready',
        skipped:Number.isSafeInteger(s.skipped)&&s.skipped>=0?s.skipped:0};
    });
  }
  return {defaultDeck,parseLines,signature,studyDay,validate,validCloze,checkBackup,backupDrafts,immutable,make,session,intervals};
})();
if (typeof module === 'object') module.exports = reviewCore;
