'use strict';

// Version one contains study records only. Project each record onto its public
// fields so account sessions, Spotify tokens, and retired features stay private.
const studyBackup = (() => {
  function check(condition) {
    if (!condition) throw new Error('This file is not a valid study backup.');
  }
  function id(value) {
    check(typeof value === 'string' && value.length > 0 && value.length <= 200);
    return value;
  }
  function string(value) { check(typeof value === 'string'); return value; }
  function number(value) { check(Number.isFinite(value) && value >= 0); return value; }
  function unique(items, convert) {
    check(Array.isArray(items));
    const rows = items.map(convert);
    check(new Set(rows.map(row => row.id)).size === rows.length);
    return rows;
  }
  function focus(value) {
    if (value === null) return null;
    const t = value.timer;
    check(t && ['focus','short','long'].includes(t.mode));
    const timer = {mode:t.mode, remaining:number(t.remaining), endsAt:t.endsAt === null ? null : number(t.endsAt)};
    if (t.sessionId != null) timer.sessionId = id(t.sessionId);
    if (t.eventId != null) timer.eventId = id(t.eventId);
    if (t.title != null) timer.title = string(t.title);
    const intentions = unique(value.intentions, i => {
      check(typeof i.done === 'boolean');
      return {id:id(i.id), text:string(i.text), done:i.done};
    });
    const sessions = unique(value.sessions ?? [], s => ({
      id:id(s.id), title:string(s.title), minutes:number(s.minutes), completedAt:number(s.completedAt),
      eventId:s.eventId == null ? null : id(s.eventId),
    }));
    return { timer, intentions, sessions };
  }
  function parse(file) {
    check(['AbiVerse','MTVerse'].includes(file?.app) && [1,2].includes(file.version));
    const events = unique(file.events, e => {
      check(validEvent(e));
      const event = {id:id(e.id), title:e.title, date:e.date, time:e.time, kind:e.kind, notes:e.notes};
      if (e.weekly) event.weekly = {days:[...e.weekly.days], until:e.weekly.until};
      return event;
    });
    const doodles = unique(file.doodles, d => {
      check(typeof d.image === 'string' && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(d.image));
      check(number(d.x) <= 1 && number(d.y) <= 1);
      return {id:id(d.id), created:number(d.created), x:d.x, y:d.y, image:d.image, note:string(d.note)};
    });
    const backup = {app:'MTVerse',version:file.version,events,doodles,focus:focus(file.focus)};
    if (file.version === 2) backup.review = reviewCore.checkBackup(file.review);
    return backup;
  }
  return { parse };
})();
