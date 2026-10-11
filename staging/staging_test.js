// Staging pass against the REAL Supabase project. Never prints secrets.
// Needs: /home/box/.secrets/kopra_supabase.env (SUPABASE_URL, SUPABASE_ANON|SUPABASE_PUBLISHABLE)
// and, for the logged-in part, STAGING_EMAIL_A/STAGING_PW_A/STAGING_EMAIL_B/STAGING_PW_B/STAGING_TEAM in the same env file.
const fs=require('fs');const env={};fs.readFileSync('/home/box/.secrets/kopra_supabase.env','utf8').split('\n').forEach(l=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'')});
const DB=require('../db.js'),Sync=require('../sync.js'),SEED=require('../seed.js');
const URL_=env.SUPABASE_URL,KEY=env.SUPABASE_ANON||env.SUPABASE_PUBLISHABLE;const R=[];const ok=(n,c,d='')=>{R.push(c);console.log((c?'PASS ':'FAIL ')+n+(d?' — '+d:''))};
const j=async(p,o={})=>{const r=await fetch(URL_+p,{...o,headers:{apikey:KEY,'Content-Type':'application/json',...(o.headers||{})}});let b;try{b=await r.json()}catch{b=null}return{s:r.status,b}};
(async()=>{
  const st=await j('/auth/v1/settings');ok('signups disabled',st.b&&st.b.disable_signup===true,'disable_signup='+(st.b&&st.b.disable_signup));
  for(const t of ['batches','sales','expenses','charcoal','settings','teams','team_members']){const r=await j(`/rest/v1/${t}?select=id&limit=1`);
    ok(`logged-out cannot read ${t}`,r.s===401||(r.s===200&&Array.isArray(r.b)&&r.b.length===0),`HTTP ${r.s}${r.b&&r.b.code?' '+r.b.code:''}`)}
  const w=await j('/rest/v1/batches',{method:'POST',body:JSON.stringify({id:DB.uuid(),team_id:DB.uuid(),no:1,rawKg:1,buyTotal:1})});ok('logged-out cannot write',w.s===401||w.s===403,`HTTP ${w.s}`);
  if(!env.STAGING_EMAIL_A){console.log('SKIP logged-in tests: STAGING_EMAIL_A/B, STAGING_PW_A/B, STAGING_TEAM not set');return done()}
  const cfg=e=>({url:URL_,anonKey:KEY});const A={...cfg(),...await Sync.signIn(cfg(),env.STAGING_EMAIL_A,env.STAGING_PW_A)},B={...cfg(),...await Sync.signIn(cfg(),env.STAGING_EMAIL_B,env.STAGING_PW_B)};ok('both users sign in',!!A.accessToken&&!!B.accessToken);
  // real 401 → refresh: corrupt the access token, keep the real refresh token
  let refreshed=null;const Abe=Sync.SupabaseBackend({...A,accessToken:'invalid.jwt.token',onTokens:t=>refreshed=t});const rows=await Abe.pullSince('batches',0);
  ok('real 401 triggers refresh + retry',!!refreshed&&Array.isArray(rows));if(refreshed)Object.assign(A,refreshed);
  const team={teamId:env.STAGING_TEAM};const sA=DB.Store(),sB=DB.Store();
  const mine=await sA.save('batches',{no:900,source:'staging test',rawKg:100,buyTotal:900,copraKg:20});await Sync.sync(sA,Sync.SupabaseBackend(A),team);
  const a1=await sA.adapter.get('batches',mine.id);ok('server stamps seq + updated_at',a1.seq>0&&a1.synced);
  await Sync.sync(sB,Sync.SupabaseBackend(B),team);ok('partner B pulls it',!!(await sB.adapter.get('batches',mine.id)));
  const real=Date.now;Date.now=()=>real()+3600e3;try{await sA.save('batches',{...(await sA.adapter.get('batches',mine.id)),source:'A +1h clock'})}finally{Date.now=real}
  await sB.save('batches',{...(await sB.adapter.get('batches',mine.id)),source:'B first'});await Sync.sync(sB,Sync.SupabaseBackend(B),team);
  const rA=await Sync.sync(sA,Sync.SupabaseBackend(A),team);ok('CLOCK SKEW (+1h) stale push rejected by real trigger',rA.rejected===1&&(await sA.adapter.get('batches',mine.id)).source==='B first',JSON.stringify({rejected:rA.rejected}));
  await sA.remove('batches',mine.id);await Sync.sync(sA,Sync.SupabaseBackend(A),team);await Sync.sync(sB,Sync.SupabaseBackend(B),team);ok('soft delete reaches partner',(await sB.adapter.get('batches',mine.id)).deleted===true);
  done()})().catch(e=>{console.log('ERROR',String(e.message).replace(KEY,'<key>'));R.push(false);done()});
function done(){console.log(`\nstaging: ${R.filter(Boolean).length}/${R.length} passed`);process.exitCode=R.every(Boolean)?0:1}
