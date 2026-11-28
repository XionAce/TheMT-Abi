'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ai=require('../server/flashcards.cjs');
const handler=require('../api/draft-cards.js');
const core=require('../public/review-core.js');
const basic={front:'What is in the Mica tray?',back:'Amber tiles',quote:'Mica tray holds amber tiles.',sourcePage:1,type:'basic'};
const cloze={...basic,front:'The Mica tray holds {{c1::amber tiles}}.',back:'amber tiles',type:'cloze'};
const part={encoded:fs.readFileSync(__dirname+'/fixtures/flashcards/note.png').toString('base64'),start:1,pages:1,mime:'image/png'};

test('page allowance defaults to 250 and rejects invalid overrides',t=>{
  const key='AI_DAILY_PAGE_LIMIT',old=process.env[key];
  t.after(()=>{if(old===undefined) delete process.env[key];else process.env[key]=old;});
  delete process.env[key];assert.equal(ai.config().daily,250);
  process.env[key]='12';assert.equal(ai.config().daily,12);
  process.env[key]='0';assert.throws(()=>ai.config(),/limit/);
});

test('validates model output, drops duplicates, rejects invalid pages, cloze and missing evidence',()=>{
  const bad=[{...basic,sourcePage:2},{...basic,quote:''},{...cloze,back:'gold'},{...cloze,front:cloze.front+' {{c1::other}}'}];
  assert.deepEqual(ai.validateCards({cards:[basic,cloze,basic,...bad]},1),{cards:[basic,cloze],skipped:5});
  assert.deepEqual(ai.validateCards({cards:[]},1),{cards:[],skipped:0});
  assert.throws(()=>ai.validateCards({results:[]},1));
});
test('checks actual PDF page counts, accepted bytes, size and page bounds',async()=>{
  const pdf={mime:'application/pdf',encoded:fs.readFileSync(__dirname+'/fixtures/flashcards/lecture.pdf').toString('base64'),start:48,pages:3};
  assert.deepEqual(await ai.attachment(pdf),pdf);
  for (const wrong of [{...pdf,pages:1},{...pdf,start:49},{...part,pages:2},{...part,mime:'image/jpeg'},
    {...part,encoded:'!!!!'},{...part,encoded:'A'.repeat(4000001)}]) await assert.rejects(ai.attachment(wrong));
});
test('source metadata survives v2 review rows; drafts can be backed up in the middle of editing',()=>{
  const row=core.make('card',{front:cloze.front,back:cloze.back,type:'cloze',deck:'inbox',frontImage:'',backImage:'',
    source:{file:'Lecture.pdf',page:4,quote:cloze.quote}});
  assert.deepEqual(core.checkBackup([row]),[row]);
  assert.equal(core.validate({...row,data:{...row.data,back:'wrong'}}),false);
  const hash='a'.repeat(64), draft={id:hash+'-1-3',fileId:hash,name:'Lecture.pdf',deck:crypto.randomUUID(),start:1,end:3,
    pdf:true,cards:[{...cloze,id:crypto.randomUUID(),front:'',selected:false}],created:5,state:'ready'};
  const [clean]=core.backupDrafts([draft]);
  assert.deepEqual(clean.cards,draft.cards);
  assert.throws(()=>core.backupDrafts([{...draft,end:55}]));
  const vm=require('node:vm');
  const backup=vm.runInNewContext(fs.readFileSync(require.resolve('../public/backup.js'),'utf8')+'\nstudyBackup',{reviewCore:core});
  const parsed=backup.parse({app:'MTVerse',version:3,focus:null,events:[],doodles:[],review:[row],drafts:[draft]});
  assert.deepEqual(parsed.review,[row]);assert.deepEqual(parsed.drafts,[clean]);
});
test('all three adapters enforce the input budget and pass native visuals; billable reasoning is recorded',async t=>{
  const original=global.fetch;t.after(()=>{global.fetch=original;});
  for (const provider of ['gemini','claude','openai']) {
    const cfg=ai.config(provider,ai.providers[provider].model);
    const previous=process.env[cfg.key];process.env[cfg.key]='test-key';
    t.after(()=>{if(previous===undefined) delete process.env[cfg.key];else process.env[cfg.key]=previous;});
    let count=300,calls=0;
    global.fetch=async(url,opt)=>{
      const body=JSON.parse(opt.body);assert.ok(JSON.stringify(body).includes(part.encoded));
      if (/countTokens|count_tokens|input_tokens/.test(url)) return Response.json({totalTokens:count,input_tokens:count});
      calls++;
      const output=JSON.stringify({cards:[basic]});
      return Response.json({candidates:[{content:{parts:[{text:output}]}}],usageMetadata:{promptTokenCount:300,candidatesTokenCount:26,thoughtsTokenCount:4},
        content:[{type:'text',text:output}],output:[{content:[{type:'output_text',text:output}]}],
        usage:{input_tokens:300,output_tokens:30}});
    };
    assert.deepEqual((await ai.generate(cfg,part)).cards,[basic]);
    count=ai.limits.input+1;await assert.rejects(ai.generate(cfg,part),/budget/);assert.equal(calls,1);
  }
});
test('endpoint verifies bearer identity and uses encrypted cached replies without a second model call',async t=>{
  const previous=global.fetch;t.after(()=>{global.fetch=previous;});
  for(const [k,v] of Object.entries({AI_PROVIDER:'gemini',AI_MODEL:'test-model',GEMINI_API_KEY:'test',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-secret'})) {
    const old=process.env[k];process.env[k]=v;t.after(()=>{if(old===undefined) delete process.env[k];else process.env[k]=old;});
  }
  let reply,calls=0,state,deny=false;
  global.fetch=async(req,opts)=>{
    const url=String(req);
    if (url.includes('/auth/v1/user')) return deny?Response.json({message:'expired'},{status:401}):Response.json({id:'55555555-5555-4555-a555-555555555555',aud:'authenticated'});
    if (url.includes('ai_reserve')) return Response.json({state:state || (reply?'cached':'reserved'),remaining:248,reply});
    if (url.includes('ai_finish')) {reply=JSON.parse(opts.body).p_reply;return Response.json(true);}
    if (url.includes('countTokens')) return Response.json({totalTokens:300});
    if (url.includes('generateContent')) {calls++;return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({cards:[basic]})}]}}]});}
    throw Error('Unexpected test request');
  };
  async function call(method,token,body={...part,provider:'gemini',model:'test-model'}) {
    const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(v){this.data=v;}};
    await handler({method,headers:{authorization:token?'Bearer sample':'','content-type':'application/json'},body},res);return res;
  }
  assert.equal((await call('POST',false)).code,401);
  deny=true;assert.equal((await call('POST',true)).code,401);deny=false;
  assert.equal((await call('GET',true)).data.provider,'gemini');
  assert.deepEqual((await call('POST',true)).data.cards,[basic]);assert.ok(reply && !reply.includes('Amber'));
  assert.deepEqual((await call('POST',true)).data.cards,[basic]);assert.equal(calls,1);
  state='limit';assert.equal((await call('POST',true)).code,429);
  state='busy';assert.equal((await call('POST',true)).code,409);assert.equal(calls,1);
});
