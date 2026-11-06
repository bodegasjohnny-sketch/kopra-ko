// Pure calculations. Everything derives from stored data.
(function(root){
const sum=(a,f)=>a.reduce((t,x)=>t+(+f(x)||0),0);
const r2=n=>Math.round(n*100)/100;
// Projection weights (documented in README): projected yield = 70% recent (last 5 finished batches, raw-weighted) + 30% lifetime.
const PROJ={recentN:5,wRecent:0.7,trimFrom:5};
function projYield(done){ // done: finished batches (copra known), in batch order
  if(!done.length)return null;const w=(a)=>sum(a,r=>r.copraKg)/sum(a,r=>r.rawKg);
  const recent=done.slice(-PROJ.recentN),ys=done.map(r=>r.copraKg/r.rawKg).sort((a,b)=>a-b);
  // Range ignores outliers: with 5+ batches drop the single worst and best yield (trimmed range); fewer -> full min/max.
  const rng=ys.length>=PROJ.trimFrom?ys.slice(1,-1):ys;
  return {y:PROJ.wRecent*w(recent)+(1-PROJ.wRecent)*w(done),recent:w(recent),lifetime:w(done),low:rng[0],high:rng[rng.length-1],n:done.length,trimmed:ys.length>=PROJ.trimFrom};}
const STATUS={drying:'Still drying',unsold:'Not yet sold',part:'Part sold',sold:'Complete'};
function compute(db,today){
  today=today||new Date();
  const live=a=>(a||[]).filter(x=>!x.deleted);
  const st={settings:(db.settings&&db.settings.find?live(db.settings)[0]:db.settings),batches:live(db.batches),sales:live(db.sales),expenses:live(db.expenses),charcoal:live(db.charcoal),usales:live(db.uling_sales),life:live(db.lifetime_items)};
  const s=st.settings,B=st.batches.slice().sort((a,b)=>a.no-b.no);
  const unassignedAll=st.sales.filter(x=>!x.batch_id||!B.some(b=>b.id===x.batch_id));
  let rows=B.map(b=>{const pending=unassignedAll.some(x=>x.from_batch===b.id);
    const sales=st.sales.filter(x=>x.batch_id===b.id),exps=st.expenses.filter(x=>x.batch_id===b.id);
    const soldKg=sum(sales,x=>x.kg),salesP=sum(sales,x=>x.kg*x.price),exp=sum(exps,x=>x.amount),gas=sum(exps.filter(x=>x.category==='Gas'),x=>x.amount);
    const copra=+b.copraKg||0,onHand=Math.max(0,copra-soldKg),cost=b.buyTotal+exp;
    const costPerKgCopra=copra?cost/copra:0;
    const soldCost=costPerKgCopra*soldKg,stockCost=costPerKgCopra*onHand;
    const sp=sales.length?salesP/soldKg:s.copraPrice;
    const status=!copra?'drying':onHand<=1e-9?'sold':soldKg>0?'part':'unsold';
    return {...b,buy:b.rawKg?b.buyTotal/b.rawKg:0,soldKg,onHand,sales:salesP,exp,gas,cost,costPerKgCopra,
      yield:b.rawKg&&copra?copra/b.rawKg:null,sellPrice:sp,avgSalePrice:soldKg?salesP/soldKg:null,
      net:salesP-cost,               // cash view: all costs vs sales so far
      realized:salesP-soldCost,      // profit on the sold kg only, at the ACTUAL sale price
      stockCost,stockValue:onHand*s.copraPrice,unrealized:onHand*s.copraPrice-stockCost, // unsold stock at Settings price
      be:b.rawKg&&copra?copra/b.rawKg*sp-exp/b.rawKg:null,status,statusLabel:STATUS[status],pending};
  });
  // ---- projections (drying batches) + backtest of finished batches (projection made only from batches BEFORE it)
  const ulYieldAll=(()=>{const d=st.charcoal.filter(c=>c.status!=='burning'&&c.ulingKg>0);const bg=sum(d,c=>c.bagolKg);return bg?sum(d,c=>c.ulingKg)/bg:0})();
  // Batches with an unresolved unassigned sale are EXCLUDED from yield / bid / projection maths until it is assigned.
  const doneRows=rows.filter(r=>r.copraKg>0&&!r.pending),errs=[];
  rows=rows.map(r=>{const prior=doneRows.filter(d=>d.no<r.no||(r.status==='drying'&&d!==r));const py=projYield(r.status==='drying'?doneRows:prior);
    if(!py)return {...r,proj:null};
    const pc=r.rawKg*py.y,proj={yield:py.y,copra:pc,low:r.rawKg*py.low,high:r.rawKg*py.high,value:pc*s.copraPrice,valueLow:r.rawKg*py.low*s.copraPrice,valueHigh:r.rawKg*py.high*s.copraPrice,
      bagol:r.rawKg*s.bagolRatio,uling:r.rawKg*s.bagolRatio*ulYieldAll,ulingValue:r.rawKg*s.bagolRatio*ulYieldAll*s.ulingPrice,n:py.n};
    proj.profit=proj.value-r.buyTotal-r.exp;proj.profitLow=proj.valueLow-r.buyTotal-r.exp;proj.profitHigh=proj.valueHigh-r.buyTotal-r.exp;
    if(r.copraKg>0&&!r.pending){proj.variance=r.copraKg-pc;proj.variancePct=pc?(r.copraKg-pc)/pc:0;proj.inRange=r.copraKg>=proj.low-1e-9&&r.copraKg<=proj.high+1e-9;errs.push(Math.abs(proj.variancePct))}
    return {...r,proj}});
  const drying=rows.filter(r=>r.status==='drying'&&r.proj);
  const dry={n:rows.filter(r=>r.status==='drying').length,raw:sum(rows.filter(r=>r.status==='drying'),r=>r.rawKg),copra:sum(drying,r=>r.proj.copra),low:sum(drying,r=>r.proj.low),high:sum(drying,r=>r.proj.high),
    value:sum(drying,r=>r.proj.value),uling:sum(drying,r=>r.proj.uling),ulingValue:sum(drying,r=>r.proj.ulingValue),cost:sum(rows.filter(r=>r.status==='drying'),r=>r.cost),
    profit:sum(drying,r=>r.proj.profit),profitLow:sum(drying,r=>r.proj.profitLow),profitHigh:sum(drying,r=>r.proj.profitHigh)};
  const accuracy={n:errs.length,mape:errs.length?sum(errs,x=>x)/errs.length:null,inRange:rows.filter(r=>r.proj&&r.proj.inRange).length};
  // ---- unassigned copra sales (e.g. part of a sheet row that combined two loads; user should assign it to a batch)
  const unassigned=unassignedAll;
  const unKg=sum(unassigned,x=>x.kg),unP=sum(unassigned,x=>x.kg*x.price);
  const done=rows.filter(r=>r.copraKg>0),bidRows=done.filter(r=>!r.pending),pendingRows=rows.filter(r=>r.pending);
  const raw=sum(rows,r=>r.rawKg),rawDone=sum(bidRows,r=>r.rawKg),copra=sum(done,r=>r.copraKg),copraBid=sum(bidRows,r=>r.copraKg),buyTotal=sum(rows,r=>r.buyTotal);
  const batchExp=sum(rows,r=>r.exp),otherExp=sum(st.expenses.filter(x=>!x.batch_id&&x.category!=='Uling'),x=>x.amount);
  const sales=sum(rows,r=>r.sales)+unP,soldKg=sum(rows,r=>r.soldKg)+unKg,onHand=sum(rows,r=>r.onHand);
  const realized=sum(rows,r=>r.realized)+unP-otherExp,unrealized=sum(rows,r=>r.unrealized);
  const copraNet=sales-buyTotal-batchExp-otherExp; // cash view
  const yld=rawDone?copraBid/rawDone:0,expPerKg=rawDone?(sum(bidRows,r=>r.exp)+otherExp)/rawDone:0;
  const hasData=rawDone>0&&copraBid>0;
  // v1.4 lifetime items (capital + one-off lifetime expenses). Never part of daily expenses. Optional in the bid (Settings switch, default OFF).
  const lifeCap=sum(st.life.filter(x=>x.kind==='capital'),x=>x.amount),lifeOne=sum(st.life.filter(x=>x.kind==='expense'),x=>x.amount),lifeTotal=lifeCap+lifeOne;
  const lifeOn=s.lifeInBid===true,lifeRawKg=rawDone?lifeTotal/rawDone:0;
  const beRaw=yld*s.copraPrice-expPerKg-(lifeOn?lifeRawKg:0),be=hasData?Math.floor(beRaw*100+1e-9)/100:null,good=hasData?Math.floor((beRaw-s.targetMargin)*100+1e-9)/100:null;
  // ---- uling: ONE combined pool (bagol from all batches -> burns -> uling stock -> sales)
  const C=st.charcoal,Cd=C.filter(c=>c.status!=='burning'&&c.ulingKg>0),Cb=C.filter(c=>c.status==='burning');
  const bagolDone=sum(Cd,c=>c.bagolKg),inKiln=sum(Cb,c=>c.bagolKg),uling=sum(Cd,c=>c.ulingKg),ulingYield=bagolDone?uling/bagolDone:0;
  const ulingSoldKg=sum(st.usales,x=>x.kg),ulingSales=sum(st.usales,x=>x.kg*x.price),ulingOnHand=Math.max(0,uling-ulingSoldKg);
  const ulingExp=sum(st.expenses.filter(x=>x.category==='Uling'),x=>x.amount);
  const bagolExpected=raw*s.bagolRatio,bagolLeft=Math.max(0,bagolExpected-bagolDone),bagolOnHand=Math.max(0,bagolExpected-bagolDone-inKiln);
  const ulingNet=ulingSales-ulingExp,combined=realized+ulingNet;
  const life=lifetime({rows,copra,buyTotal,sales,expenses:st.expenses,ulingSales,lifeCap,lifeOne,lifeTotal,s});
  // time
  const start=new Date(s.startDate+'T00:00:00');const t0=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  const days=Math.max(1,Math.round((t0-start)/864e5)+1),weeks=days/7,months=days/30.44;
  const byCat={};st.expenses.forEach(x=>byCat[x.category]=(byCat[x.category]||0)+ +x.amount);
  const budget=Object.entries(s.budget).map(([k,v])=>{const act=(byCat[k]||0);return {cat:k,budgetPerKg:v,actual:act,actualPerKg:raw?act/raw:0,budgetTotal:v*raw}});
  const room=raw?(copraNet+ulingNet)/raw:0;
  const meri=byCat['Merienda / meals']||0,meriCap=s.budget['Merienda / meals']||0;
  // v1.5 inventory line: raw bought not yet dried -> dried copra on hand (not sold, NOT income) -> sold.
  const inv={rawUndried:sum(rows.filter(r=>r.status==='drying'),r=>r.rawKg),lotsUndried:rows.filter(r=>r.status==='drying').length,onHand,soldKg,rawBought:raw,copraMade:copra};
  return {inv,life,rows,raw,copra,buyTotal,batchExp,otherExp,totalExp:batchExp+otherExp,sales,soldKg,onHand,copraNet,realized,unrealized,total:realized+unrealized,
    unassigned:{kg:unKg,value:unP,list:unassigned},pending:pendingRows.map(r=>({id:r.id,no:r.no,dev:r.dev,source:r.source})),dry,accuracy,projYield:projYield(bidRows),
    avgBuy:raw?buyTotal/raw:0,avgSell:soldKg?sales/soldKg:0,netPerKg:raw?copraNet/raw:0,margin:sales?copraNet/sales:0,
    costPerKgCopra:copra?(sum(done,r=>r.cost))/copra:0,stockValue:onHand*s.copraPrice,stockCost:sum(rows,r=>r.stockCost),
    bid:{lifeOn,lifePerKg:lifeRawKg,hasData,excluded:pendingRows.length,yield:yld,expPerKg,sell:s.copraPrice,be,beRaw,good,margin:s.targetMargin,pct:be?s.targetMargin/be:0,gasOnly:Object.keys(byCat).every(c=>c==='Gas'||c==='Uling')},
    char:{hasCosts:ulingExp>0,burns:C,usales:st.usales,bagolDone,inKiln,uling,ulingSoldKg,ulingOnHand,ulingSales,ulingYield,ulingExp,ulingNet,bagolExpected,bagolLeft,bagolOnHand,
      avgPrice:ulingSoldKg?ulingSales/ulingSoldKg:0,potKg:bagolLeft*ulingYield,potP:bagolLeft*ulingYield*s.ulingPrice,bagolBE:s.ulingPrice*ulingYield},
    combined,share:combined/2,copraShare:realized/2,
    time:{days,weeks,months,rawWk:raw/weeks,rawMo:raw/months,copraWk:copra/weeks,copraMo:copra/months,netWk:copraNet/weeks,netMo:copraNet/months,combMo:(copraNet+ulingNet)/months},
    byCat,budget,room,meri:{spent:meri,capPerKg:meriCap,capTotal:meriCap*raw,capBatch:raw&&rows.length?meriCap*raw/rows.length:0,perKg:raw?meri/raw:0}};
}
// v1.4 Lifetime KPIs. Revenue = REALIZED only: copra actually sold (incl. unassigned sales) + uling pool sales.
// Unsold copra adds its kg to "copra produced" but its value is NEVER counted as revenue.
//  operating cost = all batch buy costs + ALL logged expenses (gas, bills, general, uling costs)
//  all-in cost    = operating cost + lifetime items (capital + lifetime expenses)
//  avg cost/kg    = cost / copra kg produced (gross: uling revenue NOT subtracted, same as the existing cost/kg copra)
//  break-even/kg  = (cost - uling sales) / copra kg produced  (uling revenue IS netted: price needed on every kg made so far)
//  best price/kg  = all-in break-even + target lifetime margin (Settings, default PHP 2)
//  bestOp/kg      = operating-only break-even + same margin (v1.4.1, for day-to-day selling)
const LIFE={margin:2,recentN:5};
const up2=n=>n==null?null:Math.ceil(n*100-1e-9)/100; // sell-side prices round UP (never shows a price that loses money)
function lifetime(a){const{rows,copra,buyTotal,sales,expenses,ulingSales,lifeCap,lifeOne,lifeTotal,s}=a;
  const allExp=sum(expenses,x=>x.amount),opCost=buyTotal+allExp,allIn=opCost+lifeTotal,revenue=sales+ulingSales;
  const per=v=>copra>0?v/copra:null,margin=num(s.lifeMargin)?s.lifeMargin:LIFE.margin;
  const avgOp=per(opCost),avgAll=per(allIn),beOp=up2(per(opCost-ulingSales)),beAll=up2(per(allIn-ulingSales));
  const best=beAll==null?null:up2(beAll+margin),diff=best==null?null:r2(s.copraPrice-best);
  const bestOp=beOp==null?null:up2(beOp+margin),diffOp=bestOp==null?null:r2(s.copraPrice-bestOp); // v1.4.1 operating-only best price (day-to-day selling)
  const opProfit=revenue-opCost,recovered=lifeTotal>0?Math.min(lifeTotal,Math.max(0,opProfit)):0;
  const toRecover=Math.max(0,allIn-revenue),recPct=lifeTotal>0?recovered/lifeTotal:null;
  const recent=rows.filter(r=>r.status==='sold'&&!r.pending).slice(-LIFE.recentN),perBatch=recent.length?sum(recent,r=>r.net)/recent.length:null;
  const payback=toRecover<=0?0:perBatch>0?Math.ceil(toRecover/perBatch-1e-9):null;
  return {capital:lifeCap,oneOff:lifeOne,total:lifeTotal,allExp,opCost,allIn,revenue,copraSales:sales,ulingSales,copra,avgOp,avgAll,overheadPerKg:per(lifeTotal),
    beOp,beAll,margin,best,price:s.copraPrice,diff,bestOp,diffOp,opProfit,recovered,recPct,toRecover,perBatch,recentN:recent.length,payback}}
// Unassigned copra sales (split off when a batch's copra was cut below its sold kg) must each point (from_batch) to a real live
// batch, and per batch lineage: assigned + unassigned kg <= copra the batch had when split (lineage_copra), never above its raw kg.
// Shared by backup import AND the in-app save path so the app can never create a state its own importer rejects.
function lineageErrors(o){const E=[],lv=t=>(Array.isArray(o[t])?o[t]:[]).filter(r=>r&&!r.deleted);const B=new Map(lv('batches').map(b=>[b.id,b]));
  const L=new Map();for(const s of lv('sales')){if(s.batch_id!=null&&B.has(s.batch_id)){const x=L.get(s.batch_id)||{as:0,un:0,lc:0};x.as+=+s.kg||0;L.set(s.batch_id,x);continue}
    if(s.batch_id!=null)continue; // missing batch reported elsewhere
    if(typeof s.from_batch!=='string'||!B.has(s.from_batch)){E.push(`unassigned sale ${String(s.id).slice(0,8)} (${+s.kg||0} kg): must come from a real batch (from_batch)`);continue}
    const x=L.get(s.from_batch)||{as:0,un:0,lc:0};x.un+=+s.kg||0;x.lc=Math.max(x.lc,+s.lineage_copra||0);L.set(s.from_batch,x)}
  for(const[id,x]of L){if(!x.un)continue;const b=B.get(id),cap=Math.min(Math.max(+b.copraKg||0,x.lc),+b.rawKg||0);
    if(x.as+x.un>cap+1e-6)E.push(`batch #${b.no}: sold ${Math.round((x.as+x.un)*10)/10} kg (incl. unassigned) but only ${Math.round(cap*10)/10} kg copra made`)}
  return E}
// Uling pool guard: would changing/deleting a burn make uling made < uling already sold? nb = new burn or null (delete).
function poolCheck(K,ob,nb){const made=b=>b&&b.status!=='burning'&&!b.deleted?(+b.ulingKg||0):0;const after=K.char.uling-made(ob)+made(nb);
  return after<K.char.ulingSoldKg-1e-9?`Not allowed: uling made would drop to ${Math.round(after*10)/10} kg but ${Math.round(K.char.ulingSoldKg*10)/10} kg is already sold. Delete or reduce uling sales first.`:null}
// Projection for a NEW batch being typed in the buy form (raw kg + buy total + bills).
function projectNew(K,s,rawKg,buyTotal,bills){const py=K.projYield;if(!py||!(rawKg>0))return null;const pc=rawKg*py.y;const v=pc*s.copraPrice;
  const ul=rawKg*s.bagolRatio*K.char.ulingYield;return {yield:py.y,copra:pc,low:rawKg*py.low,high:rawKg*py.high,value:v,uling:ul,ulingValue:ul*s.ulingPrice,profit:v-buyTotal-(bills||0),
    profitLow:rawKg*py.low*s.copraPrice-buyTotal-(bills||0),profitHigh:rawKg*py.high*s.copraPrice-buyTotal-(bills||0)}}
const num=v=>typeof v==='number'&&isFinite(v);
const isDate=d=>d==null||d===''||(/^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d);
// Sane upper caps (documented in README). Enforced in forms AND backup import.
const CAPS={rawKg:200000,copraKg:200000,buyPrice:100,asarez:100,saleKg:200000,salePrice:200,expense:1000000,gas:1000000,bagolKg:100000,ulingKg:100000,ulingPrice:200,copraPrice:200,targetMargin:5,merienda:5,batchNo:1000000,lifeAmount:10000000,lifeMargin:20};
const LIFE_KINDS=['capital','expense'],PAID_BY=['p1','p2','shared'];
const fmt=n=>n.toLocaleString('en-US'),STR=(v,n)=>v==null||(typeof v==='string'&&v.length<=n);
// Returns an error message (string) or null. ctx: {onHand (kg available for this batch incl. the sale being edited), today:'YYYY-MM-DD'}
function validate(kind,r,ctx={}){
  const pos=(v,m)=>!num(v)||v<=0?m:null,nn=(v,m)=>v!=null&&v!==''&&(!num(v)||v<0)?m:null,cap=(v,c,m)=>num(v)&&v>c?`${m} cannot be more than ${fmt(c)}`:null;let e;
  if(r.date!==undefined&&!isDate(r.date))return 'Date is not valid';
  if(kind==='buy'){if(e=pos(r.rawKg,'Raw kg must be more than 0'))return e;if(e=pos(r.buyPrice,'Buy price must be more than 0'))return e;
    if(e=nn(r.gas,'Gas cannot be negative'))return e;if(e=nn(r.copraKg,'Copra kg cannot be negative'))return e;if(e=nn(r.asarez,'Asarez price cannot be negative'))return e;
    if(e=cap(r.rawKg,CAPS.rawKg,'Raw kg')||cap(r.buyPrice,CAPS.buyPrice,'Buy price ₱/kg')||cap(r.asarez,CAPS.asarez,'Asarez price ₱/kg')||cap(r.gas,CAPS.gas,'Gas ₱'))return e;
    if(r.paidBy!=null&&r.paidBy!==''&&!PAID_BY.includes(r.paidBy))return 'Pick who paid';
    if(r.copraKg>r.rawKg)return 'Copra kg cannot be more than raw kg';if(r.minCopra!=null&&r.copraKg<r.minCopra-1e-9)return `Copra kg cannot be less than already sold (${r.minCopra} kg)`;}
  if(kind==='sale'){if(e=pos(r.kg,'Kg sold must be more than 0'))return e;if(e=pos(r.price,'Price must be more than 0'))return e;
    if(e=cap(r.kg,CAPS.saleKg,'Kg sold')||cap(r.price,CAPS.salePrice,'Copra price ₱/kg'))return e;
    if(r.receivedBy!=null&&r.receivedBy!==''&&!PAID_BY.includes(r.receivedBy))return 'Pick who got the money';
    if(ctx.onHand!=null&&r.kg>ctx.onHand+1e-9)return `Cannot sell ${r.kg} kg — only ${Math.round(ctx.onHand*10)/10} kg on hand`;}
  // v1.5 Yield tracker: dried copra for one bought lot. ctx: {rawKg of the lot, soldKg already sold from it}
  if(kind==='yield'){if(e=pos(r.copraKg,'Dried copra kg must be more than 0'))return e;if(!isDate(r.dryDate))return 'Date is not valid';
    if(ctx.rawKg!=null&&r.copraKg>ctx.rawKg+1e-9)return `Copra kg cannot be more than the ${fmt(ctx.rawKg)} kg raw in this lot`;
    if(ctx.soldKg&&r.copraKg<ctx.soldKg-1e-9)return `Copra kg cannot be less than already sold (${Math.round(ctx.soldKg*10)/10} kg)`;}
  if(kind==='char'){if(e=pos(r.bagolKg,'Bagol kg must be more than 0'))return e;if(e=nn(r.ulingKg,'Uling kg cannot be negative'))return e;
    if(e=cap(r.bagolKg,CAPS.bagolKg,'Bagol kg'))return e;if(r.price!=null&&(e=nn(r.price,'Uling price cannot be negative')||cap(r.price,CAPS.ulingPrice,'Uling price ₱/kg')))return e;
    if(r.ulingKg>r.bagolKg)return 'Uling kg cannot be more than bagol kg';if(!['burning','done','sold'].includes(r.status))return 'Pick a status';
    if(r.status==='done'&&!(r.ulingKg>0))return 'Enter uling kg for a finished burn';}
  if(kind==='usale'){if(e=pos(r.kg,'Uling kg sold must be more than 0'))return e;if(e=pos(r.price,'Uling price must be more than 0'))return e;
    if(e=cap(r.kg,CAPS.ulingKg,'Uling kg')||cap(r.price,CAPS.ulingPrice,'Uling price ₱/kg'))return e;
    if(ctx.onHand!=null&&r.kg>ctx.onHand+1e-9)return `Cannot sell ${r.kg} kg uling — only ${Math.round(ctx.onHand*10)/10} kg in the pool`;}
  if(kind==='exp'){if(e=pos(r.amount,'Amount must be more than 0'))return e;if(e=cap(r.amount,CAPS.expense,'Amount ₱'))return e;if(!r.category||typeof r.category!=='string'||r.category.length>60)return 'Pick a category';}
  if(kind==='settings'){if(e=pos(r.copraPrice,'Copra price must be more than 0'))return e;if(r.copraPrice>CAPS.copraPrice)return `Copra price cannot be more than ₱${CAPS.copraPrice}/kg`;
    if(!num(r.targetMargin)||r.targetMargin<0||r.targetMargin>CAPS.targetMargin)return 'Margin must be between ₱0 and ₱5';
    if(!r.startDate||!isDate(r.startDate))return 'Start date is not valid';if(ctx.today&&r.startDate>ctx.today)return 'Start date cannot be in the future';
    if(e=pos(r.ulingPrice,'Uling price must be more than 0'))return e;if(r.ulingPrice>CAPS.ulingPrice)return `Uling price cannot be more than ₱${CAPS.ulingPrice}/kg`;
    if(!num(r.bagolRatio)||r.bagolRatio<=0||r.bagolRatio>=1)return 'Bagol % must be between 0 and 1 (e.g. 0.22)';
    if(r.lifeMargin!=null&&(!num(r.lifeMargin)||r.lifeMargin<0||r.lifeMargin>CAPS.lifeMargin))return 'Lifetime margin must be between ₱0 and ₱20';
    if(r.lifeInBid!=null&&typeof r.lifeInBid!=='boolean')return 'Lifetime-in-bid must be on or off';
    if(!num(r.merienda)||r.merienda<0||r.merienda>CAPS.merienda)return 'Merienda cap must be between ₱0 and ₱5 per kg';if(!Array.isArray(r.partners)||r.partners.length!==2||!r.partners.every(x=>typeof x==='string'&&x.trim()&&x.length<=40))return 'Enter both partner names';}
  if(kind==='life'){if(typeof r.name!=='string'||!r.name.trim())return 'Enter a name (e.g. Drying tarps, BIR registration)';if(r.name.length>120)return 'Name cannot be more than 120 characters';
    if(!LIFE_KINDS.includes(r.kind))return 'Pick Capital or Lifetime expense';if(e=pos(r.amount,'Amount must be more than 0'))return e;if(e=cap(r.amount,CAPS.lifeAmount,'Amount ₱'))return e;
    if(!STR(r.note,200))return 'Note cannot be more than 200 characters';if(r.paidBy!=null&&r.paidBy!==''&&!PAID_BY.includes(r.paidBy))return 'Pick who paid';}
  return null}
// Strict backup check: types, required fields, negatives, caps, references. Returns list of errors (empty = OK).
const UUIDISH=/^[A-Za-z0-9-]{1,64}$/;
function validateBackup(o){const E=[];const T=['settings','batches','sales','expenses','charcoal'];
  if(!o||typeof o!=='object'||Array.isArray(o))return ['Not a backup file'];
  for(const t of T)if(!Array.isArray(o[t]))E.push(`Missing table "${t}"`);if(o.uling_sales!=null&&!Array.isArray(o.uling_sales))E.push('Bad table "uling_sales"');if(o.lifetime_items!=null&&!Array.isArray(o.lifetime_items))E.push('Bad table "lifetime_items"');if(E.length)return E;
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
    chk(w,validate('buy',{rawKg:r.rawKg,buyPrice:num(r.buyTotal)&&num(r.rawKg)&&r.rawKg>0?r.buyTotal/r.rawKg:NaN,asarez:r.asarez,copraKg:r.copraKg??0,paidBy:r.paidBy}));if(!isDate(r.dryDate))E.push(`${w}: bad dryDate`);B.set(r.id,{copra:r.copraKg||0,raw:r.rawKg,sold:0})});
  live('sales').forEach((r,i)=>{if(!base('sales',r,i))return;const w=`sales[${i}]`;if(!STR(r.buyer,120))E.push(`${w}: bad buyer`);
    if(r.from_batch!=null&&(typeof r.from_batch!=='string'||!UUIDISH.test(r.from_batch)))E.push(`${w}: bad from_batch`);
    if(r.lineage_copra!=null&&(!num(r.lineage_copra)||r.lineage_copra<0||r.lineage_copra>CAPS.rawKg))E.push(`${w}: bad lineage_copra`);
    if(r.batch_id!=null&&!B.has(r.batch_id))E.push(`${w}: batch not found`);else if(r.batch_id!=null)B.get(r.batch_id).sold+=+r.kg||0;chk(w,validate('sale',{kg:r.kg,price:r.price,receivedBy:r.receivedBy}))});
  for(const[id,b]of B)if(b.sold>b.copra+1e-6)E.push(`batch ${id.slice(0,8)}: sold more copra than made`);
  E.push(...lineageErrors(o));
  live('expenses').forEach((r,i)=>{if(!base('expenses',r,i))return;const w=`expenses[${i}]`;if(r.batch_id!=null&&!B.has(r.batch_id))E.push(`${w}: batch not found`);if(!STR(r.note,200))E.push(`${w}: bad note`);chk(w,validate('exp',{amount:r.amount,category:r.category}))});
  live('charcoal').forEach((r,i)=>{if(!base('charcoal',r,i))return;const w=`charcoal[${i}]`;if(!Number.isInteger(r.no)||r.no<1||r.no>CAPS.batchNo)E.push(`${w}: bad burn number`);
    if(!STR(r.dev,4)||(r.dev&&!/^[A-Z0-9]{1,4}$/.test(r.dev)))E.push(`${w}: bad device tag`);if(!STR(r.buyer,120))E.push(`${w}: bad buyer`);chk(w,validate('char',{bagolKg:r.bagolKg,ulingKg:r.ulingKg??0,price:r.price??null,status:r.status}))});
  let made=sum(live('charcoal').filter(c=>c.status!=='burning'),c=>+c.ulingKg||0),sold=0;
  (o.uling_sales?o.uling_sales.filter(r=>r&&r.deleted!==true):[]).forEach((r,i)=>{if(!base('uling_sales',r,i))return;const w=`uling_sales[${i}]`;if(!STR(r.buyer,120))E.push(`${w}: bad buyer`);sold+=+r.kg||0;chk(w,validate('usale',{kg:r.kg,price:r.price}))});
  if(sold>made+1e-6)E.push('Uling sold is more than uling made');
  (o.lifetime_items?o.lifetime_items.filter(r=>r&&r.deleted!==true):[]).forEach((r,i)=>{if(!base('lifetime_items',r,i))return;const w=`lifetime_items[${i}]`;
    chk(w,validate('life',{name:r.name,kind:r.kind,amount:r.amount,note:r.note,paidBy:r.paidBy}))});
  return E.slice(0,20)}
// Read-only provenance for Home. Values come from the SAME compute() snapshot as the cards.
// No storage, network, settings changes, or alternate accounting calculation is performed here.
const DETAIL_KEYS=['inventory','rawUndried','onHand','sold','copraNet','combined','share','capital','avgBuy','netPerKg','raw','yield',
  'bid','goodBid','breakEven','lossBid','lifetime','profit','realized','unrealized','total','unassigned','drying',
  'stock','duration','priceChart','sellChart','plChart','expenses','budget','charcoal','bagol','ulingStock','ulingNet','ulingYield','batches'];
function explain(db,K,key,showDevice=false){
  if(!DETAIL_KEYS.includes(key))return null;
  const lv=t=>(db[t]||[]).filter(x=>!x.deleted),R=K.rows,E=lv('expenses'),sales=lv('sales'),L=K.life,c=K.char;
  const s=Array.isArray(db.settings)?lv('settings')[0]:db.settings;
  const n=v=>v==null?'—':Number(v).toLocaleString('en-PH',{maximumFractionDigits:4});
  const p=v=>v==null?'—':(v<0?'−':'')+'₱'+Math.abs(v).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const pct=v=>v==null?'—':n(v*100)+'%',kg=v=>n(v)+' kg';
  const label=r=>r?'#'+r.no+(showDevice&&r.dev?'-'+r.dev:''):'not assigned';
  const batch=id=>R.find(r=>r.id===id),scope=x=>x.batch_id?label(batch(x.batch_id)):'general / pool';
  const dry=R.filter(r=>r.status==='drying'),eligible=R.filter(r=>r.copraKg>0&&!r.pending),ids=new Set(eligible.map(r=>r.id));
  const general=E.filter(x=>!x.batch_id&&x.category!=='Uling');
  const copraExp=E.filter(x=>batch(x.batch_id)||(!x.batch_id&&x.category!=='Uling'));
  const bidExp=E.filter(x=>ids.has(x.batch_id)||(!x.batch_id&&x.category!=='Uling'));
  const ulExp=E.filter(x=>x.category==='Uling');
  const d={key,title:'',value:'',lines:[],notes:['From records currently stored on this device. Deleted records are excluded. Read-only: nothing is uploaded or changed. Displayed inputs may be rounded; calculations retain full precision.'],groups:[]};
  const line=(label,formula,value)=>d.lines.push({label,formula,value});
  const group=(title,columns,records,values,empty='No matching records on this device.')=>d.groups.push({title,columns,rows:records.map(r=>({id:r.id,cells:values(r)})),empty});
  const batches=(rs=R,title='Contributing batches')=>group(title,['Batch','Bought','Supplier','Raw kg','Copra kg','Buying ₱','Linked bills ₱','Sold kg','On hand kg','Status','Record ID'],rs,r=>[label(r),r.date||'No date',r.source||'—',n(r.rawKg),n(r.copraKg||0),p(r.buyTotal),p(r.exp),n(r.soldKg),n(r.onHand),r.statusLabel+(r.pending?' · unassigned sale pending':''),r.id]);
  const saleGroup=(ss=sales,title='Copra sales included')=>group(title,['Record','Date','Batch / lineage','Buyer','Kg','Actual ₱/kg','Revenue ₱'],ss,x=>[x.id,x.date||'No date',batch(x.batch_id)?label(batch(x.batch_id)):'not assigned; from '+label(batch(x.from_batch))+'; copra at split '+kg(x.lineage_copra),x.buyer||'—',n(x.kg),p(x.price),p(x.kg*x.price)]);
  const expenses=(es,title='Expenses included')=>group(title,['Record','Date','Category','Scope','Note','Amount ₱'],es,x=>[x.id,x.date||'No date',x.category,scope(x),x.note||'—',p(x.amount)]);
  const lifetimeItems=()=>group('Lifetime items (separate from daily bills)',['Record','Date','Name','Kind','Note','Amount ₱'],lv('lifetime_items'),x=>[x.id,x.date||'No date',x.name,x.kind,x.note||'—',p(x.amount)],'No lifetime items. All-in equals operating-only cost.');
  const allocations=(rs=R)=>group('Per-batch allocation (partial sales keep unsold cost in stock)',['Batch','Cost / kg copra','Sold cost ₱','Realized ₱','Stock cost ₱','Stock value ₱','Unrealized ₱','Cash net ₱'],rs,r=>[label(r),p(r.costPerKgCopra),p(r.costPerKgCopra*r.soldKg),p(r.realized),p(r.stockCost),p(r.stockValue),p(r.unrealized),p(r.net)]);
  const burns=()=>group('Burns in the combined pool',['Burn','Date','Bagol kg','Uling kg entered','Status','Included in made / yield','Record ID'],c.burns,x=>[label(x),x.date||'No date',n(x.bagolKg),n(x.ulingKg||0),x.status==='burning'?'In kiln':'Done',x.status!=='burning'&&x.ulingKg>0?'Yes':'No',x.id]);
  const usales=()=>group('Uling pool sales',['Record','Date','Buyer','Kg','Actual ₱/kg','Revenue ₱'],c.usales,x=>[x.id,x.date||'No date',x.buyer||'—',n(x.kg),p(x.price),p(x.kg*x.price)]);
  const costNote=()=>d.notes.push(c.hasCosts?'Uling net subtracts only logged Uling-category expenses. Missing labor, fuel or other burning costs still overstate profit.':'Uling is GROSS revenue: no Uling costs are logged. Burning costs are missing, not zero. Combined / partner amounts are not fully costed net profit.');
  const cash=()=>{line('Copra cash net','copra sales − all batch buying − linked batch bills − general non-Uling bills',p(K.copraNet));line('Inputs',p(K.sales)+' − '+p(K.buyTotal)+' − '+p(K.batchExp)+' − '+p(K.otherExp),p(K.copraNet));};
  const real=()=>{line('Sold-cost allocation','(buying + ALL linked bills) ÷ copra made × assigned sold kg, per batch','See allocation table');line('Copra realized','Σ(batch sales − allocated sold cost) + unassigned sales − general non-Uling bills',p(K.realized));d.notes.push('Drying / unsold batches have no allocated sold cost yet. Their full buying outflow is in cash net, not realized profit. Unassigned sales retain revenue but have no additional allocated cost until linked.');};
  const copraSources=()=>{batches();saleGroup();expenses(copraExp);expenses(E.filter(x=>!copraExp.includes(x)),'Expenses excluded from copra cash net');d.notes.push('Unsold stock, projections, charcoal revenue and lifetime items are not copra cash income. ALL linked bills count in a batch cost, even a linked Uling-category bill (existing accounting rule).');};
  const ul=()=>{line('Uling made','Σ uling kg of finished burns with positive output',kg(c.uling));line('Uling sold / revenue','Σ pool sale kg / Σ(kg × actual price)',kg(c.ulingSoldKg)+' / '+p(c.ulingSales));line('Uling result',p(c.ulingSales)+' sales − '+p(c.ulingExp)+' logged Uling costs',p(c.ulingNet));burns();usales();expenses(ulExp,'Logged Uling costs');costNote();d.notes.push('Burns are one shared pool, not allocated to copra batches. In-kiln burns add no uling stock or income. A burn record itself is not a sale.');};
  const bid=()=>{const raw=sum(eligible,r=>r.rawKg),made=sum(eligible,r=>r.copraKg);
    line('Eligible yield',kg(made)+' dried copra ÷ '+kg(raw)+' raw (weighted, not average of percentages)',pct(K.bid.yield));
    line('Expense / kg eligible raw',p(sum(bidExp,x=>x.amount))+' eligible linked bills + general non-Uling bills, divided by '+kg(raw),p(K.bid.expPerKg));
    line('Settings copra price','Current Settings price; NOT historical average sale price',p(K.bid.sell)+'/kg copra');
    line('Lifetime cost / eligible raw',p(L.total)+' ÷ '+kg(raw)+(K.bid.lifeOn?' · included':' · switch OFF, not subtracted'),p(K.bid.lifePerKg)+'/kg raw');
    line('Unrounded break-even','yield × Settings copra price − expense/kg − '+(K.bid.lifeOn?'lifetime/kg':'0 lifetime/kg (OFF)'),K.bid.hasData?n(K.bid.beRaw)+' ₱/kg raw':'—');
    line('Break-even / loss boundary','floor(unrounded break-even × 100) ÷ 100; any higher bid is loss-making',p(K.bid.be));
    line('Good bid','floor((unrounded break-even − '+p(K.bid.margin)+' target margin) × 100) ÷ 100',p(K.bid.good));
    batches(eligible,'Eligible finished batches (includes unsold dried copra)');
    group('Excluded batches',['Batch','Supplier','Reason'],R.filter(r=>!ids.has(r.id)),r=>[label(r),r.source||'—',r.pending?'Unassigned sale pending (excluded until linked)':'Still drying: no known copra yield']);
    expenses(bidExp,'Bid expenses included');expenses(E.filter(x=>!bidExp.includes(x)),'Bid expenses excluded');saleGroup(K.unassigned.list,'Unassigned sales (revenue retained, lineage excluded from yield)');lifetimeItems();
    d.notes.push('No eligible raw / dried copra means no bid (—). General non-Uling bills count even when other batches are drying. Lifetime costs use eligible raw kg, NOT all purchased raw kg.');
    d.notes.push('Uling income, buy prices, actual sale prices and stock valuations are excluded from bid math. Finished unsold batches DO contribute their known yield. Both bid prices round down independently from the unrounded benchmark.');
    if(K.bid.gasOnly)d.notes.push('Gas-only warning: other operating costs have not been logged. The benchmark will fall when those costs are added.');};
  switch(key){
    case 'inventory':d.title='Stock now: raw → dried → sold';d.value=kg(K.onHand)+' copra on hand';line('Raw not yet dried','Σ raw kg of batches without dried copra',kg(K.inv.rawUndried)+' / '+n(K.inv.lotsUndried)+' lots');line('Copra on hand','Σ max(0, batch copra made − assigned sold kg)',kg(K.onHand));line('Sold','Σ copra sale kg, including unassigned sales',kg(K.soldKg));batches();saleGroup();d.notes.push('Raw and dried-but-unsold stock are NOT income. Only actual sales count as revenue. Unassigned sales do not silently reduce a batch stock balance.');break;
    case 'rawUndried':d.title='Raw, not yet dried';d.value=kg(K.inv.rawUndried);line('Raw drying','Σ raw kg where no dried copra kg is recorded',kg(K.inv.rawUndried));line('Lots','Count of those batches',n(K.inv.lotsUndried));batches(dry);batches(R.filter(r=>r.status!=='drying'),'Excluded: already dried');d.notes.push('Raw drying is stock, not sales, income, or dried copra.');break;
    case 'onHand':case 'stock':d.title='Unsold copra on hand';d.value=kg(K.onHand);line('On hand','Σ max(0, batch copra kg − assigned sold kg)',kg(K.onHand));line('Cost basis','Σ ((buying + linked bills) ÷ copra made × on-hand kg)',p(K.stockCost));line('Stock value',kg(K.onHand)+' × '+p(s.copraPrice)+' Settings price',p(K.stockValue));line('Potential profit','stock value − stock cost',p(K.unrealized));batches(R.filter(r=>r.onHand>0));allocations(R.filter(r=>r.onHand>0));saleGroup(sales.filter(x=>R.some(r=>r.onHand>0&&r.id===x.batch_id)),'Sales deducted from these batches');expenses(E.filter(x=>R.some(r=>r.onHand>0&&r.id===x.batch_id)),'Bills in stock cost');batches(R.filter(r=>r.onHand<=0),'Excluded: no dried stock on hand');d.notes.push('Unsold copra is NOT income. Only linked sales reduce batch stock; unassigned sales remain separately flagged, never silently assigned. General bills and lifetime items are not allocated into stock cost.');break;
    case 'sold':case 'unassigned':d.title=key==='sold'?'Copra actually sold':'Unassigned copra sales';d.value=kg(key==='sold'?K.soldKg:K.unassigned.kg);line('Sold kg','Σ live copra sale kg, including unassigned sales',kg(K.soldKg));line('Sales revenue','Σ (sale kg × actual sale price)',p(K.sales));line('Unassigned portion','Retained in sold kg and revenue; not invented as a new batch',kg(K.unassigned.kg)+' / '+p(K.unassigned.value));saleGroup(key==='sold'?sales:K.unassigned.list);batches(key==='sold'?R.filter(r=>r.soldKg>0):R.filter(r=>r.pending));d.notes.push('Dried-but-unsold stock and uling sales are excluded. A sale is recorded revenue, not a forecast. Unassigned sales keep their source batch / copra-at-split lineage; assign via Records.');break;
    case 'copraNet':d.title='Copra net income (cash view)';d.value=p(K.copraNet);cash();copraSources();break;
    case 'capital':d.title='Capital spent (batch buying)';d.value=p(K.buyTotal);line('Buying','Σ buyTotal across every live batch, including drying / unsold',p(K.buyTotal));line('Expenses beside the card','linked batch bills + general non-Uling bills',p(K.totalExp));copraSources();d.notes.push('This card is batch buying outlay, NOT the separate Lifetime capital-items total. The headline rounds to whole pesos; these details retain centavos.');break;
    case 'avgBuy':d.title='Weighted average buy price';d.value=p(K.avgBuy)+'/kg raw';line('Weighted buy',p(K.buyTotal)+' buying ÷ '+kg(K.raw)+' raw',p(K.avgBuy));batches();d.notes.push('Includes drying, unsold and sold batches. Not a simple average of batch prices. Expenses and lifetime items excluded. With no raw kg, the existing card shows zero.');break;
    case 'netPerKg':d.title='Net per kg raw / margin';d.value=p(K.netPerKg)+'/kg raw';cash();line('Net per raw kg',p(K.copraNet)+' ÷ '+kg(K.raw),p(K.netPerKg));line('Cash margin',p(K.copraNet)+' ÷ '+p(K.sales)+' copra sales',pct(K.margin));copraSources();d.notes.push('Raw denominator includes drying / unsold lots. No raw kg or no sales gives zero for that ratio. Uling and lifetime items excluded.');break;
    case 'raw':d.title='Raw bought → copra made';d.value=kg(K.raw);line('Raw bought','Σ raw kg of all live batches',kg(K.raw));line('Copra made','Σ known dried copra kg (sold + unsold)',kg(K.copra));batches();d.notes.push('The arrow is production, NOT sales. Drying lots add raw kg only. Pending-lineage batches still count here, but not in bid yield.');break;
    case 'yield':d.title='Average yield / sold average price';d.value=pct(K.bid.yield);bid();line('Sold average price',p(K.sales)+' actual copra sales ÷ '+kg(K.soldKg)+' sold (including unassigned)',p(K.avgSell)+'/kg');saleGroup();break;
    case 'bid':case 'goodBid':case 'breakEven':case 'lossBid':d.title={bid:'Bid Guide (lifetime benchmark)',goodBid:'Good bid',breakEven:'Break-even bid',lossBid:'Loss bid boundary'}[key];d.value=p(key==='goodBid'?K.bid.good:K.bid.be)+'/kg raw';bid();break;
    case 'combined':case 'share':case 'profit':case 'realized':case 'unrealized':case 'total':
      d.title={combined:'Copra realized + uling result',share:'Each partner (50/50)',profit:'Profit: sold vs. not yet sold',realized:'Realized copra profit',unrealized:'Unrealized copra profit',total:'Total copra profit (including stock estimate)'}[key];
      d.value=p({combined:K.combined,share:K.share,profit:K.total,realized:K.realized,unrealized:K.unrealized,total:K.total}[key]);
      cash();real();line('Unrealized','Σ (on-hand kg × Settings price − allocated stock cost)',p(K.unrealized));line('Copra total','realized + unrealized (not all cash income)',p(K.total));line('Copra total per partner','(realized + unrealized) ÷ 2; includes unsold stock estimate',p(K.total/2));
      if(key==='combined'||key==='share'){line('Combined','copra REALIZED + uling sales − logged Uling expenses',p(K.combined));line('Copra realized per partner',p(K.realized)+' ÷ 2',p(K.realized/2));line('Uling result per partner',p(c.ulingNet)+' ÷ 2',p(c.ulingNet/2));line('Each partner',p(K.combined)+' ÷ 2',p(K.share));line('Partners (Settings)',s.partners.join(' / '),'50/50, not based on who paid');ul();}
      copraSources();allocations();d.notes.push('The combined / sharing headline uses REALIZED copra, NOT cash copra net; these differ with partial sales, drying or unsold stock. No unrealized stock value, projections or lifetime costs enter sharing. A linked Uling bill remains in batch cost AND Uling costs under the existing rules; no reclassification is done here.');break;
    case 'lifetime':d.title='Lifetime all-in benchmarks';d.value=p(L.best)+'/kg best all-in';line('Operating cost',p(K.buyTotal)+' batch buying + '+p(L.allExp)+' ALL logged expenses',p(L.opCost));line('Lifetime items','capital '+p(L.capital)+' + one-off expenses '+p(L.oneOff),p(L.total));line('All-in cost','operating + lifetime items',p(L.allIn));line('Average cost / kg copra',p(L.allIn)+' ÷ '+kg(K.copra)+' produced; uling NOT netted',p(L.avgAll));line('Operating break-even','ceil cents(('+p(L.opCost)+' − '+p(c.ulingSales)+' uling sales) ÷ '+kg(K.copra)+')',p(L.beOp));line('All-in break-even','ceil cents(('+p(L.allIn)+' − '+p(c.ulingSales)+' uling sales) ÷ '+kg(K.copra)+')',p(L.beAll));line('Operating best price','rounded operating break-even + '+p(L.margin)+' Settings lifetime margin, rounded UP',p(L.bestOp));line('All-in best price','rounded all-in break-even + '+p(L.margin)+' Settings lifetime margin, rounded UP',p(L.best));batches();expenses(E,'All logged operating expenses');lifetimeItems();usales();costNote();d.notes.push('All live batches count, including pending lineage and drying buying costs. Denominator is all dried copra produced, including unsold; no copra kg means —. These are selling-price benchmarks, NOT raw buying bids. Uling SALES are netted only in break-even, not average cost. Unsold stock value and projected revenue are excluded.');break;
    case 'drying':d.title='Drying projections / back-test';d.value=kg(K.dry.copra)+' projected copra';
      line('Raw drying','Σ raw kg of drying batches / batch count',kg(K.dry.raw)+' / '+n(K.dry.n)+' batches');line('Projected yield','70% × raw-weighted yield of last '+PROJ.recentN+' eligible batches + 30% × all eligible weighted yield',pct(K.projYield?.y));line('Projected copra','Σ (drying raw kg × projected yield)',kg(K.dry.copra));line('Range','raw × low/high eligible yield; drop ONE lowest and highest yield with '+PROJ.trimFrom+'+ batches',kg(K.dry.low)+' to '+kg(K.dry.high));line('Projected copra value',kg(K.dry.copra)+' × '+p(s.copraPrice)+' Settings price',p(K.dry.value));line('Profit after bills','Σ (projected copra value − drying buying − linked bills)',p(K.dry.profit));line('Profit range','low/high copra value − buying − linked bills',p(K.dry.profitLow)+' to '+p(K.dry.profitHigh));line('Projected uling','drying raw × '+pct(s.bagolRatio)+' Settings bagol × '+pct(c.ulingYield)+' finished-burn yield',kg(K.dry.uling)+' / '+p(K.dry.ulingValue)+' at '+p(s.ulingPrice)+'/kg');line('Back-test miss','mean(abs(actual − prior-only projected copra) ÷ projected copra)',pct(K.accuracy.mape));line('Inside prior-only range','finished eligible batches with actual kg inside their prior-only range',n(K.accuracy.inRange)+' / '+n(K.accuracy.n));
      batches(dry,'Drying batches being projected');expenses(E.filter(x=>dry.some(r=>r.id===x.batch_id)),'Bills deducted from drying projections');
      group('Yield history (batch-number order)',['Batch','Raw kg','Copra kg','Yield','In recent window'],eligible,r=>[label(r),n(r.rawKg),n(r.copraKg),pct(r.yield),eligible.slice(-PROJ.recentN).includes(r)?'Yes':'No']);
      group('Excluded yield history',['Batch','Reason'],R.filter(r=>!ids.has(r.id)),r=>[label(r),r.pending?'Unassigned sale pending':'No dried copra']);
      group('Projection / back-test per batch',['Batch','Projected yield','Copra estimate kg','Low kg','High kg','Actual kg','Variance kg','Miss %','In range'],R,r=>[label(r),pct(r.proj?.yield),n(r.proj?.copra),n(r.proj?.low),n(r.proj?.high),n(r.copraKg||null),n(r.proj?.variance),pct(r.proj?.variancePct==null?null:Math.abs(r.proj.variancePct)),r.proj?.variancePct==null?'Not tested':r.proj.inRange?'Yes':'No']);burns();d.notes.push('Projections are NOT income and exclude general bills, lifetime items and uling costs. Projected profit is copra-only. With no eligible finished history, projected totals stay zero (not a promise of zero yield/profit); no back-test gives — miss. Finished batches are tested only against eligible lower-numbered batches.');break;
    case 'duration':d.title='Business running time / rates';d.value=n(K.time.days)+' days';line('Days since start','max(1, calendar-day difference from '+s.startDate+' to today + 1)',n(K.time.days));line('Weeks / months','days ÷ 7 / days ÷ 30.44',n(K.time.weeks)+' weeks / '+n(K.time.months)+' months');for(const [name,total] of [['Raw bought',K.raw],['Copra made',K.copra],['Copra cash net',K.copraNet],['Each partner (copra cash only)',K.copraNet/2]])line(name+' rate','total '+n(total)+' ÷ elapsed weeks / months',n(total/K.time.weeks)+' / '+n(total/K.time.months));batches();saleGroup();expenses(copraExp);d.notes.push('Simple averages since the local-calendar Settings start date; not a forecast. Partner rate here is COPRA CASH ONLY, unlike realized copra + uling sharing.');break;
    case 'priceChart':case 'sellChart':case 'plChart':case 'batches':d.title={priceChart:'Price tracker inputs',sellChart:'Copra selling price inputs',plChart:'Lifetime P&L chart inputs',batches:'Per-batch calculations'}[key];d.value=n(R.length)+' batches';line('Buy price','batch buyTotal ÷ batch raw kg','Per batch');line('Yield','known dried copra ÷ raw kg; drying is —','Per batch');line('Sell price','batch actual sales revenue ÷ sold kg; Settings fallback '+p(s.copraPrice)+' when no sales','Per batch');line('Batch break-even raw price','batch yield × batch sell price − linked bills ÷ raw kg (no lifetime costs)','Per batch');line('Cash net / running line','batch sales − full buying − linked bills; cumulative in batch-number order','Per batch');
      batches();group('Chart / table inputs',['Batch','Buy/kg','Asarez/kg (entered)','Yield','Sell/kg','Batch break-even/kg','Cash net ₱','Projection kg','Variance %'],R,r=>[label(r),p(r.buy),r.asarez?p(r.asarez):'—',pct(r.yield),p(r.sellPrice),p(r.be),p(r.net),n(r.proj?.copra),pct(r.proj?.variancePct)]);allocations();saleGroup();expenses(E.filter(x=>batch(x.batch_id)),'Linked bills in per-batch costs');d.notes.push('The chart/table use batch cash nets, not allocated realized profits. The P&L chart omits unassigned sales and general expenses, so its running total can differ from the Home cash net. Unsold selling-price bars use Settings, not a real sale. Asarez is a manually entered comparison.');break;
    case 'expenses':case 'budget':d.title=key==='budget'?'Expense budget / merienda':'Gastos (all logged expenses)';d.value=p(sum(E,x=>x.amount));line('Actual per kg','each category total ÷ '+kg(K.raw)+' all raw bought','Zero when no raw');line('Room before zero cash profit','(copra CASH net + uling sales − logged Uling costs) ÷ all raw kg',p(K.room)+'/kg');line('Merienda cap',p(K.meri.capPerKg)+' Settings cap/kg × '+kg(K.raw)+'; per-batch cap = total cap ÷ '+n(R.length)+' batches',p(K.meri.capTotal)+' total / '+p(K.meri.capBatch)+' per batch');line('Merienda spent','Σ Merienda / meals category; divide by all raw kg',p(K.meri.spent)+' / '+p(K.meri.perKg)+'/kg');group('Budget vs actual',['Category','Settings cap/kg','Actual total','Actual/kg','Cap total'],K.budget,r=>[r.cat,p(r.budgetPerKg),p(r.actual),p(r.actualPerKg),p(r.budgetTotal)]);group('All category totals',['Category','Total ₱','Per kg raw'],Object.entries(K.byCat),r=>[r[0],p(r[1]),p(K.raw?r[1]/K.raw:0)]);expenses(E,'Every logged expense (chart and actuals)');batches();saleGroup();usales();cash();costNote();d.notes.push('Caps are suggestions, NOT logged expenses; lifetime items are excluded. The expense chart includes ALL daily bills, including Uling, whereas copra cash net excludes general Uling bills.');break;
    case 'charcoal':case 'bagol':case 'ulingStock':case 'ulingNet':case 'ulingYield':d.title={charcoal:'Uling pool',bagol:'Bagol not yet burned',ulingStock:'Uling on hand',ulingNet:c.hasCosts?'Uling net (logged costs only)':'Uling revenue (gross)',ulingYield:'Uling yield / potential'}[key];d.value=key==='ulingNet'?p(c.ulingNet):key==='ulingYield'?pct(c.ulingYield):kg(key==='bagol'?c.bagolOnHand:c.ulingOnHand);ul();
      line('Estimated bagol',kg(K.raw)+' all raw × '+pct(s.bagolRatio)+' Settings ratio',kg(c.bagolExpected));line('In kiln','Σ bagol kg where burn status is burning',kg(c.inKiln));line('Unburned bagol','max(0, estimated bagol − finished bagol − in-kiln bagol)',kg(c.bagolOnHand));line('Uling on hand','max(0, finished uling made − pool sale kg)',kg(c.ulingOnHand));line('Weighted burn yield',kg(c.uling)+' finished uling ÷ '+kg(c.bagolDone)+' finished bagol',pct(c.ulingYield));line('Average sale price',p(c.ulingSales)+' ÷ '+kg(c.ulingSoldKg),p(c.avgPrice));line('Potential rest','max(0, estimated bagol − finished bagol) × yield (INCLUDES bagol in kiln)',kg(c.potKg)+' / '+p(c.potP)+' at '+p(s.ulingPrice)+'/kg');line('Bagol buying break-even','Settings uling price × finished-burn yield; GROSS, before burning costs',p(c.bagolBE)+'/kg bagol');batches();d.notes.push('Estimated bagol and potential uling are NOT measured stock or income. Unknown burn yield displays zero, not a guaranteed yield. Lifetime capital and non-Uling expenses are not subtracted from this pool result.');break;
  }
  return d;
}
const api={DETAIL_KEYS,explain,LIFE,LIFE_KINDS,PAID_BY,lifetime,lineageErrors,compute,r2,validate,validateBackup,isDate,CAPS,projectNew,PROJ,STATUS,poolCheck};
if(typeof module!=='undefined')module.exports=api;else root.Calc=api;
})(this);
