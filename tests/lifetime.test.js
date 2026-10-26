// v1.4.0 Lifetime items (capital + one-off lifetime expenses). The example items below are TEST-ONLY, never seed data.
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path');
const Calc=require('../calc.js'),SEED=require('../seed.js'),DB=require('../db.js'),Sync=require('../sync.js');
const TODAY=new Date(2026,9,11),near=(a,b,t=0.005)=>assert.ok(Math.abs(a-b)<=t,`${a} ≠ ${b}`),clone=o=>JSON.parse(JSON.stringify(o)),ROOT=path.join(__dirname,'..');
const L=(id,name,kind,amount,extra={})=>({id,date:'2026-08-18',name,kind,amount,note:'',paidBy:'shared',deleted:false,...extra});
// EXAMPLE (test only): 3 capital items + 2 lifetime expenses = ₱105,000
const EXAMPLE=[L('li-1','Drying tarps','capital',12000),L('li-2','Kiln (uling)','capital',25000),L('li-3','Used truck','capital',60000,{paidBy:'p1'}),
  L('li-4','BIR registration','expense',3500),L('li-5','Business permit','expense',4500,{paidBy:'p2'})];
const withEx=()=>({...clone(SEED),lifetime_items:clone(EXAMPLE)});
const noNaN=(o,p='K')=>{if(typeof o==='number')assert.ok(!Number.isNaN(o)&&Number.isFinite(o),`${p} is ${o}`);else if(o&&typeof o==='object')for(const k in o)noNaN(o[k],p+'.'+k)};
const strip=K=>{const o={...K};delete o.life;delete o.bid;return JSON.stringify(o)};

test('v1.4 worked example (hand-checked): average cost, break-even, best price, recovery, payback',()=>{const l=Calc.compute(withEx(),TODAY).life;
  near(l.capital,97000);near(l.oneOff,8000);near(l.total,105000);
  near(l.opCost,275510.49+5098.85);near(l.allIn,385609.34);near(l.revenue,317466+18693);near(l.copra,6893.8);
  near(l.avgOp,280609.34/6893.8,1e-9);near(l.avgAll,385609.34/6893.8,1e-9);   // 40.70 / 55.94
  assert.equal(l.beOp,38.00);   // (280,609.34 − 18,693) / 6,893.8 = 37.993 → rounded UP 38.00
  assert.equal(l.beAll,53.23);  // (385,609.34 − 18,693) / 6,893.8 = 53.224 → 53.23
  assert.equal(l.best,55.23);   // 53.23 + ₱2 default margin
  assert.equal(l.diff,-11.23);  // Settings ₱44 is ₱11.23/kg BELOW the best price
  near(l.opProfit,55549.66);near(l.recPct,55549.66/105000,1e-9);near(l.toRecover,385609.34-336159);   // 52.9% recovered, ₱49,450.34 to go
  near(l.perBatch,3480.168,0.001);assert.equal(l.payback,15)});            // 49,450.34 / 3,480.17 = 14.2 → 15 batches
test('v1.4 no lifetime items: all-in == operating, existing numbers unchanged, no NaN',()=>{const a=Calc.compute(SEED,TODAY),b=Calc.compute({...clone(SEED),lifetime_items:[]},TODAY);
  assert.equal(a.life.allIn,a.life.opCost);assert.equal(a.life.avgAll,a.life.avgOp);assert.equal(a.life.beAll,a.life.beOp);assert.equal(a.life.recPct,null);assert.equal(a.life.toRecover,0);
  assert.equal(strip(a),strip(b));assert.equal(a.bid.be,10.15);assert.equal(a.bid.good,9.65);near(a.copraNet,36856.66);near(a.combined,55549.66);noNaN(a.life);noNaN(b.bid);
  // and lifetime items (switch OFF) never move any existing dashboard number
  assert.equal(strip(Calc.compute(withEx(),TODAY)),strip(a));const be=Calc.compute(withEx(),TODAY).bid;assert.equal(be.be,10.15);assert.equal(be.good,9.65);assert.equal(be.lifeOn,false)});
test('v1.4 empty data and zero copra kg: no NaN, prices null',()=>{const E={settings:SEED.settings,batches:[],sales:[],expenses:[],charcoal:[],lifetime_items:clone(EXAMPLE)};
  let l=Calc.compute(E,TODAY).life;noNaN(l);assert.equal(l.avgAll,null);assert.equal(l.beAll,null);assert.equal(l.best,null);assert.equal(l.diff,null);near(l.toRecover,105000);assert.equal(l.payback,null);
  l=Calc.compute({...E,lifetime_items:[]},TODAY).life;noNaN(l);assert.equal(l.allIn,0);assert.equal(l.recPct,null);assert.equal(l.payback,0);
  l=Calc.compute({...E,batches:[{id:'d',no:1,rawKg:1000,buyTotal:9000,copraKg:0}]},TODAY).life;noNaN(l);assert.equal(l.copra,0);assert.equal(l.avgOp,null);near(l.allIn,114000)});
test('v1.4 unsold copra is NOT revenue (no unrealized value in break-even / recovery)',()=>{const d=withEx();d.sales.find(s=>s.kg===1329).kg=1000;const a=Calc.compute(withEx(),TODAY).life,b=Calc.compute(d,TODAY).life;
  const lost=329*d.sales.find(s=>s.kg===1000).price;near(b.revenue,a.revenue-lost);near(b.toRecover,a.toRecover+lost);assert.equal(b.beAll,a.beAll);
  near(b.revenue,317466-lost+18693);assert.ok(Calc.compute(d,TODAY).unrealized>0)});
test('v1.4 deleted lifetime items are excluded',()=>{const d=withEx();d.lifetime_items[2].deleted=true;near(Calc.compute(d,TODAY).life.total,45000);near(Calc.compute(d,TODAY).life.capital,37000)});
test('v1.4 lifetime in bid: OFF by default; ON subtracts lifetime ÷ raw kg',()=>{const d=withEx();d.settings[0].lifeInBid=true;const on=Calc.compute(d,TODAY).bid,off=Calc.compute(withEx(),TODAY).bid;
  near(on.lifePerKg,105000/29366,1e-9);near(on.beRaw,off.beRaw-105000/29366,1e-9);assert.equal(on.be,6.58);assert.equal(on.good,6.08);assert.equal(on.lifeOn,true);assert.equal(off.be,10.15)});
test('v1.4 large numbers stay finite',()=>{const d=withEx();d.lifetime_items=Array.from({length:50},(_,i)=>L('big'+i,'Big '+i,'capital',10000000));const l=Calc.compute(d,TODAY).life;near(l.total,5e8);noNaN(l)});
test('v1.4 validate(life): caps and required fields',()=>{const V=r=>Calc.validate('life',{name:'Tarps',kind:'capital',amount:100,...r});
  assert.equal(V({}),null);assert.equal(V({amount:10000000}),null);assert.match(V({amount:10000001}),/10,000,000/);assert.match(V({amount:0}),/more than 0/);assert.match(V({amount:-5}),/more than 0/);
  assert.match(V({name:'  '}),/name/);assert.match(V({name:'x'.repeat(121)}),/120/);assert.match(V({note:'x'.repeat(201)}),/200/);assert.match(V({kind:'daily'}),/Capital/);
  assert.match(V({paidBy:'eve'}),/who paid/);assert.equal(V({paidBy:'p2'}),null);assert.match(V({date:'2026-02-30'}),/Date/)});
test('v1.4 settings: lifetime margin 0–20, lifeInBid boolean, old settings without them still valid',()=>{const V=s=>Calc.validate('settings',{copraPrice:44,targetMargin:.5,startDate:'2026-08-18',ulingPrice:31,bagolRatio:.22,merienda:.04,partners:['A','B'],...s},{today:'2026-10-11'});
  assert.equal(V({}),null);assert.equal(V({lifeMargin:0,lifeInBid:true}),null);assert.equal(V({lifeMargin:20}),null);assert.match(V({lifeMargin:20.5}),/₱20/);assert.match(V({lifeMargin:-1}),/₱20/);assert.match(V({lifeInBid:'yes'}),/on or off/)});
test('v1.4 backup import rejects bad lifetime rows (nothing changes)',async()=>{const bad=[{amount:-1},{amount:10000001},{amount:'500'},{kind:'daily'},{name:''},{name:'x'.repeat(121)},{note:'x'.repeat(201)},{paidBy:'eve'},{date:'2026-13-01'},{id:'bad id!'}];
  for(const b of bad){const o=withEx();Object.assign(o.lifetime_items[0],b);assert.ok(Calc.validateBackup(o).some(e=>/lifetime_items\[0\]/.test(e)),JSON.stringify(b))}
  const dup=withEx();dup.lifetime_items[1].id=dup.lifetime_items[0].id;assert.ok(Calc.validateBackup(dup).some(e=>/duplicate id/.test(e)));
  const dup2=withEx();dup2.lifetime_items[0].id=dup2.batches[0].id;assert.ok(Calc.validateBackup(dup2).some(e=>/duplicate id/.test(e)));
  assert.deepEqual(Calc.validateBackup({...clone(SEED),lifetime_items:{}}),['Bad table "lifetime_items"']);
  const st=DB.Store();await st.replaceAll(withEx());const before=JSON.stringify(Calc.compute(await st.snapshot(),TODAY).life);const o=withEx();o.lifetime_items[0].amount=-1;
  await assert.rejects(st.replaceAll(o),/Not a valid backup/);assert.equal(JSON.stringify(Calc.compute(await st.snapshot(),TODAY).life),before)});
test('v1.4 backup export/import round-trip keeps lifetime items; unknown fields dropped; old backups still import',async()=>{const a=DB.Store();const o=withEx();o.lifetime_items[0].evil='<x>';await a.replaceAll(o);
  const exp=JSON.parse(JSON.stringify({app:'kopra',...await a.snapshot()}));const b=DB.Store();await b.replaceAll(exp);const s=await b.snapshot();
  const li=s.lifetime_items.filter(x=>!x.deleted);assert.equal(li.length,5);assert.ok(li.every(x=>!('evil' in x)&&x.updated_at));assert.deepEqual(li.map(x=>x.name).sort(),EXAMPLE.map(x=>x.name).sort());
  assert.equal(JSON.stringify(Calc.compute(s,TODAY).life),JSON.stringify(Calc.compute(await a.snapshot(),TODAY).life));
  const old=clone(SEED);delete old.lifetime_items;await b.replaceAll(old);const s2=await b.snapshot();assert.equal(s2.lifetime_items.filter(x=>!x.deleted).length,0);near(Calc.compute(s2,TODAY).copraNet,36856.66)});
test('v1.4 Reset to starting data clears lifetime items; seed has none',async()=>{assert.ok(!SEED.lifetime_items||SEED.lifetime_items.length===0);const st=DB.Store();await st.seedIfEmpty(SEED);
  await st.save('lifetime_items',EXAMPLE[0]);await st.replaceAll(SEED);const s=await st.snapshot();assert.equal(s.lifetime_items.filter(x=>!x.deleted).length,0);assert.equal(s.lifetime_items.length,1)});
test('v1.4 store: lifetime items get id, updated_at, soft delete',async()=>{const st=DB.Store();await st.seedIfEmpty(SEED);const r=await st.save('lifetime_items',{name:'Tarps',kind:'capital',amount:100});
  assert.match(r.id,/^[0-9a-f-]{36}$/);assert.ok(r.updated_at);await st.remove('lifetime_items',r.id);assert.equal((await st.adapter.get('lifetime_items',r.id)).deleted,true);
  assert.equal(Calc.compute(await st.snapshot(),TODAY).life.total,0)});
test('v1.4 v1.3.2 data (no lifetime store / settings fields) upgrades with nothing lost',async()=>{const st=DB.Store();await st.seedIfEmpty(SEED);const before=Calc.compute(await st.snapshot(),TODAY);
  assert.equal(DB.DB_VERSION,3);assert.ok(DB.TABLES.includes('lifetime_items'));const s=await st.snapshot();const after=Calc.compute(s,TODAY);assert.equal(strip(after),strip(before));assert.equal(after.life.margin,2)});
test('v1.4 sync pushes and pulls lifetime items (FIELDS include it; DB migration file exists)',async()=>{
  const T={};let seq=0;const tab=t=>T[t]||(T[t]=new Map());const srv={upsert:async(t,rows)=>rows.map(r=>{const v={...r,seq:++seq,updated_at:new Date().toISOString(),base_seq:null};tab(t).set(r.id,v);return {...v}}),
    pullSince:async(t,c)=>[...tab(t).values()].filter(r=>r.seq>c).map(r=>({...r})),getByIds:async(t,ids)=>ids.map(id=>tab(t).get(id)).filter(Boolean)};
  const A=DB.Store(),B=DB.Store();await A.seedIfEmpty(SEED);const r=await A.save('lifetime_items',{date:'2026-09-01',name:'BIR',kind:'expense',amount:3500,paidBy:'shared',note:''});await Sync.sync(A,srv);
  const w=tab('lifetime_items').get(r.id);assert.deepEqual(Object.keys(w).filter(k=>!['deleted','base_seq','seq','updated_at'].includes(k)).sort(),['amount','date','id','kind','name','note','paidBy']);
  await B.seedIfEmpty(SEED);await Sync.sync(B,srv);near(Calc.compute(await B.snapshot(),TODAY).life.total,3500);
  const sql=fs.readFileSync(path.join(ROOT,'supabase/migration_v140_lifetime.sql'),'utf8');assert.ok(sql.includes('create table if not exists lifetime_items')&&sql.includes('row level security')&&sql.includes('kopra_stamp'))});
