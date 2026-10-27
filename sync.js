// JB Integrated Farm sync (v1.2). The client NEVER uses its own clock for ordering.
//  - Server assigns every accepted write a monotonic `seq` (bigint sequence) and stamps `updated_at = now()`.
//  - Pull cursor = highest server `seq` seen (re-reads a small overlap window to tolerate out-of-order commits; re-applying is idempotent).
//  - Each push carries `base_seq` = the server version the edit was based on. The DB trigger skips the write if the row changed
//    since then (optimistic concurrency, first-to-server wins). Deletes are always accepted and are sticky (no undelete).
//  - Rejected pushes are detected (missing from the returned rows), the server row is re-pulled, applied, and a conflict is logged
//    with the losing local copy so nothing is silently lost.
(function(root){
const OVERLAP=200;
const FIELDS=(typeof DB!=='undefined'?DB:require('./db.js')).FIELDS;
const toWire=(t,r,teamId)=>{const o={};FIELDS[t].forEach(k=>o[k]=r[k]===undefined?null:r[k]);o.deleted=!!r.deleted;o.base_seq=r.seq??null;if(teamId)o.team_id=teamId;return o};
const fromWire=r=>{const o={...r};delete o.team_id;delete o.base_seq;delete o.server_at;return o};
async function logConflicts(store,list){if(!list.length)return;const prev=(await store.meta('conflicts'))||[];await store.meta('conflicts',prev.concat(list.map(c=>({...c,at:new Date().toISOString()}))).slice(-50))}
async function applyRemote(store,t,remote,res){const apply=[],repush=[];
  for(const r0 of remote){const r={...fromWire(r0),synced:true};const l=await store.adapter.get(t,r.id);
    if(!l){apply.push(r);continue}
    if(l.seq!=null&&r.seq<=l.seq)continue;                                   // already have this version (overlap window)
    if(l.synced){apply.push(r);continue}
    // local has a pending edit based on an older server version
    if(l.deleted&&!r.deleted){res.conflicts.push({table:t,id:r.id,winner:'local-delete',local:l,remote:r});repush.push({...l,seq:r.seq});continue} // delete still wins; rebase it
    res.conflicts.push({table:t,id:r.id,winner:r.deleted?'remote-delete':'remote',local:l,remote:r});apply.push(r);
  }
  if(apply.length){await store.adapter.putMany(t,apply);res.pulled+=apply.length}if(repush.length)await store.adapter.putMany(t,repush)}
async function sync(store,backend,opts={}){
  const res={pushed:0,pulled:0,rejected:0,conflicts:[],adoptedCloud:false};const tables=store.TABLES;
  try{
  let cursor=(await store.meta('cursor'))??0;
  if(cursor===0&&(await store.meta('seedOnly'))===true){if((await backend.pullSince('batches',0)).length){await store.wipeLocal();res.adoptedCloud=true}}
  let max=cursor;
  for(const t of tables){const rows=await backend.pullSince(t,Math.max(0,cursor-OVERLAP));rows.forEach(r=>{if(r.seq>max)max=r.seq});await applyRemote(store,t,rows,res)}
  for(const t of tables){
    const rows=await store.unsynced(t);if(!rows.length)continue;
    const acc=await backend.upsert(t,rows.map(r=>toWire(t,r,opts.teamId)));const got=new Map(acc.map(r=>[r.id,r]));
    const ok=[],rejectedIds=[];for(const r of rows)(got.has(r.id)?ok:rejectedIds).push(r.id);
    if(ok.length){await store.adapter.putMany(t,ok.map(id=>({...fromWire(got.get(id)),synced:true})));res.pushed+=ok.length}
    if(rejectedIds.length){res.rejected+=rejectedIds.length;const srv=await backend.getByIds(t,rejectedIds);
      for(const r0 of srv){const r={...fromWire(r0),synced:true};const l=await store.adapter.get(t,r.id);res.conflicts.push({table:t,id:r.id,winner:'server (push rejected)',local:l,remote:r});await store.adapter.put(t,r)}}
  }
  await logConflicts(store,res.conflicts);
  await store.meta('cursor',max);await store.meta('seedOnly',false);await store.meta('lastSyncError',null);await store.meta('lastSyncOk',new Date().toISOString());return res;
  }catch(e){await store.meta('lastSyncError',{message:String(e.message||e),at:new Date().toISOString()});throw e}
}
// cfg: {url, anonKey, accessToken, refreshToken, onTokens(tokens)}; on 401 refreshes the token once and retries.
function SupabaseBackend(cfg,fetchFn){const f=fetchFn||fetch.bind(globalThis);const base=cfg.url.replace(/\/$/,'');
  const h=()=>({apikey:cfg.anonKey,Authorization:'Bearer '+(cfg.accessToken||cfg.anonKey),'Content-Type':'application/json'});
  async function call(url,init){const go=()=>f(url,{...init,headers:{...h(),...(init.extra||{})}});let r=await go();
    if(r.status===401&&cfg.refreshToken){const t=await refresh(cfg,f);Object.assign(cfg,t);cfg.onTokens&&cfg.onTokens(t);r=await go()}
    if(r.status===401)throw new Error('Login expired — sign in again');if(!r.ok)throw new Error(`Server error ${r.status}: ${(await r.text()).slice(0,200)}`);return r}
  return{
    async upsert(t,rows){const r=await call(`${base}/rest/v1/${t}?on_conflict=id`,{method:'POST',extra:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(rows)});return r.json()},
    async pullSince(t,seq){const r=await call(`${base}/rest/v1/${t}?select=*&seq=gt.${+seq}&order=seq.asc&limit=5000`,{method:'GET'});return r.json()},
    async getByIds(t,ids){const r=await call(`${base}/rest/v1/${t}?select=*&id=in.(${ids.map(encodeURIComponent).join(',')})`,{method:'GET'});return r.json()}}}
async function refresh(cfg,f){const r=await f(cfg.url.replace(/\/$/,'')+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:cfg.anonKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:cfg.refreshToken})});
  const j=await r.json();if(!r.ok)throw new Error('Login expired — sign in again');return{accessToken:j.access_token,refreshToken:j.refresh_token}}
async function signIn(cfg,email,password,fetchFn){const f=fetchFn||fetch.bind(globalThis);
  const r=await f(cfg.url.replace(/\/$/,'')+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:cfg.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const j=await r.json();if(!r.ok)throw new Error(j.error_description||j.msg||'login failed');return{accessToken:j.access_token,refreshToken:j.refresh_token,user:j.user&&j.user.email}}
const api={sync,SupabaseBackend,signIn,refresh,OVERLAP};
if(typeof module!=='undefined')module.exports=api;else root.Sync=api;
})(this);
