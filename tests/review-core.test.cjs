'use strict';
process.env.TZ = 'America/New_York';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../public/review-core');
const card = (i,deck='inbox') => core.make('card',{deck,front:'Term '+i,back:'Definition '+i,frontImage:'',backImage:''});
const rate = (c,time,grade=3) => core.make('rating',{card:c.id,at:+time,day:core.studyDay(time),grade});
const limit = n => core.make('settings',{limit:n},'limit');

test('quick-add preserves incomplete rows for correction, ignores blank lines and splits once',()=>{
  assert.deepEqual(core.parseLines('  A  ::  first :: second\r\n \nB\t value \nC::\n:: D\nJust text'),[
    {front:'A',back:'first :: second'},{front:'B',back:'value'},{front:'C',back:''},
    {front:'',back:'D'},{front:'Just text',back:''}]);
  assert.equal(core.signature({front:' RBC ',back:'red  cell'}),core.signature({front:'rbc',back:'Red Cell'}));
});
test('04:00 local boundary including daylight-saving clock changes',()=>{
  for (const [month,date] of [[2,8],[10,1]]) {
    const last = new Date(2026,month,date,3,59,59), next = new Date(2026,month,date,4);
    assert.notEqual(core.studyDay(last),core.studyDay(next));
    assert.equal(core.studyDay(last),core.studyDay(new Date(2026,month,date-1,19)));
  }
});
test('the account daily allowance spans decks, keeps due repeats and rolls over at 04:00',()=>{
  const time=new Date(2026,3,8,3,20), cards=Array.from({length:200},(_,i)=>card(i));
  const other=card(201,crypto.randomUUID());
  assert.equal(core.session(cards,time).queue.length,15);
  const records=[...cards,other,limit(1),rate(other,time)];
  assert.equal(core.session(records,time,'inbox').queue.length,0);
  const later=new Date(+time+20*60000);
  assert.deepEqual(core.session(records,later).queue.map(c=>c.id),[other.id]);
  assert.equal(core.session(records,new Date(2026,3,8,4),'inbox').queue.length,1);
});
test('undo is append-only; replay removes its scheduling and progress effects',()=>{
  const c=card(0), time=new Date(2026,6,1,12), r=rate(c,time,4), u=core.make('undo',{target:r.id});
  const studied=core.session([c,r],time), undone=core.session([u,c,r],time);
  assert.equal(studied.reviewed,1);assert.equal(studied.introduced,1);assert.equal(studied.streak,1);
  assert(studied.states.get(c.id).due>time);
  assert.equal(undone.reviewed,0);assert.equal(undone.queue[0].id,c.id);assert.equal(undone.last,undefined);
  assert.equal(core.intervals(undefined,time).length,4);
});
test('replay order is independent of sync arrival order, and repeat ratings introduce a card only once',()=>{
  const c=card(0), t=new Date(2026,6,1,12), r1=rate(c,t,1), r2=rate(c,+t+60000);
  const s=core.session([r2,c,r1],t), ordered=core.session([c,r1,r2],t);
  assert.equal(s.introduced,1);assert.deepEqual(s.states,ordered.states);
  assert(core.make('card',c.data,c.id,c).stamp>c.stamp);
});
test('version 1 backups still parse; v2 round-trips history, images, settings and tombstones',()=>{
  const context=vm.createContext({reviewCore:core});
  const backup=vm.runInContext(fs.readFileSync(require.resolve('../public/backup.js'),'utf8')+'\nstudyBackup',context);
  const old={app:'AbiVerse',version:1,events:[],doodles:[],focus:null};
  assert.equal(backup.parse(old).version,1);
  const c=card(0);c.data.frontImage='data:image/jpeg;base64,/9j/abcd';
  const r=rate(c,Date.now()), records=[c,r,core.make('undo',{target:r.id}),limit(0),core.make('card',{deleted:true})];
  const raw={...old,version:2,review:records.map(row=>({...row,dirty:true}))};
  assert.deepEqual(backup.parse(raw).review,records);
  assert.throws(()=>backup.parse({...raw,review:[c,c]}));
  assert.throws(()=>backup.parse({...raw,review:[{...c,data:{...c.data,frontImage:'https://example.test/tracker'}}]}));
});
