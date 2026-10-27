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
const api={LIFE,LIFE_KINDS,PAID_BY,lifetime,lineageErrors,compute,r2,validate,validateBackup,isDate,CAPS,projectNew,PROJ,STATUS,poolCheck};
if(typeof module!=='undefined')module.exports=api;else root.Calc=api;
})(this);
