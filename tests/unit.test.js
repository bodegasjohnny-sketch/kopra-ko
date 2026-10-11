const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const Calc=require('../calc.js'),SEED=require('../seed.js'),DB=require('../db.js'),Sync=require('../sync.js');
const TODAY=new Date(2026,9,11),near=(a,b,t=0.005)=>assert.ok(Math.abs(a-b)<=t,`${a} ≠ ${b}`);
const clone=o=>JSON.parse(JSON.stringify(o)),ROOT=path.join(__dirname,'..');
const bid10=d=>d.batches.find(b=>b.no===10);
// ---------- seed totals ----------
test('seed totals match FULL_REPORT.md',()=>{const k=Calc.compute(SEED,TODAY);
  near(k.raw,29366);near(k.copra,6893.8);near(k.sales,317466);near(k.buyTotal,275510.49);near(k.totalExp,5098.85);
  near(k.copraNet,36856.66);near(k.realized,36856.66);near(k.unrealized,0);near(k.onHand,0);
  near(k.bid.yield,0.2348,0.00005);near(k.bid.expPerKg,0.17,0.005);near(k.bid.beRaw,10.1556,0.0001);
  near(k.char.uling,603);near(k.char.bagolDone,1878);near(k.char.ulingSales,18693);near(k.char.ulingYield,0.3211,0.00005);near(k.char.bagolLeft,4582.52);
  near(k.combined,55549.66);near(k.share,27774.83);near(k.netPerKg,1.255,0.005);near(k.room,1.89);near(k.costPerKgCopra,40.70)});
test('duration since 2026-08-18 = 55 days',()=>{const t=Calc.compute(SEED,TODAY).time;assert.equal(t.days,55);near(t.rawMo,16252.75,0.1)});
test('adding a batch updates KPIs + bid guide',()=>{const d=clone(SEED);const id='t1';d.batches.push({id,no:11,rawKg:1000,buyTotal:9500,copraKg:250,deleted:false});
  d.sales.push({id:'ts',batch_id:id,kg:250,price:44,deleted:false});d.expenses.push({id:'te',batch_id:id,category:'Gas',amount:100,deleted:false});
  const k=Calc.compute(d,TODAY);near(k.raw,30366);near(k.copraNet,36856.66+11000-9500-100);assert.ok(k.bid.beRaw>10.1556)});
test('unsold copra -> unrealized; bid unchanged',()=>{const d=clone(SEED);d.sales.find(s=>s.kg===1329).kg=1000;const k=Calc.compute(d,TODAY);
  near(k.onHand,329);near(k.unrealized,329*44-329*58200/1329);near(k.total,36856.66,0.01);assert.equal(k.bid.be,10.15)});
// ---------- FIX 1: validation ----------
test('FIX1 validation rejects oversell, negative kg, negative gas/expenses',()=>{const V=Calc.validate;
  assert.match(V('sale',{kg:500,price:44},{onHand:329}),/only 329 kg on hand/);assert.equal(V('sale',{kg:329,price:44},{onHand:329}),null);
  assert.match(V('sale',{kg:-5,price:44},{onHand:999}),/more than 0/);assert.match(V('sale',{kg:5,price:0},{}),/Price/);
  assert.match(V('buy',{rawKg:-1,buyPrice:9}),/Raw kg/);assert.match(V('buy',{rawKg:100,buyPrice:9,gas:-50}),/Gas cannot be negative/);
  assert.match(V('buy',{rawKg:100,buyPrice:9,copraKg:-3}),/Copra kg cannot be negative/);assert.match(V('buy',{rawKg:100,buyPrice:9,copraKg:150}),/more than raw/);
  assert.match(V('buy',{rawKg:1000,buyPrice:9,copraKg:100,minCopra:200}),/already sold/);
  assert.match(V('exp',{amount:-20,category:'Gas'}),/more than 0/);assert.match(V('char',{bagolKg:300,ulingKg:-1,price:31,status:'done'}),/negative/);
  assert.match(V('char',{bagolKg:300,ulingKg:400,price:31,status:'done'}),/more than bagol/);assert.match(V('buy',{rawKg:1,buyPrice:1,date:'2026-02-31'}),/Date/)});
// ---------- FIX 2: old-batch sale price doesn't move global price ----------
test('FIX2 ₱60 sale on old batch does not move break-even',()=>{const d=clone(SEED);const b1=d.batches.find(b=>b.no===1);
  d.batches.find(b=>b.no===1).copraKg+=10;d.sales.push({id:'x',batch_id:b1.id,kg:10,price:60,deleted:false});
  const k=Calc.compute(d,TODAY);assert.equal(k.bid.sell,44);const yld=(6893.8+10)/29366;near(k.bid.beRaw,yld*44-5098.85/29366,1e-9)});
test('FIX2 app.js no longer writes settings on sale',()=>{const s=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');const sale=s.slice(s.indexOf("if(form==='sale'){if(!$('#f_batch')"),s.indexOf("if(form==='char'){const rec"));
  assert.ok(!/store\.save\('settings'/.test(sale))});
// ---------- FIX 3: bid honesty ----------
test('FIX3 break-even rounded DOWN to ₱10.15, good ₱9.65, gas-only flag',()=>{const k=Calc.compute(SEED,TODAY);assert.equal(k.bid.be,10.15);assert.equal(k.bid.good,9.65);assert.equal(k.bid.gasOnly,true);
  const d=clone(SEED);d.expenses.push({id:'l',category:'Labor',amount:100,deleted:false});assert.equal(Calc.compute(d,TODAY).bid.gasOnly,false)});
test('FIX3 uling shown as gross when no costs',()=>{const k=Calc.compute(SEED,TODAY);assert.equal(k.char.hasCosts,false);const d=clone(SEED);d.expenses.push({id:'u',category:'Uling',amount:500,deleted:false});
  const k2=Calc.compute(d,TODAY);assert.equal(k2.char.hasCosts,true);near(k2.char.ulingNet,18193);near(k2.copraNet,36856.66)});
test('FIX3 labels present in app.js',()=>{const s=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');assert.ok(s.includes('Real break-even is lower once other costs are logged'));
  assert.ok(s.includes('Good bid = break-even minus ${P(b.margin)} margin (change in Settings)'));assert.ok(s.includes('Uling gross sales'));assert.ok(!s.includes('§6b'))});
// ---------- empty state, settings ----------
test('SF empty state: no bid, no −₱0.50',()=>{const k=Calc.compute({settings:SEED.settings,batches:[],sales:[],expenses:[],charcoal:[]},TODAY);assert.equal(k.bid.hasData,false);assert.equal(k.bid.be,null);assert.equal(k.bid.good,null)});
test('SF settings validation',()=>{const V=s=>Calc.validate('settings',{copraPrice:44,targetMargin:.5,startDate:'2026-08-18',ulingPrice:31,bagolRatio:.22,merienda:.04,partners:['A','B'],...s},{today:'2026-10-11'});
  assert.equal(V({}),null);assert.match(V({copraPrice:0}),/Copra price/);assert.match(V({targetMargin:-1}),/Margin/);assert.match(V({startDate:'2027-01-01'}),/future/);
  assert.match(V({bagolRatio:22}),/Bagol/);assert.match(V({merienda:-1}),/Merienda/);assert.match(V({partners:['A','']}),/partner/)});
// ---------- FIX 6: seed dates ----------
test('FIX6 seed dates are null or real dates',()=>{for(const t of ['batches','sales','expenses','charcoal'])for(const r of SEED[t])assert.ok(r.date==null||Calc.isDate(r.date)&&r.date!=='',`${t} ${r.date}`);
  assert.ok(!fs.readFileSync(path.join(ROOT,'seed.js'),'utf8').includes('"date": ""'))});
// ---------- store ----------
test('SF random seed IDs per install, refs consistent, totals intact',async()=>{const A=DB.Store(),B=DB.Store();await A.seedIfEmpty(SEED);await B.seedIfEmpty(SEED);
  const a=await A.snapshot(),b=await B.snapshot();assert.notEqual(a.batches[0].id,b.batches[0].id);const ids=new Set(a.batches.map(x=>x.id));
  assert.ok(a.sales.every(s=>ids.has(s.batch_id)));assert.ok(!a.batches.some(x=>SEED.batches.some(s=>s.id===x.id)));near(Calc.compute(a,TODAY).copraNet,36856.66)});
test('store: uuid, updated_at, deleted, synced; soft delete',async()=>{const s=DB.Store();const r=await s.save('batches',{rawKg:1,buyTotal:1});
  assert.match(r.id,/^[0-9a-f-]{36}$/);assert.equal(r.synced,false);await s.remove('batches',r.id);assert.equal((await s.adapter.get('batches',r.id)).deleted,true)});
// ---------- sync: mock server that mirrors supabase/schema.sql kopra_stamp() exactly (seq, server now(), base_seq check, sticky tombstones).
// The real trigger is proven separately in tests/sql_test.sh (local Postgres) and tests/staging_test.js (real Supabase).
function TriggerServer(){const T={};let seq=0,clock=Date.parse('2026-10-11T10:00:00Z');const tab=t=>T[t]||(T[t]=new Map());
  return{T,
  upsert:async(t,rows)=>{const out=[];for(const r of rows){const old=tab(t).get(r.id);
    if(old){if(old.deleted&&!r.deleted)continue;if(!r.deleted&&r.base_seq!==old.seq)continue}
    const v={...r,seq:++seq,updated_at:new Date(clock+=1000).toISOString(),base_seq:null};tab(t).set(r.id,v);out.push({...v})}return out},
  pullSince:async(t,c)=>[...tab(t).values()].filter(r=>r.seq>c).sort((a,b)=>a.seq-b.seq).map(r=>({...r})),
  getByIds:async(t,ids)=>ids.map(id=>tab(t).get(id)).filter(Boolean).map(r=>({...r}))}}
async function pair(){const srv=TriggerServer(),A=DB.Store(),B=DB.Store();await A.seedIfEmpty(SEED);await Sync.sync(A,srv);await B.seedIfEmpty(SEED);const r=await Sync.sync(B,srv);return{srv,A,B,r}}
test('SF second phone adopts cloud instead of duplicating seed',async()=>{const{A,B,r}=await pair();assert.equal(r.adoptedCloud,true);
  near(Calc.compute(await B.snapshot(),TODAY).copraNet,Calc.compute(await A.snapshot(),TODAY).copraNet);assert.equal((await B.snapshot()).batches.length,10)});
test('sync: push, pull, soft delete propagates; server stamps seq + updated_at',async()=>{const{srv,A,B}=await pair();const nb=await A.save('batches',{no:11,rawKg:500,buyTotal:4800,copraKg:120});
  await Sync.sync(A,srv);const a=await A.adapter.get('batches',nb.id);assert.ok(a.seq>0&&a.synced);assert.equal(a.updated_at,srv.T.batches.get(nb.id).updated_at);
  await Sync.sync(B,srv);assert.ok(await B.adapter.get('batches',nb.id));await B.remove('batches',nb.id);await Sync.sync(B,srv);await Sync.sync(A,srv);
  assert.equal((await A.adapter.get('batches',nb.id)).deleted,true)});
test('B-CLOCK SKEW: phone A clock +1h cannot win with a stale edit',async()=>{const{srv,A,B}=await pair();const id=(await A.snapshot()).batches[0].id;
  const realNow=Date.now;Date.now=()=>realNow()+3600e3; // phone A is 1 hour ahead
  try{await A.save('batches',{...(await A.adapter.get('batches',id)),source:'A (+1h clock)'})}finally{Date.now=realNow}
  await B.save('batches',{...(await B.adapter.get('batches',id)),source:'B (correct clock)'});await Sync.sync(B,srv); // B reaches server first
  const pend=await A.adapter.get('batches',id);assert.ok(pend.updated_at>srv.T.batches.get(id).updated_at,'A local time is later');
  const ra=await Sync.sync(A,srv);assert.equal((await A.adapter.get('batches',id)).source,'B (correct clock)');assert.equal(srv.T.batches.get(id).source,'B (correct clock)');
  assert.equal(ra.conflicts.length,1);assert.equal(ra.conflicts[0].local.source,'A (+1h clock)');assert.equal(((await A.meta('conflicts'))||[]).length,1)});
test('B-REJECTED PUSH: re-pull row + log conflict (edit arrives between pull and push)',async()=>{const{srv,A,B}=await pair();const id=(await A.snapshot()).batches[1].id;
  await A.save('batches',{...(await A.adapter.get('batches',id)),source:'A edit'});
  const sneaky={...srv,pullSince:async(t,c)=>{const r=await srv.pullSince(t,c);if(t==='charcoal'){await B.save('batches',{...(await B.adapter.get('batches',id)),source:'B wins race'});await Sync.sync(B,srv)}return r}};
  const ra=await Sync.sync(A,sneaky);assert.equal(ra.rejected,1);assert.equal(ra.conflicts[0].winner,'server (push rejected)');assert.equal(ra.conflicts[0].local.source,'A edit');
  const a=await A.adapter.get('batches',id);assert.equal(a.source,'B wins race');assert.equal(a.synced,true);assert.equal(a.seq,srv.T.batches.get(id).seq)});
test('B-pull cursor is server seq (not time); overlap re-read is idempotent',async()=>{const{srv,A}=await pair();const c=await A.meta('cursor');assert.equal(typeof c,'number');
  const calls=[];const spy={...srv,pullSince:async(t,x)=>{calls.push(x);return srv.pullSince(t,x)}};const r=await Sync.sync(A,spy);assert.equal(r.pulled,0);assert.equal(r.adoptedCloud,false);assert.equal(await A.meta('seedOnly'),false);assert.ok(calls.every(x=>x===Math.max(0,c-Sync.OVERLAP)))});
test('SF tombstone wins over a stale later-clocked edit',async()=>{const{srv,A,B}=await pair();const id=(await A.snapshot()).batches[0].id;
  await A.remove('batches',id);await Sync.sync(A,srv);const realNow=Date.now;Date.now=()=>realNow()+3600e3;
  try{await B.save('batches',{...(await B.adapter.get('batches',id)),source:'stale edit'})}finally{Date.now=realNow}
  const rb=await Sync.sync(B,srv);assert.equal(rb.conflicts[0].winner,'remote-delete');assert.equal((await B.adapter.get('batches',id)).deleted,true);assert.equal(srv.T.batches.get(id).deleted,true);
  const{srv:s2,A:A2,B:B2}=await pair();const id2=(await A2.snapshot()).batches[0].id;await B2.save('batches',{...(await B2.adapter.get('batches',id2)),source:'B edit'});await Sync.sync(B2,s2);
  await A2.remove('batches',id2);const ra=await Sync.sync(A2,s2);assert.equal(ra.conflicts[0].winner,'local-delete');assert.equal(s2.T.batches.get(id2).deleted,true)});
test('SF restore is not overwritten by cloud',async()=>{const{srv,A,B}=await pair();const backup=await A.snapshot();
  await B.save('batches',{no:11,rawKg:9999,buyTotal:90000,copraKg:0});await Sync.sync(B,srv);await Sync.sync(A,srv);
  await A.replaceAll(backup);await Sync.sync(A,srv);near(Calc.compute(await A.snapshot(),TODAY).raw,29366);await Sync.sync(B,srv);near(Calc.compute(await B.snapshot(),TODAY).raw,29366)});
// ---------- FIX 7: token refresh + errors surfaced ----------
test('FIX7 refreshes token on 401 and retries; persists new tokens',async()=>{const calls=[];let saved=null;
  const f=async(u,o)=>{calls.push([u,o.headers.Authorization]);if(u.includes('grant_type=refresh_token'))return{ok:true,status:200,json:async()=>({access_token:'NEW',refresh_token:'R2'})};
    if(o.headers.Authorization==='Bearer OLD')return{ok:false,status:401,text:async()=>'jwt expired'};return{ok:true,status:200,json:async()=>[],text:async()=>''}};
  const be=Sync.SupabaseBackend({url:'https://x.supabase.co',anonKey:'k',accessToken:'OLD',refreshToken:'R1',onTokens:t=>saved=t},f);
  await be.pullSince('batches',0);assert.equal(calls.length,3);assert.equal(calls[2][1],'Bearer NEW');assert.deepEqual(saved,{accessToken:'NEW',refreshToken:'R2'});
  assert.match(calls[0][0],/seq=gt\.0&order=seq\.asc/)});
test('FIX7 sync errors are surfaced (lastSyncError) and cleared on success',async()=>{const s=DB.Store();await s.seedIfEmpty(SEED);
  const bad={pullSince:async()=>{throw new Error('Server error 500')},upsert:async()=>{}};await assert.rejects(Sync.sync(s,bad),/500/);
  assert.match((await s.meta('lastSyncError')).message,/500/);await Sync.sync(s,TriggerServer());assert.equal(await s.meta('lastSyncError'),null)});
// ---------- FIX 4 / SF: service worker + files ----------
test('FIX4 sw never caches Supabase/API/cross-origin; cache name from APP_VERSION',()=>{const ctx={self:{location:{origin:'https://copra.johnnybodegas.com'},addEventListener(){}},importScripts(){ctx.self.APP_VERSION='T'},URL};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'sw.js'),'utf8')+';this.isApi=isApi;this.V=V',ctx);const u=x=>new URL(x);
  assert.ok(ctx.isApi(u('https://abc.supabase.co/rest/v1/batches')));assert.ok(ctx.isApi(u('https://copra.johnnybodegas.com/auth/v1/token')));assert.ok(ctx.isApi(u('https://cdn.example.com/x.js')));
  assert.ok(!ctx.isApi(u('https://copra.johnnybodegas.com/app.js')));assert.equal(ctx.V,'kopra-T');assert.match(fs.readFileSync(path.join(ROOT,'version.js'),'utf8'),/APP_VERSION='1\.2\.0'/)});
test('SF CNAME + README signup note',()=>{assert.equal(fs.readFileSync(path.join(ROOT,'CNAME'),'utf8').trim(),'copra.johnnybodegas.com');assert.match(fs.readFileSync(path.join(ROOT,'README.md'),'utf8'),/disable.*sign.?ups/i)});
test('SF sync UI hidden by default (flag)',()=>{const s=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');assert.ok(s.includes("${FLAGS?`<div class=\"card\" id=\"synccard\">"));assert.ok(s.includes('async function runSync(loud){if(!FLAGS)return;'))});

// ---------- A1 caps ----------
test('A1 caps enforced in forms (validate)',()=>{const V=Calc.validate,C=Calc.CAPS;
  assert.match(V('buy',{rawKg:200001,buyPrice:9}),/Raw kg cannot be more than 200,000/);assert.equal(V('buy',{rawKg:200000,buyPrice:9}),null);
  assert.match(V('buy',{rawKg:100,buyPrice:101}),/Buy price/);assert.match(V('buy',{rawKg:100,buyPrice:9,gas:1000001}),/Gas/);assert.match(V('buy',{rawKg:100,buyPrice:9,asarez:150}),/Asarez/);
  assert.match(V('sale',{kg:5,price:201},{onHand:10}),/Copra price ₱\/kg cannot be more than 200/);assert.match(V('exp',{amount:1000001,category:'Gas'}),/Amount/);
  assert.match(V('char',{bagolKg:100001,ulingKg:0,price:31,status:'done'}),/Bagol/);assert.match(V('char',{bagolKg:300,ulingKg:90,price:500,status:'done'}),/Uling price/);
  assert.deepEqual([C.rawKg,C.buyPrice,C.salePrice,C.expense],[200000,100,200,1000000])});
// ---------- A2 strict backup validation ----------
const good=()=>clone(SEED);
test('A2 valid backup accepted; seed passes',()=>{assert.deepEqual(Calc.validateBackup(good()),[])});
test('A2 backup import rejects bad types, missing fields, negatives, caps, bad refs',async()=>{const bad=[
  [o=>{delete o.sales},/Missing table "sales"/],[o=>{o.batches[0].rawKg='1000'},/Raw kg/],[o=>{o.batches[0].rawKg=-5},/Raw kg/],[o=>{o.batches[0].rawKg=250000;o.batches[0].buyTotal=250000*9},/200,000/],
  [o=>{o.batches[0].buyTotal=o.batches[0].rawKg*500},/Buy price/],[o=>{o.sales[0].price=999},/200/],[o=>{o.sales[0].kg=99999},/sold more copra than made/],
  [o=>{o.expenses[0].amount=-1},/Amount/],[o=>{o.expenses[0].amount=5e6},/Amount/],[o=>{o.sales[0].batch_id='nope'},/batch not found/],
  [o=>{o.charcoal[0].status='<img src=x onerror=alert(1)>'},/status/],[o=>{o.batches[0].dev='"><script>'},/device tag/],[o=>{o.batches[0].no='1<b>'},/batch number/],
  [o=>{o.batches[0].id='x" onclick="y'},/bad id/],[o=>{o.batches[1].id=o.batches[0].id},/duplicate id/],[o=>{o.settings=[]},/exactly one settings/],
  [o=>{o.settings[0].copraPrice=0},/Copra price/],[o=>{o.batches[0].date='2026-13-40'},/bad date/],[o=>{o.batches[0].deleted='no'},/deleted/]];
  for(const[mut,re]of bad){const o=good();mut(o);const e=Calc.validateBackup(o);assert.ok(e.some(x=>re.test(x)),`${re} not in ${JSON.stringify(e)}`);
    const st=DB.Store();await st.seedIfEmpty(SEED);await assert.rejects(st.replaceAll(o),/Not a valid backup/);near(Calc.compute(await st.snapshot(),TODAY).raw,29366)}
  assert.deepEqual(Calc.validateBackup([]),['Not a backup file']);assert.deepEqual(Calc.validateBackup(null),['Not a backup file'])});
test('A2 import drops unknown fields',async()=>{const o=good();o.batches[0].evil='<script>';o.batches[0].__proto_x=1;const st=DB.Store();await st.replaceAll(o);
  assert.ok((await st.snapshot()).batches.every(b=>!('evil' in b)&&!('__proto_x' in b)))});
test('A2 app escapes status, device tag, batch number; tag hidden when sync off',()=>{const s=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
  assert.ok(s.includes("const bl=r=>esc('#'+(Number.isInteger(r.no)?r.no:'?')+(FLAGS&&r.dev?'-'+r.dev:''))"));assert.ok(s.includes('<td>${esc(b.status)}</td>'));assert.ok(s.includes('· ${esc(c.status)}'));
  assert.ok(!/\$\{(b|c|r)\.(status|dev|no)\}/.test(s))});
test('A cosmetic README: ?sync=1 is per page load',()=>{const r=fs.readFileSync(path.join(ROOT,'README.md'),'utf8');assert.match(r,/only for that page load/);assert.match(r,/200,000/)});
