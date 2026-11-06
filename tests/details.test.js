const test=require('node:test'),assert=require('node:assert/strict');
const Calc=require('../calc.js'),fixture=require('./helpers/metric-fixture.js');
const TODAY=new Date(2026,0,10),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const trace=(d,key)=>Calc.explain(d,Calc.compute(d,TODAY),key);
const group=(d,title)=>d.groups.find(g=>g.title===title);
const ids=g=>g.rows.map(r=>r.id);
const line=(d,label)=>d.lines.find(l=>l.label===label);
const freeze=o=>{Object.freeze(o);for(const x of Object.values(o))if(x&&typeof x==='object')freeze(x);return o;};

test('every supported detail is read-only, finite, live-record-only and has a formula',()=>{
 const d=freeze(fixture()),k=freeze(Calc.compute(d,TODAY)),before=JSON.stringify(d);
 for(const key of Calc.DETAIL_KEYS){const x=Calc.explain(d,k,key);assert.ok(x.title&&x.lines.length&&x.groups.length,key);assert.ok(!/NaN|Infinity/.test(JSON.stringify(x)),key);for(const g of x.groups)for(const r of g.rows)assert.ok(!String(r.id).startsWith('deleted-'),key);}
 assert.equal(JSON.stringify(d),before);assert.equal(Calc.explain(d,k,'bad-key'),null);
});

test('inventory traces drying, partially sold, unsold and unassigned records without inventing income',()=>{
 const d=fixture(),k=Calc.compute(d,TODAY);near(k.inv.rawUndried,500);near(k.onHand,280);near(k.soldKg,200);
 assert.deepEqual(ids(group(trace(d,'rawUndried'),'Contributing batches')),['dry']);
 assert.deepEqual(ids(group(trace(d,'onHand'),'Contributing batches')),['partial','unsold','pending']);
 assert.ok(ids(group(trace(d,'sold'),'Copra sales included')).includes('sale-unassigned'));
 assert.match(trace(d,'inventory').notes.join(' '),/NOT income/);
});

test('cash net vs realized, partial sold-cost allocation and 50/50 are preserved',()=>{
 const d=fixture(),k=Calc.compute(d,TODAY),x=trace(d,'combined');
 near(k.copraNet,-11290);near(k.realized,1686);near(k.combined,1906);near(k.share,953);
 const a=group(x,'Per-batch allocation (partial sales keep unsold cost in stock)').rows.find(r=>r.id==='partial');
 assert.equal(a.cells[2],'₱3,284.00');assert.equal(a.cells[3],'₱716.00');assert.equal(a.cells[4],'₱4,926.00');
 assert.match(x.notes.join(' '),/REALIZED copra, NOT cash copra net/);assert.match(line(x,'Each partner').formula,/÷ 2/);
 assert.deepEqual(ids(group(x,'Expenses excluded from copra cash net')),['bill-uling']);
 assert.ok(ids(group(x,'Expenses included')).includes('bill-linked-uling'));
 assert.match(x.notes.join(' '),/batch cost AND Uling costs/);
});

test('weighted averages use raw denominators, not mean of prices or yields',()=>{
 const d=fixture(),k=Calc.compute(d,TODAY);near(k.avgBuy,8);near(k.bid.yield,.26);near(k.avgSell,41.75);
 assert.equal(line(trace(d,'avgBuy'),'Weighted buy').value,'₱8.00');
 assert.match(line(trace(d,'yield'),'Eligible yield').formula,/390 kg.*1,500 kg/);
 assert.match(line(trace(d,'netPerKg'),'Net per raw kg').formula,/2,400 kg/);
});

test('bid exposes exact eligible batches, general expenses, exclusions, Settings and lifetime toggle',()=>{
 const d=fixture(),off=trace(d,'bid');
 assert.deepEqual(ids(group(off,'Eligible finished batches (includes unsold dried copra)')),['partial','unsold','complete']);
 assert.deepEqual(ids(group(off,'Excluded batches')),['dry','pending']);
 assert.deepEqual(ids(group(off,'Bid expenses included')),['bill-part','bill-unsold','bill-general','bill-linked-uling']);
 assert.deepEqual(ids(group(off,'Bid expenses excluded')),['bill-dry','bill-pending','bill-uling']);
 assert.equal(line(off,'Break-even / loss boundary').value,'₱12.80');assert.equal(line(off,'Good bid').value,'₱12.30');
 d.settings[0].lifeInBid=true;const on=trace(d,'goodBid');
 assert.equal(line(on,'Break-even / loss boundary').value,'₱12.70');assert.equal(line(on,'Good bid').value,'₱12.20');
 assert.match(line(on,'Lifetime cost / eligible raw').formula,/1,500 kg.*included/);
 d.sales[0].price=99;assert.equal(line(trace(d,'bid'),'Break-even / loss boundary').value,'₱12.70');
});

test('bid rounding is independently floored, lifetime prices are rounded up',()=>{
 const d=fixture();d.settings[0].copraPrice=50.027;d.settings[0].targetMargin=.506;
 const k=Calc.compute(d,TODAY),x=trace(d,'goodBid');near(k.bid.beRaw,12.80702);assert.equal(k.bid.be,12.8);assert.equal(k.bid.good,12.3);
 assert.match(line(x,'Good bid').formula,/unrounded/);assert.match(line(trace(d,'lifetime'),'All-in break-even').formula,/ceil cents/);
});

test('charcoal distinguishes done from burning, pool stock, estimated potential and gross costs caveat',()=>{
 const d=fixture(),k=Calc.compute(d,TODAY),x=trace(d,'ulingYield');
 near(k.char.uling,30);near(k.char.ulingOnHand,15);near(k.char.bagolOnHand,330);near(k.char.potKg,114);
 const b=group(x,'Burns in the combined pool');assert.equal(b.rows.find(r=>r.id==='burn-kiln').cells[5],'No');
 assert.match(line(x,'Potential rest').formula,/INCLUDES bagol in kiln/);assert.match(x.notes.join(' '),/Missing labor/);
 d.expenses=d.expenses.filter(r=>r.category!=='Uling');const gross=trace(d,'combined');
 assert.match(gross.notes.join(' '),/GROSS revenue.*missing, not zero/);assert.equal(line(gross,'Uling result').value,'₱300.00');
});

test('all-in lifetime uses all expenses/produced copra, never stock value',()=>{
 const d=fixture(),x=trace(d,'lifetime'),k=Calc.compute(d,TODAY);near(k.life.allExp,510);near(k.life.allIn,19860);
 assert.equal(ids(group(x,'All logged operating expenses')).length,7);assert.deepEqual(ids(group(x,'Lifetime items (separate from daily bills)')),['cap','one-off']);
 assert.match(line(x,'Average cost / kg copra').formula,/470 kg produced/);assert.match(x.notes.join(' '),/no copra kg means —/);
});

test('drying projection history, bills, trimmed range, and back-test inputs are traceable',()=>{
 const d=fixture(),x=trace(d,'drying');assert.deepEqual(ids(group(x,'Drying batches being projected')),['dry']);
 assert.deepEqual(ids(group(x,'Bills deducted from drying projections')),['bill-dry']);
 assert.deepEqual(ids(group(x,'Yield history (batch-number order)')),['partial','unsold','complete']);
 assert.match(line(x,'Range').formula,/drop ONE lowest and highest/);assert.match(x.notes.join(' '),/lower-numbered/);
 assert.ok(group(x,'Projection / back-test per batch').rows.some(r=>r.cells[8]==='Not tested'));
});

test('zero data / zero yield / zero sales / old backup missing optional tables are explicit',()=>{
 const d=fixture();for(const t of ['batches','sales','expenses','charcoal','uling_sales','lifetime_items'])d[t]=[];
 for(const key of Calc.DETAIL_KEYS){const x=trace(d,key);assert.ok(!/NaN|Infinity|undefined/.test(JSON.stringify(x)),key);for(const g of x.groups)assert.ok(g.empty);}
 assert.equal(line(trace(d,'bid'),'Good bid').value,'—');assert.equal(line(trace(d,'lifetime'),'All-in best price').value,'—');
 d.batches=[{id:'new',no:1,rawKg:100,buyTotal:800,copraKg:0}];delete d.uling_sales;delete d.lifetime_items;
 assert.equal(trace(d,'rawUndried').value,'100 kg');assert.match(trace(d,'drying').notes.join(' '),/no eligible finished history/);
});

test('provenance never copies arbitrary settings, sync credentials or deleted data',()=>{
 const d=fixture();d.settings[0].accessToken='DO-NOT-EXPOSE';d.sync={password:'DO-NOT-EXPOSE'};
 for(const key of Calc.DETAIL_KEYS)assert.ok(!JSON.stringify(trace(d,key)).includes('DO-NOT-EXPOSE'));
});
