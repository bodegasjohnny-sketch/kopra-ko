// Pure calculations. Everything derives from stored data.
(function(root){
const sum=(a,f)=>a.reduce((t,x)=>t+(+f(x)||0),0);
const r2=n=>Math.round(n*100)/100;
function compute(db,today){
  today=today||new Date();
  const live=a=>(a||[]).filter(x=>!x.deleted);
  const st={settings:(db.settings&&db.settings.find?live(db.settings)[0]:db.settings),batches:live(db.batches),sales:live(db.sales),expenses:live(db.expenses),charcoal:live(db.charcoal)};
  const s=st.settings,B=st.batches.slice().sort((a,b)=>a.no-b.no);
  const rows=B.map(b=>{
    const sales=st.sales.filter(x=>x.batch_id===b.id),exps=st.expenses.filter(x=>x.batch_id===b.id);
    const soldKg=sum(sales,x=>x.kg),salesP=sum(sales,x=>x.kg*x.price),exp=sum(exps,x=>x.amount),gas=sum(exps.filter(x=>x.category==='Gas'),x=>x.amount);
    const copra=+b.copraKg||0,onHand=Math.max(0,copra-soldKg),cost=b.buyTotal+exp;
    const costPerKgCopra=copra?cost/copra:0;
    const soldCost=costPerKgCopra*soldKg,stockCost=costPerKgCopra*onHand;
    const sp=sales.length?sales[sales.length-1].price:s.copraPrice;
    return {...b,buy:b.rawKg?b.buyTotal/b.rawKg:0,soldKg,onHand,sales:salesP,exp,gas,cost,costPerKgCopra,
      yield:b.rawKg&&copra?copra/b.rawKg:null,sellPrice:sp,
      net:salesP-cost,               // sheet-style: all costs vs sales so far
      realized:salesP-soldCost,      // profit on the sold kg only
      stockCost,stockValue:onHand*s.copraPrice,unrealized:onHand*s.copraPrice-stockCost,
      be:b.rawKg&&copra?copra/b.rawKg*sp-exp/b.rawKg:null,
      status:!copra?'drying':onHand<=1e-9?'sold':soldKg>0?'part':'unsold'};
  });
  const done=rows.filter(r=>r.copraKg>0);
  const raw=sum(rows,r=>r.rawKg),rawDone=sum(done,r=>r.rawKg),copra=sum(done,r=>r.copraKg),buyTotal=sum(rows,r=>r.buyTotal);
  const batchExp=sum(rows,r=>r.exp),otherExp=sum(st.expenses.filter(x=>!x.batch_id&&x.category!=='Uling'),x=>x.amount);
  const sales=sum(rows,r=>r.sales),soldKg=sum(rows,r=>r.soldKg),onHand=sum(rows,r=>r.onHand);
  const realized=sum(rows,r=>r.realized)-otherExp,unrealized=sum(rows,r=>r.unrealized);
  const copraNet=sales-buyTotal-batchExp-otherExp; // cash view
  const yld=rawDone?copra/rawDone:0,expPerKg=rawDone?(sum(done,r=>r.exp)+otherExp)/rawDone:0;
  const hasData=rawDone>0&&copra>0;
  const beRaw=yld*s.copraPrice-expPerKg,be=hasData?Math.floor(beRaw*100+1e-9)/100:null,good=hasData?Math.floor((beRaw-s.targetMargin)*100+1e-9)/100:null;
  // charcoal
  const C=st.charcoal,Cd=C.filter(c=>c.status!=='burning'&&c.ulingKg>0);
  const bagolDone=sum(Cd,c=>c.bagolKg),uling=sum(Cd,c=>c.ulingKg),ulingSales=sum(Cd.filter(c=>c.status==='sold'),c=>c.ulingKg*c.price);
  const ulingYield=bagolDone?uling/bagolDone:0,ulingExp=sum(st.expenses.filter(x=>x.category==='Uling'),x=>x.amount);
  const bagolExpected=raw*s.bagolRatio,bagolLeft=Math.max(0,bagolExpected-bagolDone);
  const ulingNet=ulingSales-ulingExp,combined=realized+ulingNet;
  // time
  const start=new Date(s.startDate+'T00:00:00');const t0=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  const days=Math.max(1,Math.round((t0-start)/864e5)+1),weeks=days/7,months=days/30.44;
  // expenses by category
  const byCat={};st.expenses.forEach(x=>byCat[x.category]=(byCat[x.category]||0)+ +x.amount);
  const budget=Object.entries(s.budget).map(([k,v])=>{const act=(byCat[k]||0);return {cat:k,budgetPerKg:v,actual:act,actualPerKg:raw?act/raw:0,budgetTotal:v*raw}});
  const room=raw?(copraNet+ulingNet)/raw:0;
  const meri=byCat['Merienda / meals']||0,meriCap=s.budget['Merienda / meals']||0;
  return {rows,raw,copra,buyTotal,batchExp,otherExp,totalExp:batchExp+otherExp,sales,soldKg,onHand,copraNet,realized,unrealized,total:realized+unrealized,
    avgBuy:raw?buyTotal/raw:0,avgSell:soldKg?sales/soldKg:0,netPerKg:raw?copraNet/raw:0,margin:sales?copraNet/sales:0,
    costPerKgCopra:copra?(buyTotal+batchExp)/copra:0,stockValue:onHand*s.copraPrice,stockCost:sum(rows,r=>r.stockCost),
    bid:{hasData,yield:yld,expPerKg,sell:s.copraPrice,be,beRaw,good,margin:s.targetMargin,pct:be?s.targetMargin/be:0,gasOnly:Object.keys(byCat).every(c=>c==='Gas'||c==='Uling')},
    char:{hasCosts:ulingExp>0,burns:C,bagolDone,uling,ulingSales,ulingYield,ulingExp,ulingNet,bagolExpected,bagolLeft,potKg:bagolLeft*ulingYield,potP:bagolLeft*ulingYield*s.ulingPrice,
      bagolBE:s.ulingPrice*ulingYield},
    combined,share:combined/2,copraShare:realized/2,
    time:{days,weeks,months,rawWk:raw/weeks,rawMo:raw/months,copraWk:copra/weeks,copraMo:copra/months,netWk:copraNet/weeks,netMo:copraNet/months,combMo:(copraNet+ulingNet)/months},
    byCat,budget,room,meri:{spent:meri,capPerKg:meriCap,capTotal:meriCap*raw,capBatch:raw&&rows.length?meriCap*raw/rows.length:0,perKg:raw?meri/raw:0}};
}
const num=v=>typeof v==='number'&&isFinite(v);
const isDate=d=>d==null||d===''||(/^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d);
// Sane upper caps (documented in README). Enforced in forms AND backup import.
const CAPS={rawKg:200000,copraKg:200000,buyPrice:100,asarez:100,saleKg:200000,salePrice:200,expense:1000000,gas:1000000,bagolKg:100000,ulingKg:100000,ulingPrice:200,copraPrice:200,targetMargin:5,merienda:5,batchNo:1000000};
const fmt=n=>n.toLocaleString('en-US');
// Returns an error message (string) or null. ctx: {onHand (kg available for this batch incl. the sale being edited), today:'YYYY-MM-DD'}
function validate(kind,r,ctx={}){
  const pos=(v,m)=>!num(v)||v<=0?m:null,nn=(v,m)=>v!=null&&v!==''&&(!num(v)||v<0)?m:null,cap=(v,c,m)=>num(v)&&v>c?`${m} cannot be more than ${fmt(c)}`:null;let e;
  if(r.date!==undefined&&!isDate(r.date))return 'Date is not valid';
  if(kind==='buy'){if(e=pos(r.rawKg,'Raw kg must be more than 0'))return e;if(e=pos(r.buyPrice,'Buy price must be more than 0'))return e;
    if(e=nn(r.gas,'Gas cannot be negative'))return e;if(e=nn(r.copraKg,'Copra kg cannot be negative'))return e;if(e=nn(r.asarez,'Asarez price cannot be negative'))return e;
    if(e=cap(r.rawKg,CAPS.rawKg,'Raw kg')||cap(r.buyPrice,CAPS.buyPrice,'Buy price ₱/kg')||cap(r.asarez,CAPS.asarez,'Asarez price ₱/kg')||cap(r.gas,CAPS.gas,'Gas ₱'))return e;
    if(r.copraKg>r.rawKg)return 'Copra kg cannot be more than raw kg';if(r.minCopra!=null&&r.copraKg<r.minCopra-1e-9)return `Copra kg cannot be less than already sold (${r.minCopra} kg)`;}
  if(kind==='sale'){if(e=pos(r.kg,'Kg sold must be more than 0'))return e;if(e=pos(r.price,'Price must be more than 0'))return e;
    if(e=cap(r.kg,CAPS.saleKg,'Kg sold')||cap(r.price,CAPS.salePrice,'Copra price ₱/kg'))return e;
    if(ctx.onHand!=null&&r.kg>ctx.onHand+1e-9)return `Cannot sell ${r.kg} kg — only ${Math.round(ctx.onHand*10)/10} kg on hand`;}
  if(kind==='char'){if(e=pos(r.bagolKg,'Bagol kg must be more than 0'))return e;if(e=nn(r.ulingKg,'Uling kg cannot be negative'))return e;if(e=pos(r.price,'Uling price must be more than 0'))return e;
    if(e=cap(r.bagolKg,CAPS.bagolKg,'Bagol kg')||cap(r.price,CAPS.ulingPrice,'Uling price ₱/kg'))return e;
    if(r.ulingKg>r.bagolKg)return 'Uling kg cannot be more than bagol kg';if(!['burning','done','sold'].includes(r.status))return 'Pick a status';}
  if(kind==='exp'){if(e=pos(r.amount,'Amount must be more than 0'))return e;if(e=cap(r.amount,CAPS.expense,'Amount ₱'))return e;if(!r.category||typeof r.category!=='string'||r.category.length>60)return 'Pick a category';}
  if(kind==='settings'){if(e=pos(r.copraPrice,'Copra price must be more than 0'))return e;if(r.copraPrice>CAPS.copraPrice)return `Copra price cannot be more than ₱${CAPS.copraPrice}/kg`;
    if(!num(r.targetMargin)||r.targetMargin<0||r.targetMargin>CAPS.targetMargin)return 'Margin must be between ₱0 and ₱5';
    if(!r.startDate||!isDate(r.startDate))return 'Start date is not valid';if(ctx.today&&r.startDate>ctx.today)return 'Start date cannot be in the future';
    if(e=pos(r.ulingPrice,'Uling price must be more than 0'))return e;if(r.ulingPrice>CAPS.ulingPrice)return `Uling price cannot be more than ₱${CAPS.ulingPrice}/kg`;
    if(!num(r.bagolRatio)||r.bagolRatio<=0||r.bagolRatio>=1)return 'Bagol % must be between 0 and 1 (e.g. 0.22)';
    if(!num(r.merienda)||r.merienda<0||r.merienda>CAPS.merienda)return 'Merienda cap must be between ₱0 and ₱5 per kg';if(!Array.isArray(r.partners)||r.partners.length!==2||!r.partners.every(x=>typeof x==='string'&&x.trim()&&x.length<=40))return 'Enter both partner names';}
  return null}
// Strict backup check: types, required fields, negatives, caps, references. Returns list of errors (empty = OK).
const UUIDISH=/^[A-Za-z0-9-]{1,64}$/,STR=(v,n)=>v==null||(typeof v==='string'&&v.length<=n);
function validateBackup(o){const E=[];const T=['settings','batches','sales','expenses','charcoal'];
  if(!o||typeof o!=='object'||Array.isArray(o))return ['Not a backup file'];
  for(const t of T)if(!Array.isArray(o[t]))E.push(`Missing table "${t}"`);if(E.length)return E;
  const live=t=>o[t].filter(r=>r&&r.deleted!==true);let n=0;const ids=new Set();
  const base=(t,r,i)=>{const w=`${t}[${i}]`;if(!r||typeof r!=='object'||Array.isArray(r)){E.push(`${w}: not a record`);return false}
    if(typeof r.id!=='string'||!UUIDISH.test(r.id))E.push(`${w}: bad id`);else if(ids.has(r.id))E.push(`${w}: duplicate id`);else ids.add(r.id);
    if(r.deleted!=null&&typeof r.deleted!=='boolean')E.push(`${w}: deleted must be true/false`);if(r.date!==undefined&&!isDate(r.date))E.push(`${w}: bad date`);return true};
  const chk=(w,m)=>{if(m)E.push(`${w}: ${m}`)};
  const S=live('settings');if(S.length!==1)E.push('Backup must have exactly one settings record');
  S.forEach((r,i)=>{if(!base('settings',r,i))return;chk(`settings[${i}]`,validate('settings',{...r,merienda:r.budget&&r.budget['Merienda / meals']}));
    if(!r.budget||typeof r.budget!=='object'||!Object.values(r.budget).every(v=>num(v)&&v>=0&&v<=CAPS.merienda))E.push(`settings[${i}]: bad budget`)});
  const B=new Map();live('batches').forEach((r,i)=>{if(!base('batches',r,i))return;const w=`batches[${i}]`;
    if(!Number.isInteger(r.no)||r.no<1||r.no>CAPS.batchNo)E.push(`${w}: bad batch number`);if(!STR(r.source,120))E.push(`${w}: bad source`);if(!STR(r.dev,4)||(r.dev&&!/^[A-Z0-9]{1,4}$/.test(r.dev)))E.push(`${w}: bad device tag`);
    if(!num(r.buyTotal)||r.buyTotal<=0)E.push(`${w}: bad buyTotal`);
    chk(w,validate('buy',{rawKg:r.rawKg,buyPrice:num(r.buyTotal)&&num(r.rawKg)&&r.rawKg>0?r.buyTotal/r.rawKg:NaN,asarez:r.asarez,copraKg:r.copraKg??0}));B.set(r.id,{copra:r.copraKg||0,sold:0})});
  live('sales').forEach((r,i)=>{if(!base('sales',r,i))return;const w=`sales[${i}]`;if(!STR(r.buyer,120))E.push(`${w}: bad buyer`);
    if(!B.has(r.batch_id))E.push(`${w}: batch not found`);else B.get(r.batch_id).sold+=+r.kg||0;chk(w,validate('sale',{kg:r.kg,price:r.price}))});
  for(const[id,b]of B)if(b.sold>b.copra+1e-6)E.push(`batch ${id.slice(0,8)}: sold more copra than made`);
  live('expenses').forEach((r,i)=>{if(!base('expenses',r,i))return;const w=`expenses[${i}]`;if(r.batch_id!=null&&!B.has(r.batch_id))E.push(`${w}: batch not found`);if(!STR(r.note,200))E.push(`${w}: bad note`);chk(w,validate('exp',{amount:r.amount,category:r.category}))});
  live('charcoal').forEach((r,i)=>{if(!base('charcoal',r,i))return;const w=`charcoal[${i}]`;if(!Number.isInteger(r.no)||r.no<1||r.no>CAPS.batchNo)E.push(`${w}: bad burn number`);
    if(!STR(r.dev,4)||(r.dev&&!/^[A-Z0-9]{1,4}$/.test(r.dev)))E.push(`${w}: bad device tag`);if(!STR(r.buyer,120))E.push(`${w}: bad buyer`);chk(w,validate('char',{bagolKg:r.bagolKg,ulingKg:r.ulingKg??0,price:r.price,status:r.status}))});
  return E.slice(0,20)}
const api={compute,r2,validate,validateBackup,isDate,CAPS};
if(typeof module!=='undefined')module.exports=api;else root.Calc=api;
})(this);
