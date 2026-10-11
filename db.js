// Offline-first store. IndexedDB in browser, in-memory adapter for node tests.
// Every record: id (uuid), updated_at (ISO), deleted (soft delete), synced (bool).
(function(root){
const TABLES=['settings','batches','sales','expenses','charcoal'];
// Only these fields are ever kept from a backup file (anything else is dropped).
const FIELDS={settings:['id','startDate','copraPrice','targetMargin','bagolRatio','ulingPrice','partners','budget'],batches:['id','no','dev','date','source','rawKg','buyTotal','asarez','copraKg'],
  sales:['id','batch_id','date','kg','price','buyer'],expenses:['id','batch_id','date','category','amount','note'],charcoal:['id','no','dev','date','bagolKg','ulingKg','price','status','buyer'],
  common:['updated_at','deleted','seq']};
const pick=(t,r)=>{const o={};FIELDS[t].concat(FIELDS.common).forEach(k=>{if(r[k]!==undefined)o[k]=r[k]});return o};
const getCalc=()=>typeof Calc!=='undefined'?Calc:require('./calc.js');
const uuid=()=>(globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)});
let clock=0;const now=()=>{let t=Date.now();if(t<=clock)t=clock+1;clock=t;return new Date(t).toISOString()};
function memoryAdapter(){const d={};TABLES.concat(['meta']).forEach(t=>d[t]=new Map());return{
  async all(t){return [...d[t].values()].map(x=>({...x}))},async get(t,id){const x=d[t].get(id);return x?{...x}:undefined},
  async put(t,r){d[t].set(r.id,{...r})},async putMany(t,rs){rs.forEach(r=>d[t].set(r.id,{...r}))},async clear(){Object.values(d).forEach(m=>m.clear())}}}
function idbAdapter(name='kopra'){
  const open=new Promise((res,rej)=>{const q=indexedDB.open(name,1);q.onupgradeneeded=()=>{TABLES.concat(['meta']).forEach(t=>q.result.objectStoreNames.contains(t)||q.result.createObjectStore(t,{keyPath:'id'}))};q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});
  const tx=async(t,m,f)=>{const db=await open;return new Promise((res,rej)=>{const x=db.transaction(t,m),s=x.objectStore(t);const r=f(s);x.oncomplete=()=>res(r&&r.result);x.onerror=()=>rej(x.error)})};
  return{all:t=>tx(t,'readonly',s=>s.getAll()),get:(t,id)=>tx(t,'readonly',s=>s.get(id)),put:(t,r)=>tx(t,'readwrite',s=>{s.put(r)}),
    putMany:(t,rs)=>tx(t,'readwrite',s=>{rs.forEach(r=>s.put(r))}),clear:()=>Promise.all(TABLES.concat(['meta']).map(t=>tx(t,'readwrite',s=>{s.clear()})))}}
function Store(adapter){const a=adapter||memoryAdapter();const S={adapter:a,TABLES,uuid,now,
  // Fresh random IDs per install (refs remapped); records stamped now and unsynced.
  remap(data){const map={},id=o=>map[o]||(map[o]=uuid()),out={},ts=now();for(const t of TABLES)out[t]=(data[t]||[]).filter(r=>!r.deleted).map(r=>{const x={...r,id:id(r.id),updated_at:ts,deleted:false,synced:false};if(x.batch_id)x.batch_id=id(x.batch_id);delete x.server_at;delete x.seq;return x});return out},
  async seedIfEmpty(seed){const m=await a.get('meta','seeded');if(m)return false;const d=S.remap(seed);for(const t of TABLES)await a.putMany(t,d[t]);await a.put('meta',{id:'seeded',at:now()});await a.put('meta',{id:'seedOnly',v:true});return true},
  async device(){let d=await S.meta('device');if(!d){d=Math.random().toString(36).slice(2,4).toUpperCase().padEnd(2,'X');await S.meta('device',d)}return d},
  async snapshot(){const o={};for(const t of TABLES)o[t]=await a.all(t);return o},
  async save(t,rec){const r={...rec,id:rec.id||uuid(),updated_at:now(),deleted:!!rec.deleted,synced:false};delete r.server_at;await a.put(t,r);await a.put('meta',{id:'seedOnly',v:false});return r},
  async remove(t,id){const r=await a.get(t,id);if(!r)return;return S.save(t,{...r,deleted:true})},
  async unsynced(t){return (await a.all(t)).filter(r=>!r.synced)},
  async markSynced(t,ids){const rs=[];for(const id of ids){const r=await a.get(t,id);if(r){r.synced=true;rs.push(r)}}await a.putMany(t,rs)},
  async meta(k,v){if(v===undefined){const r=await a.get('meta',k);return r&&r.v}await a.put('meta',{id:k,v})},
  // Restore/reset: tombstone every current record (so the cloud copy is deleted too), then add the backup with NEW ids.
  // New ids + sticky tombstones mean a later cloud pull can never overwrite the restore.
  async replaceAll(o){const errs=getCalc().validateBackup(o);if(errs.length){const e=new Error('Not a valid backup file: '+errs.slice(0,3).join('; '));e.errors=errs;throw e}
    const clean={};for(const t of TABLES)clean[t]=o[t].map(r=>pick(t,r));const d=S.remap(clean);if(!d.settings.length)throw new Error('Backup has no settings');
    for(const t of TABLES){const ts=now();await a.putMany(t,(await a.all(t)).filter(r=>!r.deleted).map(r=>({...r,deleted:true,updated_at:ts,synced:false})))}
    for(const t of TABLES)await a.putMany(t,d[t]);await a.put('meta',{id:'seedOnly',v:false});return d},
  async wipeLocal(){const dev=await S.meta('device');await a.clear();if(dev)await S.meta('device',dev);await a.put('meta',{id:'seeded',at:now()})}};
  return S}
const api={Store,memoryAdapter,idbAdapter,TABLES,uuid,FIELDS};
if(typeof module!=='undefined')module.exports=api;else root.DB=api;
})(this);
