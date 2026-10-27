// JB Integrated Farm app (formerly Kopra Ko; IndexedDB name and storage keys kept as kopra for data carry-over): UI + live KPIs from the local store.
const store=DB.Store(window.indexedDB?DB.idbAdapter():DB.memoryAdapter());
let D=null,K=null,charts={},form='buy',editing=null,lifeEd=null;
const $=s=>document.querySelector(s),P=n=>(n<0?'−':'')+'₱'+Math.abs(n).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}),
 P0=n=>(n<0?'−':'')+'₱'+Math.round(Math.abs(n)).toLocaleString('en-PH'),N=(n,d=0)=>(+n).toLocaleString('en-PH',{maximumFractionDigits:d,minimumFractionDigits:d}),pc=n=>(n*100).toFixed(2)+'%';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const today=()=>window.__TODAY__?new Date(window.__TODAY__):new Date();
const iso=()=>{const d=today();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
function toast(m){const t=$('#toast');t.textContent=m;t.style.display='block';clearTimeout(t._h);t._h=setTimeout(()=>t.style.display='none',2200)}
const live=t=>D[t].filter(x=>!x.deleted);
const FLAGS=new URLSearchParams(location.search).get('sync')==='1'||(localStorage.getItem('kopra_flags')||'').includes('sync');
// Batch/burn label: always escaped; device tag shown only when sync is on (only then can numbers clash).
const bl=r=>esc('#'+(Number.isInteger(r.no)?r.no:'?')+(FLAGS&&r.dev?'-'+r.dev:''));let DEV='';
const S=()=>live('settings')[0];
async function load(){D=await store.snapshot();K=Calc.compute(D,today());window.__K=K;render()}

function bidHTML(b,small){
 const exNote=b.excluded?`<div class="note" id="bidexcluded">⏸ ${K.pending.map(p=>bl(p)+' '+esc(p.source)).join(', ')} not used in yield / bid / projections until its unassigned copra sale is assigned (Records → edit the sale).</div>`:'';
 if(!b.hasData)return exNote+`<div class="note" id="bidempty">No finished batches yet. Add a buy batch with its dried copra kg to see bid prices.</div>`;
 return `<div class="g3"><div class="box good"><div class="t">✅ GOOD BID</div><div class="p">${P(b.good)}</div><div class="d">Pay this or lower. Good bid = break-even minus ${P(b.margin)} margin (change in Settings).</div></div>
 <div class="box be"><div class="t">⚖️ BREAK-EVEN${b.gasOnly?' (gas costs only)':''}</div><div class="p">${P(b.be)}</div><div class="d">Zero profit for both partners, copra only. Rounded down.${b.gasOnly?' <b>Real break-even is lower once other costs are logged.</b>':''}</div></div>
 <div class="box loss"><div class="t">❌ LOSS</div><div class="p">above ${P(b.be)}</div><div class="d">Any bid higher = lugi.</div></div></div>
 ${small?'':`<p class="sub" style="margin-top:8px"><b>How:</b> Yield <b>${pc(b.yield)}</b> × Copra price <b>${P(b.sell)}</b>/kg (from Settings) − Expenses <b>${P(b.expPerKg)}</b>/kg raw${b.gasOnly?' (gas only — labor, sacks, meals not logged yet)':''} = <b>${P(b.be)}</b>.</p>`}
 ${b.lifeOn?`<div class="note" id="bidlife">🏗️ <b>Lifetime costs included:</b> bid lowered by ${P(b.lifePerKg)}/kg raw (capital + lifetime expenses ÷ raw kg so far). Turn off in Settings.</div>`:''}${exNote}<div class="note">🔥 Uling income is a <b>bonus cushion</b>, not counted. Unsold stock does not change the bid (it uses yield).</div>`}

function render(){
 const s=S(),t=K.time,c=K.char;
 $('#hdr').textContent=`Since ${s.startDate} · day ${t.days} · ${K.rows.length} batches · copra ${P(s.copraPrice)}`;
 const kp=[["Copra net income",P(K.copraNet),"sales − buying − expenses"],[K.char.hasCosts?"Combined net (copra + uling)":"Copra net + uling gross",P(K.combined),K.char.hasCosts?"realized":"uling costs not logged"],["Each partner (50/50)",P(K.share),`${s.partners[0]} / ${s.partners[1]}`],["Capital spent",P0(K.buyTotal),"+ "+P0(K.totalExp)+" expenses"],
  ["Avg buy price / kg",P(K.avgBuy),"weighted"],["Net per kg raw",P(K.netPerKg),"margin "+(K.margin*100).toFixed(1)+"%"],["Raw bought",N(K.raw)+" kg","→ "+N(K.copra,1)+" kg copra"],["Avg yield",pc(K.bid.yield),"sold avg "+P(K.avgSell)+"/kg"]];
 $('#v-home').innerHTML=`${invHTML('inv')}<div class="kpis" id="kpis">${kp.map(k=>`<div class="kpi"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="s">${esc(k[2])}</div></div>`).join('')}</div>
 <div class="card" id="bidguide" style="border:2px solid var(--g)"><h2>Bid Guide (lifetime benchmark) 🏷️</h2><p class="sub">Price per kg of <b>raw coconut</b> for the next batch. Updates when you save.</p>${bidHTML(K.bid)}</div>
 ${lifeSummary()}
 <div class="card" id="plsplit"><h2>Profit: sold vs. not yet sold</h2><p class="sub">Copra only. Uling not included.</p><div class="g3">
  <div class="box good"><div class="t">✅ REALIZED (sold)</div><div class="p">${P(K.realized)}</div><div class="d">${N(K.soldKg,1)} kg sold</div></div>
  <div class="box be"><div class="t">📦 UNREALIZED (stock at ${P(s.copraPrice)})</div><div class="p">${P(K.unrealized)}</div><div class="d">${N(K.onHand,1)} kg on hand</div></div>
  <div class="box tot"><div class="t">Σ TOTAL</div><div class="p">${P(K.total)}</div><div class="d">${P(K.total/2)} each partner</div></div></div></div>
 ${K.unassigned.kg>0?`<div class="card" id="unassigned" style="border:2px solid var(--r)"><h2>⚠️ Copra sale not linked to a batch</h2><p class="sub">${N(K.unassigned.kg,1)} kg sold for ${P(K.unassigned.value)} is not assigned to any batch (e.g. a sheet row that combined two loads). Open Records → Edit that sale and pick the right batch.</p></div>`:''}
 <div class="card" id="drying"><h2>Still drying 🌞</h2><p class="sub">Projected from your yields: 70% last ${Calc.PROJ.recentN} batches + 30% lifetime. Range = worst–best batch yield.</p>
 ${K.dry.n?`<div class="kpis"><div class="kpi"><div class="l">Raw drying</div><div class="v">${N(K.dry.raw)} kg</div><div class="s">${K.dry.n} batch${K.dry.n>1?'es':''}</div></div>
  <div class="kpi"><div class="l">Projected copra</div><div class="v">${N(K.dry.copra)} kg</div><div class="s">range ${N(K.dry.low)}–${N(K.dry.high)} kg</div></div>
  <div class="kpi"><div class="l">Projected copra value</div><div class="v">${P0(K.dry.value)}</div><div class="s">at ${P(s.copraPrice)}/kg (Settings)</div></div>
  <div class="kpi"><div class="l">Projected profit after bills</div><div class="v ${K.dry.profit<0?'neg':''}">${P0(K.dry.profit)}</div><div class="s">${P0(K.dry.profitLow)} to ${P0(K.dry.profitHigh)}</div></div></div>
  <div class="kv"><span>Projected uling (from ${(s.bagolRatio*100).toFixed(0)}% bagol × ${pc(K.char.ulingYield)})</span><b>${N(K.dry.uling)} kg ≈ ${P0(K.dry.ulingValue)}</b></div>
  ${K.rows.filter(r=>r.status==='drying').map(r=>`<div class="kv"><span>${bl(r)} ${esc(r.source)} · ${N(r.rawKg)} kg raw · bills ${P0(r.exp)}</span><b>${r.proj?N(r.proj.copra)+' kg → '+P0(r.proj.profit):'no history yet'}</b></div>`).join('')}`
  :'<div class="note">No batches drying. When you save a buy with copra blank, its projection shows here.</div>'}
 <p class="sub" style="margin-top:8px" id="accuracy">📏 Projection accuracy (back-tested on ${K.accuracy.n} finished batches): average miss <b>${K.accuracy.mape==null?'—':(K.accuracy.mape*100).toFixed(1)+'%'}</b>, ${K.accuracy.inRange}/${K.accuracy.n} inside the range.</p></div>
 <div class="two"><div class="card" id="stock"><h2>Unsold copra on hand 📦</h2><p class="sub">Not counted as sold. Valued at Settings price ${P(s.copraPrice)}/kg as <b>unrealized</b> only.</p>
  <div class="kv"><span>Copra on hand</span><b>${N(K.onHand,1)} kg</b></div><div class="kv"><span>Cost basis (its share of buying + expenses)</span><b>${P(K.stockCost)}</b></div>
  <div class="kv"><span>Value at ${P(s.copraPrice)}</span><b>${P(K.stockValue)}</b></div><div class="kv"><span>Potential profit</span><b class="${K.unrealized>=0?'pos':'neg'}">${P(K.unrealized)}</b></div>
  ${K.onHand?K.rows.filter(r=>r.onHand>0).map(r=>`<div class="item"><span>${bl(r)} ${esc(r.source)} · <span class="tag">${esc(r.statusLabel)}</span><br>${N(r.onHand,1)} kg on hand${r.soldKg?' · sold '+N(r.soldKg,1)+' kg @ avg '+P(r.avgSalePrice):''}</span><button class="sell" data-sell="${esc(r.id)}">Mark as sold</button></div>`).join(''):'<div class="note">No unsold copra. Save a batch with its dried copra kg (status "Not yet sold"), then use "Mark as sold".</div>'}</div>
 <div class="card" id="duration"><h2>Business running time ⏱️</h2><p class="sub">Started <b>${esc(s.startDate)}</b> → today</p>
  <div class="kv"><span>Days / weeks / months</span><b>${t.days} d · ${t.weeks.toFixed(1)} wk · ${t.months.toFixed(1)} mo</b></div>
  <table><tr><th>Rate</th><th>Per week</th><th>Per month</th></tr><tr><td>Raw bought</td><td>${N(t.rawWk)} kg</td><td>${N(t.rawMo)} kg</td></tr>
  <tr><td>Copra made</td><td>${N(t.copraWk)} kg</td><td>${N(t.copraMo)} kg</td></tr><tr><td>Copra net</td><td>${P0(t.netWk)}</td><td>${P0(t.netMo)}</td></tr>
  <tr><td>Each partner</td><td>${P0(t.netWk/2)}</td><td>${P0(t.netMo/2)}</td></tr></table><p class="sub" style="margin-top:6px">Month = 30.44 days. Simple averages since start.</p></div></div>
 <div class="card"><h2>Price tracker</h2><p class="sub">₱/kg raw: your buy price vs Asarez vs break-even per batch</p><div class="ch"><canvas id="cPrice"></canvas></div></div>
 <div class="card"><h2>Copra selling price</h2><div class="ch" style="height:180px"><canvas id="cSell"></canvas></div></div>
 <div class="card"><h2>Lifetime P&amp;L</h2><p class="sub">Net per batch (bars) + running total (line)</p><div class="ch"><canvas id="cPL"></canvas></div></div>
 <div class="two"><div class="card"><h2>Gastos (expenses)</h2><div class="ch" style="height:170px"><canvas id="cExp"></canvas></div>${Object.entries(K.byCat).map(([k,v])=>`<div class="kv"><span>${esc(k)}</span><b>${P(v)} · ${P(v/K.raw)}/kg</b></div>`).join('')}</div>
 <div class="card" id="budget"><h2>Expense budget per kg raw</h2><p class="sub">Suggested starting caps (not real costs) vs actual. Room before zero profit: <b>${P(K.room)}/kg</b></p>
  <table><tr><th>Category</th><th>Cap/kg</th><th>Actual/kg</th></tr>${K.budget.map(b=>`<tr><td>${esc(b.cat)}</td><td>${P(b.budgetPerKg)}</td><td class="${b.actualPerKg>b.budgetPerKg?'neg':''}">${P(b.actualPerKg)}</td></tr>`).join('')}</table>
  <div class="note" id="merienda">🍞 <b>Merienda cap:</b> ${P(K.meri.capPerKg)}/kg raw ≈ ${P0(K.meri.capBatch)} per batch · ${P0(K.meri.capTotal)} total so far. Spent: <b>${P(K.meri.spent)}</b> (${P(K.meri.perKg)}/kg) ${K.meri.perKg>K.meri.capPerKg?'⚠️ over cap':'✓ within cap'}</div></div></div>
 <div class="card" id="charcoal"><h2>Uling pool 🔥</h2><p class="sub">One combined pool: bagol from all batches → burns → uling stock → sales. Bonus income, not in bid guide.</p>
  <div class="kpis" id="ulingpool"><div class="kpi"><div class="l">Bagol not yet burned</div><div class="v">${N(c.bagolOnHand)} kg</div><div class="s">est. ${(s.bagolRatio*100).toFixed(0)}% of ${N(K.raw)} kg raw · ${N(c.inKiln)} kg in kiln</div></div>
  <div class="kpi"><div class="l">Uling on hand</div><div class="v">${N(c.ulingOnHand,1)} kg</div><div class="s">made ${N(c.uling)} · sold ${N(c.ulingSoldKg)} kg</div></div>
  <div class="kpi"><div class="l">${c.hasCosts?"Uling net":"Uling revenue (gross)"}</div><div class="v">${P(c.ulingNet)}</div><div class="s">${c.hasCosts?"sales "+P0(c.ulingSales)+" − costs "+P0(c.ulingExp):"avg "+P(c.avgPrice)+"/kg · no burning costs logged"}</div></div>
  <div class="kpi"><div class="l">Yield</div><div class="v">${pc(c.ulingYield)}</div><div class="s">uling ÷ bagol · rest ≈ ${N(c.potKg)} kg ≈ ${P0(c.potP)}</div></div></div>
  <div class="tw"><table><tr><th>Burn</th><th>Bagol</th><th>Uling</th><th>Yield</th><th>Status</th></tr>${c.burns.filter(x=>!x.deleted).sort((a,b)=>a.no-b.no).map(b=>`<tr><td>${bl(b)}</td><td>${N(b.bagolKg)}</td><td>${b.ulingKg?N(b.ulingKg):'—'}</td><td>${b.ulingKg?pc(b.ulingKg/b.bagolKg):'—'}</td><td>${esc(b.status==='burning'?'in kiln':'done')}</td></tr>`).join('')}</table></div>
  <p class="sub" style="margin-top:6px">${c.usales.length} uling sales from the pool · ${N(c.ulingSoldKg)} kg · ${P(c.ulingSales)}. Break-even if buying bagol: ${P(c.bagolBE)}/kg bagol (at ${P(s.ulingPrice)} uling).</p></div>
 <div class="card" id="share"><h2>50/50 sharing</h2><div class="kv"><span>Copra realized</span><b>${P(K.realized/2)} each</b></div><div class="kv"><span>${c.hasCosts?"Uling net":"Uling gross (no costs logged)"}</span><b>${P(c.ulingNet/2)} each</b></div><div class="kv"><span><b>${esc(s.partners[0])}</b></span><b>${P(K.share)}</b></div><div class="kv"><span><b>${esc(s.partners[1])}</b></span><b>${P(K.share)}</b></div></div>
 <div class="card"><h2>Per-batch table</h2><p class="sub">Swipe → on phone</p><div class="tw"><table id="tbl"><tr><th>#</th><th>Source</th><th>Raw kg</th><th>Buy/kg</th><th>Asarez</th><th>Status</th><th>Proj. copra</th><th>Copra kg</th><th>Var.</th><th>Yield</th><th>Sold kg</th><th>On hand</th><th>Sell ₱</th><th>Exp</th><th>Net</th><th>B-E</th></tr>
  ${K.rows.map(r=>`<tr><td>${bl(r)}</td><td>${esc(r.source)}</td><td>${N(r.rawKg,1)}</td><td>${P(r.buy)}</td><td>${r.asarez?P(r.asarez):'—'}</td><td>${esc(r.statusLabel)}</td><td>${r.proj?N(r.proj.copra):'—'}</td><td>${r.copraKg?N(r.copraKg,1):'—'}</td><td class="${r.proj&&r.proj.variancePct!=null?(r.proj.inRange?'':'neg'):''}">${r.proj&&r.proj.variancePct!=null?(r.proj.variancePct>=0?'+':'')+(r.proj.variancePct*100).toFixed(1)+'%':'—'}</td><td>${r.yield?pc(r.yield):'—'}</td><td>${N(r.soldKg,1)}</td><td>${N(r.onHand,1)}</td><td>${P(r.sellPrice)}</td><td>${P(r.exp)}</td><td class="${r.net>=0?'pos':'neg'}">${P(r.net)}</td><td>${r.be?P(r.be):'—'}</td></tr>`).join('')}</table></div></div>`;
 drawCharts();renderForm();renderRecords();renderLife();renderMore();
}
function drawCharts(){if(!window.Chart)return;Object.values(charts).forEach(c=>c.destroy());charts={};
 const R=K.rows,L=R.map(bl),o={maintainAspectRatio:false,animation:false,plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:10}}}}};
 charts.p=new Chart($('#cPrice'),{type:'line',data:{labels:L,datasets:[{label:'Your buy',data:R.map(r=>r.buy),borderColor:'#7a5230'},{label:'Asarez',data:R.map(r=>r.asarez||null),borderColor:'#6f6a5e',borderDash:[4,4]},{label:'Break-even',data:R.map(r=>r.be),borderColor:'#b5462f'}]},options:o});
 charts.s=new Chart($('#cSell'),{type:'bar',data:{labels:L,datasets:[{label:'₱/kg copra',data:R.map(r=>r.sellPrice),backgroundColor:'#e0a526'}]},options:{...o,scales:{y:{min:35}}}});
 let c=0;charts.pl=new Chart($('#cPL'),{data:{labels:L,datasets:[{type:'line',label:'Running total',data:R.map(r=>c+=r.net),borderColor:'#1f4d3a',yAxisID:'y1'},{type:'bar',label:'Net per batch',data:R.map(r=>r.net),backgroundColor:R.map(r=>r.net<0?'#b5462f':'#e0a526')}]},options:{...o,scales:{y1:{position:'right',grid:{display:false}}}}});
 const cats=Object.keys(K.byCat);charts.e=new Chart($('#cExp'),{type:'doughnut',data:{labels:cats,datasets:[{data:cats.map(k=>K.byCat[k]),backgroundColor:['#1f4d3a','#e0a526','#7a5230','#b5462f','#2e7d4f','#a47148','#6f6a5e','#d9c9a5','#4f9a6b','#333']}]},options:o});
}
// ---------- v1.4 lifetime (capital + one-off lifetime expenses; separate from daily Gastos) ----------
const PAID=()=>({p1:S().partners[0],p2:S().partners[1],shared:'Shared 50/50'});
const pr=n=>n==null?'—':P(n);
function lifeSummary(){const L=K.life;return `<div class="card" id="lifesum"><h2>Lifetime (all-in) 🏗️</h2><p class="sub">Includes capital + lifetime expenses (${P0(L.total)}). Details in the 🏗️ Lifetime tab.</p>
 <div class="kv"><span>Average cost / kg copra (all-in)</span><b>${pr(L.avgAll)}</b></div><div class="kv"><span>Break-even selling price (all-in)</span><b>${pr(L.beAll)}</b></div>
 <div class="kv"><span>Best price to sell copra (operating only)</span><b>${pr(L.bestOp)}</b></div><div class="kv"><span>Best price to sell copra (all-in)</span><b>${pr(L.best)}</b></div></div>`}
function renderLife(){const L=K.life,s=S(),e=lifeEd||{},pb=PAID(),items=live('lifetime_items').sort((a,b)=>(b.date||'').localeCompare(a.date||''));
 const vd=(b,d,lbl)=>b==null||d==null?'':d>=0?`✅ Today's price ${P(L.price)} is <b>above</b> the ${lbl} by <b>${P(d)}/kg</b>.`:`⚠️ Today's price ${P(L.price)} is <b>below</b> the ${lbl} by <b>${P(-d)}/kg</b>.`;
 const verdict=L.best==null?'Add a batch with its dried copra kg first, then your best price shows here.':
  `<div id="lverdictop">${vd(L.bestOp,L.diffOp,'operating-only best price')}</div><div id="lverdictall">${vd(L.best,L.diff,'all-in best price')}</div>`;
 $('#v-life').innerHTML=`<div class="card" id="lifekpi" style="border:2px solid var(--g)"><h2>Lifetime numbers 🏗️</h2><p class="sub">From day one up to today. Revenue counts only copra <b>already sold</b> + uling sold. Unsold copra is not counted as income.</p>
 <div class="kpis"><div class="kpi"><div class="l">Operating cost to date</div><div class="v">${P0(L.opCost)}</div><div class="s">buying + all gastos</div></div>
  <div class="kpi"><div class="l">All-in cost to date</div><div class="v">${P0(L.allIn)}</div><div class="s">operating + lifetime ${P0(L.total)}</div></div>
  <div class="kpi"><div class="l">Average cost / kg copra</div><div class="v" id="lavg">${pr(L.avgAll)}</div><div class="s">all-in · operating only ${pr(L.avgOp)}</div></div>
  <div class="kpi"><div class="l">Break-even selling price</div><div class="v" id="lbe">${pr(L.beAll)}</div><div class="s">all-in · operating only ${pr(L.beOp)}</div></div></div>
 <p class="sub">Average cost = total cost ÷ ${N(L.copra,1)} kg copra made (uling income <b>not</b> subtracted). Break-even = (total cost − uling sold ${P0(L.ulingSales)}) ÷ kg copra made: the price you need on every kg to get all your money back.</p>
 <div class="box tot" id="lbestbox"><div class="t">💰 BEST PRICE TO SELL COPRA</div><div style="display:flex;gap:8px;margin-top:6px">
  <div style="flex:1;min-width:0" id="lbestop"><div class="d"><b>Operating-only best price</b></div><div class="p">${pr(L.bestOp)}</div><div class="d">For day-to-day selling: operating break-even ${pr(L.beOp)} + ${P(L.margin)}</div></div>
  <div style="flex:1;min-width:0" id="lbest"><div class="d"><b>All-in best price (with lifetime costs)</b></div><div class="p">${pr(L.best)}</div><div class="d">All-in break-even ${pr(L.beAll)} + ${P(L.margin)}</div></div></div>
  <div class="d">Target margin ${P(L.margin)}/kg (change in Settings)</div></div>
 <div class="note" id="lverdict">${verdict}</div>
 <div class="kv"><span>Capital recovered</span><b id="lrec">${L.recPct==null?'— (no lifetime items yet)':(L.recPct*100).toFixed(1)+'%'}</b></div>
 <div class="kv"><span>Still to recover</span><b id="ltodo">${P(L.toRecover)}</b></div>
 <div class="kv"><span>Payback estimate</span><b id="lpay">${L.toRecover<=0?'All recovered ✓':L.payback==null?'Not yet — recent batches show no profit':`about ${N(L.payback)} more batch${L.payback>1?'es':''}`}</b></div>
 <p class="sub">${L.perBatch==null?'':`Based on average profit ${P0(L.perBatch)} per batch (last ${L.recentN} complete batches, copra only).`}</p></div>
 <div class="card" id="lifeform"><h2>${e.id?'Edit':'Add'} lifetime item</h2><p class="sub">For things you pay once and use for a long time. Daily costs (gas, labor, meals) still go in ➕ Add → 🧾 Gastos.</p>
  ${fld('l_date','Date',e.date||iso(),'date')}${fld('l_name','Name (e.g. Drying tarps, BIR registration)',e.name||'','text','maxlength="120"')}
  <label for="l_kind">Type</label><select id="l_kind"><option value="capital" ${e.kind!=='expense'?'selected':''}>Capital (equipment, racks, tarps, kiln, truck/tools, materials)</option><option value="expense" ${e.kind==='expense'?'selected':''}>Lifetime expense (BIR, business permit, licenses, setup)</option></select>
  ${fld('l_amt','Amount ₱',e.amount||'')}<label for="l_paid">Paid by (optional)</label><select id="l_paid"><option value="">—</option>${Object.entries(pb).map(([k,v])=>`<option value="${k}" ${e.paidBy===k?'selected':''}>${esc(v)}</option>`).join('')}</select>
  ${fld('l_note','Note (optional)',e.note||'','text','maxlength="200"')}<div class="note" id="l_err" style="display:none;background:#f8dcd5;border-color:#b5462f"></div>
  <button class="btn" id="l_save">💾 I-save</button>${e.id?'<button class="btn sec" id="l_cancel">Cancel edit</button>':''}</div>
 <div class="card" id="lifelist"><h2>Lifetime items</h2>
  <div class="kv"><span>Capital</span><b id="lcap">${P(L.capital)}</b></div><div class="kv"><span>Lifetime expenses</span><b id="lone">${P(L.oneOff)}</b></div><div class="kv"><span><b>Total</b></span><b id="ltot">${P(L.total)}</b></div>
  ${items.length?items.map(x=>`<div class="item"><span>${x.kind==='capital'?'🧰':'📄'} <b>${esc(x.name)}</b> · ${P(x.amount)}<br><span class="sub">${x.kind==='capital'?'Capital':'Lifetime expense'} · ${esc(x.date||'')}${x.paidBy?' · paid by '+esc(pb[x.paidBy]||''):''}${x.note?' · '+esc(x.note):''}</span></span><span style="white-space:nowrap"><button data-led="${esc(x.id)}">Edit</button> <button class="del" data-ldel="${esc(x.id)}">🗑</button></span></div>`).join('')
   :'<div class="note" id="lifeempty">No lifetime items yet. Add your equipment, materials, BIR and permits above. Until then all-in numbers equal operating numbers.</div>'}</div>`;
 $('#l_save').onclick=saveLife;if($('#l_cancel'))$('#l_cancel').onclick=()=>{lifeEd=null;renderLife()}}
async function saveLife(){const e=lifeEd||{},n=$('#l_amt').value.trim();
 const rec={date:$('#l_date').value||null,name:$('#l_name').value.trim(),kind:$('#l_kind').value,amount:n===''?null:+n,note:$('#l_note').value.trim(),paidBy:$('#l_paid').value||null};
 const m=Calc.validate('life',rec);if(m){toast('⚠️ '+m);$('#l_err').textContent='⚠️ '+m;$('#l_err').style.display='block';return}
 await store.save('lifetime_items',{...e,...rec});lifeEd=null;await load();toast('Lifetime item saved ✓');sched()}
// ---------- forms ----------
const fld=(id,l,v='',type='number',ext='')=>`<label for="${id}">${l}</label><input id="${id}" type="${type}" inputmode="${type==='number'?'decimal':'text'}" value="${esc(v)}" ${ext}>`;
const batchOpts=(sel,onlyStock)=>K.rows.slice().reverse().filter(r=>!onlyStock||r.copraKg>0||r.id===sel).map(r=>`<option value="${esc(r.id)}" ${r.id===sel?'selected':''}>${bl(r)} ${esc(r.source)} (${N(r.copraKg||0,1)} kg copra, ${N(r.onHand,1)} on hand)</option>`).join('');
// v1.5 big tap buttons for "paid by" / "received by" (p1, p2, shared, or not set). No typing.
const pick=(id,v)=>`<div class="seg pick" id="${id}">${[['','Not set'],...Object.entries(PAID())].map(([k,l])=>`<button type="button" data-p="${k}" class="${(v||'')===k?'on':''}">${esc(l)}</button>`).join('')}</div>`;
const pv=id=>{const b=$('#'+id+' .on');return b&&b.dataset.p?b.dataset.p:null};
// v1.5 inventory line: raw bought not yet dried, dried copra on hand (not sold), sold.
function invHTML(id){const I=K.inv;return `<div class="card inv" id="${id}"><h2>Stock now 📦</h2><div class="g3i">
 <div class="box ib1"><div class="t">🥥 Raw, not yet dried</div><div class="p">${N(I.rawUndried)} kg</div><div class="d">${I.lotsUndried} lot${I.lotsUndried===1?'':'s'}</div></div>
 <div class="box ib2"><div class="t">📦 Copra on hand</div><div class="p">${N(I.onHand,1)} kg</div><div class="d">dried, not sold · not income</div></div>
 <div class="box ib3"><div class="t">💰 Sold</div><div class="p">${N(I.soldKg,1)} kg</div><div class="d">counted as income</div></div></div></div>`}
const PB=k=>k?esc(PAID()[k]||''):'';
function renderTrackers(){const el=$('#trklog');if(!el)return;$('#addinv').outerHTML=invHTML('addinv');let h='';
 if(form==='buy'){const L=K.rows.slice().reverse();h=`<div class="card" id="buylog"><h2>Buying log</h2>${L.length?L.map(r=>`<div class="item"><span>🛒 ${bl(r)} ${esc(r.source)} · ${N(r.rawKg)} kg @ ${P(r.buy)}<br><span class="sub">${esc(r.date||'no date')}${r.paidBy?' · paid by '+PB(r.paidBy):''} · <span class="tag">${esc(r.statusLabel)}</span></span></span><span style="white-space:nowrap">${r.status==='drying'?`<button class="sell" data-dry="${esc(r.id)}">🌞 Dry</button> `:''}<button data-ted="batches|${esc(r.id)}">Edit</button></span></div>`).join(''):'<div class="note">No buys yet.</div>'}</div>`}
 if(form==='dry'){const W=K.rows.filter(r=>r.status==='drying').reverse(),Dd=K.rows.filter(r=>r.copraKg>0).reverse();
  h=`<div class="card" id="drylog"><h2>Yield log</h2>${W.length?`<p class="sub"><b>Waiting to dry:</b> ${W.map(r=>bl(r)+' '+esc(r.source)+' ('+N(r.rawKg)+' kg)').join(', ')}</p>`:''}
  ${Dd.length?Dd.map(r=>`<div class="item"><span>🌞 ${bl(r)} ${esc(r.source)} · ${N(r.rawKg)} → <b>${N(r.copraKg,1)} kg</b> · yield <b>${pc(r.yield)}</b><br><span class="sub">${esc(r.dryDate||r.date||'no date')} · <span class="tag">${esc(r.statusLabel)}</span></span></span><button data-yed="${esc(r.id)}">Edit</button></div>`).join(''):'<div class="note">No dried lots yet.</div>'}</div>`}
 if(form==='sale'){const L=live('sales').slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));h=`<div class="card" id="soldlog"><h2>Sold log</h2>${L.length?L.map(x=>{const b=D.batches.find(y=>y.id===x.batch_id&&!y.deleted);return `<div class="item"><span>💰 ${b?bl(b):'<b class="neg">not assigned</b>'} · ${N(x.kg,1)} kg × ${P(x.price)} = <b>${P(x.kg*x.price)}</b><br><span class="sub">${esc(x.date||'no date')}${x.buyer?' · '+esc(x.buyer):''}${x.receivedBy?' · money to '+PB(x.receivedBy):''}</span></span><button data-ted="sales|${esc(x.id)}">Edit</button></div>`}).join(''):'<div class="note">No sales yet.</div>'}</div>`}
 el.innerHTML=h}
function renderForm(){const e=editing||{},s=S();let h='';
 if(form==='buy'){const gas=e.id?live('expenses').find(x=>x.batch_id===e.id&&x.category==='Gas'):null;
  h=`<h2>${e.id?'Edit lot '+bl(e):'🛒 Buying tracker'} (Bili)</h2><p class="sub">Log the buy only. Dry it later in 🌞 Yield, sell it later in 💰 Benta.</p>${fld('f_date','Date bought',e.date||iso(),'date')}${fld('f_src','Supplier (optional)',e.source||'','text','maxlength="120"')}
  <div class="row"><div>${fld('f_raw','Raw kg',e.rawKg||'')}</div><div>${fld('f_buy','Price ₱/kg',e.rawKg?(e.buyTotal/e.rawKg).toFixed(4):'')}</div></div>
  <label>Paid by</label>${pick('f_paid',e.paidBy)}
  <details id="f_more" ${e.id?'open':''}><summary>More (optional): Asarez, gas, copra already dried</summary>
  <div class="row"><div>${fld('f_as','Asarez price ₱/kg',e.asarez||'')}</div><div>${fld('f_gas','Gas ₱',gas?gas.amount:'')}</div></div>
  ${fld('f_copra','Dried copra kg (blank = still drying; you can add it later in 🌞 Yield)',e.copraKg||'')}</details>
  <div class="note" id="f_rawfix" style="display:none;background:#fff3d6"><b>Check raw kg.</b> Copra is now below what was already sold for this batch, so the old row probably combined two loads. Enter the corrected raw kg for <b>this</b> batch above.<label style="display:flex;gap:8px;align-items:center;color:var(--t)"><input type="checkbox" id="f_rawok" style="width:auto"> Raw kg is already correct</label></div><div class="auto" id="f_auto"></div>`}
 if(form==='dry'){const lots=K.rows.filter(r=>r.status==='drying'||r.id===e.id).slice().reverse(),sel=e.id||preBatch;
  h=`<h2>${e.id?'Edit yield '+bl(e):'🌞 Yield tracker'} (Pagpatuyo)</h2><p class="sub">Pick a bought lot and enter the dried copra kg. Copra on hand is <b>not income</b> until sold.</p>
  ${lots.length?`<label for="f_lot">Lot (raw bought, not yet dried)</label><select id="f_lot">${lots.map(r=>`<option value="${esc(r.id)}" ${r.id===sel?'selected':''}>${bl(r)} ${esc(r.source)} · ${N(r.rawKg)} kg raw${r.date?' · '+esc(r.date):''}</option>`).join('')}</select>
  ${fld('f_dcopra','Dried copra kg',e.copraKg||'')}${fld('f_date','Date dried',e.dryDate||iso(),'date')}<div class="auto" id="f_auto"></div>`:'<div class="note" id="drynone">No lots waiting to dry. Log a buy first in 🛒 Bili.</div>'}`}
 if(form==='sale'){h=`<h2>${e.id?'Edit sale':'💰 Sold tracker'} (Benta)</h2><p class="sub">Only copra logged here counts as income.</p><label>Batch</label><select id="f_batch">${e.id&&!K.rows.some(r=>r.id===e.batch_id)?'<option value="">— not assigned to a batch —</option>':''}${batchOpts(e.batch_id||preBatch,true)}</select>
  <label>Copra sold?</label><div class="seg" id="f_st"><button data-s="all" class="on">All sold</button><button data-s="part">Part sold</button><button data-s="none">Not yet</button></div>
  <div class="row"><div>${fld('f_kg','Kg sold',e.kg||'')}</div><div>${fld('f_price','Price ₱/kg',e.price||s.copraPrice)}</div></div>${fld('f_date','Date',e.date||iso(),'date')}${fld('f_buyer','Buyer (optional)',e.buyer||'','text','maxlength="120"')}<label>Money received by</label>${pick('f_recv',e.receivedBy)}<div class="auto" id="f_auto"></div>`}
 if(form==='char'){h=`<h2>${e.id?'Edit':'New'} uling burn (pool)</h2><p class="sub">Bagol comes from the shared pool (${N(K.char.bagolOnHand)} kg not yet burned). Sell uling with 💵 Uling benta.</p>${fld('f_date','Date',e.date||iso(),'date')}<div class="row"><div>${fld('f_bagol','Bagol kg',e.bagolKg||'')}</div><div>${fld('f_uling','Uling kg (0 if still burning)',e.ulingKg??'')}</div></div>
  <label>Status</label><select id="f_status">${[['burning','In kiln (burning)'],['done','Done (uling into pool)']].map(([x,l])=>`<option value="${x}" ${x===(e.status==='sold'?'done':(e.status||'burning'))?'selected':''}>${esc(l)}</option>`).join('')}</select><div class="auto" id="f_auto"></div>`}
 if(form==='usale'){h=`<h2>${e.id?'Edit':'Sell'} uling from pool (Benta)</h2><p class="sub">Pool has <b>${N(K.char.ulingOnHand+(e.id?+e.kg:0),1)} kg</b> uling on hand.</p>
  <div class="row"><div>${fld('f_kg','Uling kg sold',e.kg||'')}</div><div>${fld('f_price','Price ₱/kg',e.price||s.ulingPrice)}</div></div>${fld('f_date','Date',e.date||iso(),'date')}${fld('f_buyer','Buyer',e.buyer||'','text')}<div class="auto" id="f_auto"></div>`}
 if(form==='exp'){const cats=['Gas','Labor','Diesel','Firewood / drying fuel','Sacks','Merienda / meals','Vehicle maintenance','Weighing & transport','Permits','Phone load','Uling','Other'];
  h=`<h2>${e.id?'Edit':'New'} expense (Gastos)</h2>${fld('f_date','Date',e.date||iso(),'date')}<label>Category</label><select id="f_cat">${cats.map(c=>`<option ${c===e.category?'selected':''}>${esc(c)}</option>`).join('')}</select>
  ${fld('f_amt','Amount ₱',e.amount||'')}<label>Batch (optional)</label><select id="f_batch"><option value="">— general / not for one batch —</option>${batchOpts(e.batch_id)}</select>${fld('f_note','Note',e.note||'','text')}`}
 h+=`<div class="note" id="f_err" style="display:none;background:#f8dcd5;border-color:#b5462f"></div><button class="btn" id="f_save">💾 I-save</button>${e.id?'<button class="btn sec" id="f_cancel">Cancel edit</button>':''}`;
 $('#formcard').innerHTML=h;renderTrackers();document.querySelectorAll('#formseg button').forEach(b=>b.classList.toggle('on',b.dataset.f===form));
 $('#f_save').onclick=saveForm;if($('#f_cancel'))$('#f_cancel').onclick=()=>{editing=null;renderForm()};
 if($('#f_st'))$('#f_st').onclick=ev=>{const b=ev.target.closest('button');if(!b)return;$('#f_st').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));const r=K.rows.find(r=>r.id===$('#f_batch').value);
  if(b.dataset.s==='all'&&r)$('#f_kg').value=r.onHand+(editing?+editing.kg:0);if(b.dataset.s==='none')$('#f_kg').value=0;autoCalc()};
 if(form==='sale'&&!e.id){const r=K.rows.find(r=>r.id===$('#f_batch').value);if(r)$('#f_kg').value=r.onHand}
 $('#formcard').oninput=ev=>{if(form==='char'&&ev.target.id==='f_uling'&&+ev.target.value>0)$('#f_status').value='done';autoCalc()};$('#formcard').onchange=autoCalc;autoCalc();
}
function autoCalc(){const a=$('#f_auto');if(!a)return;const v=id=>+($(id)?.value||0);
 if(form==='dry'){const r=K.rows.find(r=>r.id===$('#f_lot').value);if(!r)return;const c=v('#f_dcopra'),y=c/r.rawKg;
  a.innerHTML=`<span class="tag">AUTO</span> Raw dried <b>${N(r.rawKg)} kg</b>${c?` · yield <b id="f_yield">${pc(y)}</b>${K.bid.hasData?' (avg '+pc(K.bid.yield)+')':''} · worth about ${P0(c*S().copraPrice)} at ${P(S().copraPrice)}, <b>not income until sold</b>`:''}${c>r.rawKg?'<br>⚠️ More than raw kg':''}`}
 if(form==='buy'){const tot=v('#f_raw')*v('#f_buy'),y=v('#f_raw')&&v('#f_copra')?v('#f_copra')/v('#f_raw'):null,s=S();
  const bills=v('#f_gas')+(editing&&editing.id?live('expenses').filter(x=>x.batch_id===editing.id&&x.category!=='Gas').reduce((t,x)=>t+x.amount,0):0);
  const pj=Calc.projectNew(K,s,v('#f_raw'),tot,bills);
  const projH=pj?`<div id="f_proj" style="margin-top:6px"><b>📈 Projection</b> (yield ${pc(pj.yield)}): copra <b>${N(pj.copra)} kg</b> (${N(pj.low)}–${N(pj.high)}) ≈ <b>${P0(pj.value)}</b> at ${P(s.copraPrice)} · uling ≈ ${N(pj.uling)} kg ≈ ${P0(pj.ulingValue)} · <b>profit after bills ${P0(pj.profit)}</b> (${P0(pj.profitLow)} to ${P0(pj.profitHigh)})${y?`<br>Actual copra ${N(v('#f_copra'),1)} kg vs projected ${N(pj.copra)} kg: <b>${((v('#f_copra')-pj.copra)/pj.copra*100).toFixed(1)}%</b>`:''}</div>`:'';
  a.innerHTML=`<span class="tag">AUTO</span> Total price <b>${P(tot)}</b>${y?` · yield <b>${pc(y)}</b> · copra value at ${P(S().copraPrice)}: <b>${P(v('#f_copra')*S().copraPrice)}</b>`:''}${projH}${!K.bid.hasData?'':v('#f_buy')>K.bid.be?'<br>⚠️ Above break-even '+P(K.bid.be)+' — lugi!':v('#f_buy')>K.bid.good?'<br>Between good bid and break-even — thin margin.':v('#f_buy')?'<br>✅ At or under good bid.':''}`}
 if(form==='sale'){const r=K.rows.find(r=>r.id===$('#f_batch').value);if(!r)return;const avail=r.onHand+(editing&&editing.batch_id===r.id?+editing.kg:0),kg=v('#f_kg');a.innerHTML=`<span class="tag">AUTO</span> Sale total <b>${P(kg*v('#f_price'))}</b> · on hand after: <b>${N(Math.max(0,avail-kg),1)} kg</b>${kg>avail+1e-9?'<br>⚠️ More than on hand ('+N(avail,1)+' kg)':''}`}
 if(form==='char'){const y=v('#f_bagol')?v('#f_uling')/v('#f_bagol'):0,burning=$('#f_status').value==='burning';a.innerHTML=burning?`<span class="tag">AUTO</span> 🔥 In kiln — <b>nothing added to the uling pool yet</b>. When the burn is finished, enter uling kg (status switches to Done).`:`<span class="tag">AUTO</span> Yield <b>${pc(y)}</b> · adds ${N(v('#f_uling'))} kg to the pool ≈ ${P0(v('#f_uling')*S().ulingPrice)}`}
 if(form==='usale'){const avail=K.char.ulingOnHand+(editing&&editing.id?+editing.kg:0),kg=v('#f_kg');a.innerHTML=`<span class="tag">AUTO</span> Sale total <b>${P(kg*v('#f_price'))}</b> · pool after: <b>${N(Math.max(0,avail-kg),1)} kg</b>`}}
const numv=id=>{const x=$(id).value.trim();return x===''?null:+x};
async function saveForm(){const v=id=>$(id).value,e=editing||{};let msg='Saved ✓';
 const fail=m=>{toast('⚠️ '+m);$('#aftersave').innerHTML='';const a=$('#f_err');if(a){a.textContent='⚠️ '+m;a.style.display='block'}return false};
 const chk=(kind,rec,ctx)=>{const m=Calc.validate(kind,rec,ctx);return m?fail(m):true};
 if(form==='buy'){const rec={date:v('#f_date')||null,rawKg:numv('#f_raw'),buyPrice:numv('#f_buy'),asarez:numv('#f_as'),gas:numv('#f_gas'),copraKg:numv('#f_copra')??0,paidBy:pv('f_paid')};if(!chk('buy',rec))return;
  if(e.id){const cur=K.rows.find(r=>r.id===e.id),soldNow=cur?cur.soldKg:0;
   if(rec.copraKg<soldNow-1e-9&&Math.abs(rec.rawKg-e.rawKg)<1e-9&&!$('#f_rawok').checked){$('#f_rawfix').style.display='block';
    return fail(`Copra ${N(rec.copraKg,1)} kg is below the ${N(soldNow,1)} kg already sold. Enter the corrected raw kg for this batch (or tick "Raw kg is already correct").`)}}
  const prevUn=e.id?live('sales').filter(x=>!x.batch_id&&x.from_batch===e.id):[],lc=Math.max(+e.copraKg||0,...prevUn.map(x=>+x.lineage_copra||0));
  if(e.id){const asg=live('sales').filter(x=>x.batch_id===e.id).reduce((t,x)=>t+x.kg,0),ex=Math.max(0,asg-rec.copraKg);
   const sim={batches:live('batches').map(x=>x.id===e.id?{...x,rawKg:rec.rawKg,copraKg:rec.copraKg}:x),sales:live('sales').filter(x=>x.batch_id!==e.id).concat([{id:'sim-a',batch_id:e.id,kg:asg-ex},{id:'sim-u',batch_id:null,from_batch:e.id,lineage_copra:lc,kg:ex}].filter(x=>x.kg>0))};
   const le=Calc.lineageErrors(sim);if(le.length)return fail(le[0]+'. Fix raw / copra kg, or assign the unassigned sale first.')}
  const no=e.no||Math.max(0,...live('batches').map(b=>b.no))+1;
  const b=await store.save('batches',{...e,no,dev:e.id?e.dev:DEV,date:rec.date,source:v('#f_src').trim()||'Batch '+no,rawKg:rec.rawKg,buyTotal:Math.round(rec.rawKg*rec.buyPrice*100)/100,asarez:rec.asarez,copraKg:rec.copraKg,paidBy:rec.paidBy,dryDate:rec.copraKg>0?(e.dryDate||rec.date):null});
  const g=live('expenses').find(x=>x.batch_id===b.id&&x.category==='Gas');if(rec.gas||g)await store.save('expenses',{...(g||{}),batch_id:b.id,date:rec.date,category:'Gas',amount:rec.gas||0,note:''});msg='Batch '+bl(b)+' saved ✓';
  // Copra reduced below what was already sold (e.g. a sheet row that combined two loads): move the excess sold kg to an
  // UNASSIGNED sale (same price) instead of blocking the edit or losing revenue. User re-assigns it in Records.
  if(e.id){let sold=live('sales').filter(x=>x.batch_id===b.id).sort((x,y)=>(y.date||'').localeCompare(x.date||'')),excess=live('sales').filter(x=>x.batch_id===b.id).reduce((t,x)=>t+x.kg,0)-rec.copraKg;
   for(const x of sold){if(excess<=1e-9)break;const cut=Math.min(x.kg,excess);excess-=cut;
    if(cut>=x.kg-1e-9)await store.save('sales',{...x,batch_id:null,from_batch:b.id,lineage_copra:lc});else{await store.save('sales',{...x,kg:Math.round((x.kg-cut)*1000)/1000});await store.save('sales',{batch_id:null,from_batch:b.id,lineage_copra:lc,date:x.date,kg:Math.round(cut*1000)/1000,price:x.price,buyer:x.buyer||''})}
    msg+=` · ${N(cut,1)} kg of its sale moved to "not assigned" — open Records to assign it`}}}
 if(form==='sale'){if(!$('#f_batch').value)return fail('Pick a batch for this sale');const st=$('#f_st .on').dataset.s;
  if(st==='none'&&!e.id){msg='Marked as not yet sold (stock) ✓'}else{
   const r=K.rows.find(r=>r.id===$('#f_batch').value),avail=r.onHand+(e.id&&e.batch_id===r.id?+e.kg:0);
   const rec={date:v('#f_date')||null,kg:numv('#f_kg'),price:numv('#f_price'),receivedBy:pv('f_recv')};if(!chk('sale',rec,{onHand:avail}))return;
   await store.save('sales',{...e,batch_id:r.id,date:rec.date,kg:rec.kg,price:rec.price,buyer:v('#f_buyer').trim(),receivedBy:rec.receivedBy});msg='Sale saved ✓';const rr=Calc.compute(await store.snapshot(),today()).rows.find(x=>x.id===r.id);if(rr&&rr.status==='sold')msg+=' · batch '+bl(r)+' Complete'}}
 if(form==='dry'){if(!$('#f_lot'))return fail('No lot to dry yet. Log a buy first in 🛒 Bili.');const lot=live('batches').find(x=>x.id===$('#f_lot').value),row=K.rows.find(x=>x.id===lot.id);
  const rec={copraKg:numv('#f_dcopra'),dryDate:v('#f_date')||null};if(!chk('yield',rec,{rawKg:lot.rawKg,soldKg:row.soldKg}))return;
  await store.save('batches',{...lot,copraKg:rec.copraKg,dryDate:rec.dryDate});msg=`Yield ${bl(lot)} saved ✓ · ${pc(rec.copraKg/lot.rawKg)}`}
 if(form==='char'){const rec={date:v('#f_date')||null,bagolKg:numv('#f_bagol'),ulingKg:numv('#f_uling')??0,status:v('#f_status')};if(!chk('char',rec))return;
  if(rec.status==='burning'&&rec.ulingKg>0)return fail('Uling kg is filled in but Status is still "In kiln (burning)" — uling only goes into the pool when Status is "Done". Change Status to Done, or set uling kg to 0 if it is still burning.');
  const pg=Calc.poolCheck(K,e.id?e:null,rec);if(pg)return fail(pg);
  const no=e.no||Math.max(0,...live('charcoal').map(b=>b.no))+1;const c=await store.save('charcoal',{...e,no,dev:e.id?e.dev:DEV,...rec});msg='Burn '+bl(c)+' saved ✓'}
 if(form==='usale'){const rec={date:v('#f_date')||null,kg:numv('#f_kg'),price:numv('#f_price')};if(!chk('usale',rec,{onHand:K.char.ulingOnHand+(e.id?+e.kg:0)}))return;
  await store.save('uling_sales',{...e,...rec,buyer:v('#f_buyer')});msg='Uling sale saved ✓'}
 if(form==='exp'){const rec={date:v('#f_date')||null,category:v('#f_cat'),amount:numv('#f_amt')};if(!chk('exp',rec))return;
  await store.save('expenses',{...e,...rec,batch_id:v('#f_batch')||null,note:v('#f_note')});msg='Expense saved ✓'}
 editing=null;await load();toast(msg);
 $('#aftersave').innerHTML=`<div class="card" id="nextbid"><h2>✓ ${esc(msg)}</h2><p class="sub">Dashboard updated. <b>Next batch bid guide:</b></p>${bidHTML(K.bid,true)}
  <div class="kv"><span>Copra net now</span><b>${P(K.copraNet)}</b></div><div class="kv"><span>Each partner now</span><b>${P(K.share)}</b></div><div class="kv"><span>Copra on hand</span><b>${N(K.onHand,1)} kg</b></div></div>`;
 sched();
}
// ---------- records ----------
function renderRecords(){const rows=[];
 K.rows.slice().reverse().forEach(b=>rows.push(['batches',b,`🛒 ${bl(b)} ${esc(b.source)} · ${N(b.rawKg)} kg @ ${P(b.buyTotal/b.rawKg)} · ${b.copraKg?N(b.copraKg,1)+' kg copra':'drying'} · <span class="tag">${esc(b.statusLabel)}</span>`]));
 live('sales').forEach(s=>{const b=D.batches.find(x=>x.id===s.batch_id&&!x.deleted);rows.push(['sales',s,`💰 Sale ${b?bl(b):'<b class="neg">not assigned</b>'} · ${N(s.kg,1)} kg × ${P(s.price)} ${esc(s.date||'')}`])});
 live('uling_sales').forEach(x=>rows.push(['uling_sales',x,`💵 Uling sale (pool) · ${N(x.kg,1)} kg × ${P(x.price)} ${esc(x.buyer||'')} ${esc(x.date||'')}`]));
 live('charcoal').sort((a,b)=>b.no-a.no).forEach(c=>rows.push(['charcoal',c,`🔥 Burn ${bl(c)} · ${N(c.bagolKg)}→${N(c.ulingKg)} kg · ${esc(c.status)}`]));
 live('expenses').forEach(x=>{const b=D.batches.find(y=>y.id===x.batch_id);rows.push(['expenses',x,`🧾 ${esc(x.category)} ${P(x.amount)} ${b?'· '+bl(b):''} ${esc(x.date||'')}`])});
 $('#v-rec').innerHTML=`<div class="card"><h2>Records (edit / delete)</h2><p class="sub">Deleted entries are kept hidden for sync and can be restored from backup.</p>${rows.map(([t,r,l])=>`<div class="item"><span>${l}</span><span style="white-space:nowrap">${t==='batches'&&(r.status==='unsold'||r.status==='part')?`<button class="sell" data-sell="${esc(r.id)}">Sold</button> `:''}<button data-ed="${esc(t+'|'+r.id)}">Edit</button> <button class="del" data-del="${esc(t+'|'+r.id)}">🗑</button></span></div>`).join('')}</div>`;
}
let preBatch=null;
document.addEventListener('click',async ev=>{const led=ev.target.dataset?.led,ldel=ev.target.dataset?.ldel;
 if(led){lifeEd=D.lifetime_items.find(x=>x.id===led);renderLife();window.scrollTo(0,$('#lifeform').offsetTop-70);return}
 if(ldel){if(!(window.__AUTOCONFIRM__||confirm('Delete this lifetime item?')))return;await store.remove('lifetime_items',ldel);if(lifeEd&&lifeEd.id===ldel)lifeEd=null;await load();toast('Deleted');sched();return}
 const pk=ev.target.closest&&ev.target.closest('.pick button');if(pk){pk.parentNode.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===pk));return}
 const dry=ev.target.dataset?.dry,yed=ev.target.dataset?.yed;
 if(dry||yed){editing=yed?D.batches.find(x=>x.id===yed):null;form='dry';preBatch=dry||null;show('add');$('#aftersave').innerHTML='';renderForm();preBatch=null;window.scrollTo(0,0);return}
 const ed=ev.target.dataset?.ed||ev.target.dataset?.ted,del=ev.target.dataset?.del,sell=ev.target.dataset?.sell;
 if(sell){editing=null;form='sale';preBatch=sell;show('add');$('#aftersave').innerHTML='';renderForm();preBatch=null;window.scrollTo(0,0);return}
 if(ed){const[t,id]=ed.split('|');editing=D[t].find(x=>x.id===id);form={batches:'buy',sales:'sale',charcoal:'char',expenses:'exp',uling_sales:'usale'}[t];show('add');renderForm();window.scrollTo(0,0)}
 if(del){const[t,id]=del.split('|');
  if(t==='charcoal'){const m=Calc.poolCheck(K,D.charcoal.find(x=>x.id===id),null);if(m){toast('⚠️ '+m);const r=$('#v-rec .card');if(r)r.insertAdjacentHTML('afterbegin',`<div class="note" id="delerr" style="background:#f8dcd5;border-color:#b5462f">⚠️ ${esc(m)}</div>`);return}}
  if(!(window.__AUTOCONFIRM__||confirm('Delete this entry?')))return;await store.remove(t,id);if(t==='batches')for(const x of live('sales').concat(live('expenses')).filter(x=>x.batch_id===id||(!x.batch_id&&x.from_batch===id)))await store.remove(D.sales.includes(x)?'sales':'expenses',x.id);await load();toast('Deleted');sched()}});
// ---------- backup / settings / sync ----------
const cfg=()=>JSON.parse(localStorage.getItem('kopra_sync')||'{}');
function renderMore(){const s=S(),c=cfg();
 $('#v-more').innerHTML=`<div class="card"><h2>Backup 💾</h2><p class="sub">Save a copy to your phone or Google Drive regularly.</p>
 <button class="btn" id="bx">⬇️ Export JSON (full backup)</button><button class="btn sec" id="bc">⬇️ Export CSV (batches, sales, expenses, uling, lifetime)</button>
 <label>Import JSON backup</label><input type="file" id="bi" accept=".json,application/json"><div class="note" id="bierr" style="display:none;background:#f8dcd5;border-color:#b5462f"></div><button class="btn red" id="br">Reset to original seed data</button><p class="sub">Reset also clears lifetime items (the starting data has none).</p></div>
 <div class="card"><h2>Settings</h2>${fld('s_cp','Current copra price ₱/kg',s.copraPrice)}${fld('s_m','Target margin ₱/kg (good bid = break-even − this)',s.targetMargin)}
 ${fld('s_start','Business start date',s.startDate,'date')}<div class="row"><div>${fld('s_p1','Partner 1',s.partners[0],'text')}</div><div>${fld('s_p2','Partner 2',s.partners[1],'text')}</div></div>
 <div class="row"><div>${fld('s_up','Uling price ₱/kg',s.ulingPrice)}</div><div>${fld('s_br','Bagol % of raw',s.bagolRatio)}</div></div>${fld('s_mc','Merienda cap ₱/kg raw',s.budget['Merienda / meals'])}
 ${fld('s_lm','Lifetime target margin ₱/kg copra (best price = lifetime break-even + this)',s.lifeMargin??Calc.LIFE.margin)}
 <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="s_lb" style="width:auto" ${s.lifeInBid===true?'checked':''}> Include lifetime costs in buying power (bid guide)</label>
 <p class="sub" id="s_lbhelp">Default off. Early on, capital spread over few kg makes cost per kg look high; it falls as you buy more.</p><div class="note" id="s_err" style="display:none;background:#f8dcd5;border-color:#b5462f"></div><button class="btn" id="ss">Save settings</button></div>
 ${FLAGS?`<div class="card" id="synccard"><h2>Cloud sync (beta) ☁️</h2><p class="sub">App works fully offline. Fill these in only when the Supabase project exists.</p>
 ${fld('c_url','Supabase URL',c.url||'','text')}${fld('c_key','Anon key',c.anonKey||'','text')}${fld('c_team','Team ID',c.teamId||'','text')}${fld('c_em','Email',c.user||'','email')}${fld('c_pw','Password','','password')}
 <button class="btn" id="cl">Sign in & sync now</button><p class="sub" id="cs" style="margin-top:8px">${c.accessToken?'Signed in as '+esc(c.user):'Not connected (offline only)'} · unsynced: <span id="cu"></span></p><div class="note" id="syncerr" style="display:none"></div></div>`:''}<div class="card" id="about"><h2>About</h2><p class="sub" style="margin:0 0 8px">JB Integrated Farm · copra and uling records (works offline).</p><p class="sub" id="abaddr" style="margin:0 0 8px">📍 Purok 2, Ohong-Duque Road, Taguibo, Butuan City</p><a class="btn" href="tel:+639682705321" id="abtel">📞 Call 0968 270 5321</a><a class="btn sec" href="buying/" id="abbuy">🥥 Buying page (nagbebenta ng buong matandang niyog?)</a></div><p class="sub" style="text-align:center">JB Integrated Farm v${typeof APP_VERSION!=='undefined'?APP_VERSION:'?'}</p>`;
 store.meta('lastSyncError').then(e=>{const x=$('#syncerr');if(x&&e){x.style.display='block';x.textContent='⚠️ Last sync failed: '+e.message+' ('+e.at+')'}});
 FLAGS&&store.adapter.all('batches').then(async()=>{let n=0;for(const t of store.TABLES)n+=(await store.unsynced(t)).length;$('#cu').textContent=n});
 const dl=(name,txt,type)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([txt],{type}));a.download=name;a.click()};
 $('#bx').onclick=async()=>dl(`jb-farm-backup-${iso()}.json`,JSON.stringify({app:'kopra',exported:new Date().toISOString(),...await store.snapshot()},null,1),'application/json');
 $('#bc').onclick=()=>{const csv=(rows,cols)=>[cols.join(',')].concat(rows.map(r=>cols.map(c=>JSON.stringify(r[c]??'')).join(','))).join('\n');
  dl(`jb-farm-${iso()}.csv`,['# batches',csv(K.rows,['no','date','source','rawKg','buy','buyTotal','asarez','copraKg','soldKg','onHand','sellPrice','exp','net','be','paidBy','dryDate']),'','# sales',csv(live('sales'),['batch_id','date','kg','price','buyer','receivedBy']),'','# expenses',csv(live('expenses'),['date','category','amount','batch_id','note']),'','# uling burns',csv(live('charcoal'),['no','date','bagolKg','ulingKg','status']),'','# uling sales (pool)',csv(live('uling_sales'),['date','kg','price','buyer']),'','# lifetime items',csv(live('lifetime_items'),['date','name','kind','amount','paidBy','note'])].join('\n'),'text/csv')};
 $('#bi').onchange=async ev=>{const f=ev.target.files[0];ev.target.value='';if(!f)return;try{const o=JSON.parse(await f.text());await store.replaceAll(o);await load();toast('Backup restored ✓');sched()}catch(e){toast('⚠️ '+(e.errors?'Backup rejected: '+e.errors[0]:'Not a valid backup file'));const x=$('#bierr');if(x){x.style.display='block';x.textContent='⚠️ Backup rejected: '+(e.errors||[e.message]).slice(0,5).join(' · ')}}};
 $('#br').onclick=async()=>{if(!(window.__AUTOCONFIRM__||confirm('Erase all entries and reload seed data?')))return;await store.replaceAll(SEED);await load();toast('Reset ✓');sched()};
 $('#ss').onclick=async()=>{const n=id=>{const x=$(id).value.trim();return x===''?null:+x};
  const m=Calc.validate('settings',{copraPrice:n('#s_cp'),targetMargin:n('#s_m'),startDate:$('#s_start').value,ulingPrice:n('#s_up'),bagolRatio:n('#s_br'),merienda:n('#s_mc'),lifeMargin:n('#s_lm'),lifeInBid:$('#s_lb').checked,partners:[$('#s_p1').value,$('#s_p2').value]},{today:iso()});
  if(n('#s_lm')==null){const m2='Lifetime margin must be between ₱0 and ₱20';toast('⚠️ '+m2);$('#s_err').textContent='⚠️ '+m2;$('#s_err').style.display='block';return}
  if(m){toast('⚠️ '+m);$('#s_err').textContent='⚠️ '+m;$('#s_err').style.display='block';return}
  await store.save('settings',{...s,copraPrice:n('#s_cp'),targetMargin:n('#s_m'),startDate:$('#s_start').value,partners:[$('#s_p1').value,$('#s_p2').value],ulingPrice:n('#s_up'),bagolRatio:n('#s_br'),budget:{...s.budget,'Merienda / meals':n('#s_mc')},lifeMargin:n('#s_lm'),lifeInBid:$('#s_lb').checked});await load();toast('Settings saved ✓');sched()};
 if(FLAGS)$('#cl').onclick=async()=>{const c={url:$('#c_url').value.trim(),anonKey:$('#c_key').value.trim(),teamId:$('#c_team').value.trim()};if(!c.url||!c.anonKey||!c.teamId)return toast('Fill URL, key, team ID');
  try{Object.assign(c,await Sync.signIn(c,$('#c_em').value,$('#c_pw').value));localStorage.setItem('kopra_sync',JSON.stringify(c));await runSync(true)}catch(e){toast('⚠️ '+e.message)}};
}
async function runSync(loud){if(!FLAGS)return;const c=cfg();if(!c.accessToken||!navigator.onLine)return;c.onTokens=t=>localStorage.setItem('kopra_sync',JSON.stringify({...cfg(),...t}));
 try{const r=await Sync.sync(store,Sync.SupabaseBackend(c),{teamId:c.teamId});if(r.pulled||loud)await load();loud&&toast(`Synced ↑${r.pushed} ↓${r.pulled}${r.conflicts.length?' · '+r.conflicts.length+' conflicts':''}`)}catch(e){toast('⚠️ Sync failed: '+e.message);if($('#syncerr')){$('#syncerr').style.display='block';$('#syncerr').textContent='⚠️ Last sync failed: '+e.message}}}
let st;function sched(){clearTimeout(st);st=setTimeout(runSync,1500)}
window.addEventListener('online',()=>runSync());setInterval(()=>runSync(),60000);
// ---------- nav ----------
function show(v){document.querySelectorAll('.view').forEach(x=>x.classList.toggle('on',x.id==='v-'+v));document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));if(v==='home')drawCharts()}
document.querySelector('nav').onclick=e=>{const b=e.target.closest('button');if(b){show(b.dataset.v);window.scrollTo(0,0)}};
$('#formseg').onclick=e=>{const b=e.target.closest('button');if(b){form=b.dataset.f;editing=null;$('#aftersave').innerHTML='';renderForm()}};
if('serviceWorker' in navigator&&location.protocol!=='file:'&&!window.__NO_SW__)navigator.serviceWorker.register('sw.js');
window.__ready=(async()=>{await store.seedIfEmpty(SEED);window.__migrated=await store.migrate();DEV=await store.device();await load()})();
