'use strict';

const crypto = require('node:crypto');
const {config, attachment, fingerprint, generate, DraftError} = require('../server/flashcards.cjs');
const {createClient} = require('@supabase/supabase-js');

// Cache only encrypted results. Source bytes and access tokens are never logged.
function cipher(value, secret, digest, decrypt = false) {
  const key=crypto.createHash('sha256').update(secret).digest();
  const data=decrypt ? Buffer.from(value,'base64') : Buffer.from(JSON.stringify(value));
  const iv=decrypt ? data.subarray(0,12) : crypto.randomBytes(12);
  const c=decrypt ? crypto.createDecipheriv('aes-256-gcm',key,iv) : crypto.createCipheriv('aes-256-gcm',key,iv);
  c.setAAD(Buffer.from(digest));
  if (decrypt) {
    c.setAuthTag(data.subarray(12,28));
    return JSON.parse(Buffer.concat([c.update(data.subarray(28)),c.final()]));
  }
  const payload=Buffer.concat([c.update(data),c.final()]);
  return Buffer.concat([iv,c.getAuthTag(),payload]).toString('base64');
}
module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  try {
    if (!['GET','POST'].includes(req.method)) throw new DraftError(405,'Use GET or POST.');
    const cfg=config(), url=process.env.SUPABASE_URL, secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
    const token=/^Bearer (\S+)$/i.exec(req.headers.authorization || '')?.[1];
    if (!token) throw new DraftError(401,'Sign in again to create cards from files.');
    if (!url || !secret) throw new DraftError(503,'AI drafting is awaiting account setup.');
    const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false},
      global:{fetch:(input,options)=>fetch(input,{...options,signal:AbortSignal.timeout(12000)})}});
    const {data,error}=await db.auth.getUser(token);
    if (error || !data.user || data.user.is_anonymous) throw new DraftError(401,'Sign in again to use AI drafting.');
    if (req.method==='GET') return res.json({provider:cfg.provider,name:cfg.name,model:cfg.model,daily:cfg.daily,ready:Boolean(process.env[cfg.key])});
    if (!process.env[cfg.key]) throw new DraftError(503,cfg.name+' drafting is awaiting provider setup.');
    if (!req.headers['content-type']?.startsWith('application/json')) throw new DraftError(415,'Send a JSON attachment.');
    const body=req.body;
    if (body?.provider!==cfg.provider || body?.model!==cfg.model)
      throw new DraftError(409,'The configured model changed. Refresh to see the updated privacy note.');
    const part=await attachment(body), digest=fingerprint(cfg,part);
    const args={p_owner:data.user.id,p_digest:digest,p_lease:crypto.randomUUID()};
    async function rpc(name,params) {
      const result=await db.rpc('mtverse_ai_'+name,params);
      if (result.error) throw new DraftError(503,'Draft storage is unavailable. Please retry shortly.');
      return result.data;
    }
    const {state,reply,remaining,resetAt}=await rpc('reserve',{...args,p_pages:part.pages,p_limit:cfg.daily});
    if (state==='limit') return res.status(429).json({error:'Daily page allowance reached. Your drafts are safe.',remaining,resetAt});
    if (state==='retry_limit') return res.status(429).json({error:'This section reached its retry limit for today.',remaining,resetAt});
    if (state==='busy') throw new DraftError(409,'This section is already processing. Retry in a moment.');
    const context=data.user.id+digest;
    let result;
    if (state==='cached') result=cipher(reply,secret,context,true);
    else if (state==='reserved') {
      try { result=await generate(cfg,part); }
      catch (e) { await rpc('finish',{...args,p_reply:null}); throw e; }
      if (!await rpc('finish',{...args,p_reply:cipher(result,secret,context)}))
        throw new DraftError(503,'Could not confirm the saved result. Retry this section.');
    } else throw new DraftError(503,'Could not reserve this section.');
    return res.json({cards:result.cards,skipped:result.skipped,remaining,resetAt});
  } catch (err) {
    return res.status(err instanceof DraftError ? err.status : 503).json({
      error:err instanceof DraftError ? err.message : 'Drafting is unavailable. Please try again shortly.'});
  }
};
