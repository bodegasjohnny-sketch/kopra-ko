// DOM behavior tests, not browser automation or visual verification.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom'),fixture=require('./helpers/metric-fixture.js');
const ROOT=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
async function setup(t,data=fixture()){
 const dom=new JSDOM(rd('index.html'),{url:'https://example.test/',runScripts:'outside-only'}),w=dom.window;
 t.after(()=>w.close());const context=dom.getInternalVMContext();w.eval=source=>vm.runInContext(source,context);w.__NO_SW__=true;w.__TODAY__='2026-01-10T12:00:00';w.scrollTo=()=>{};
 // jsdom has no layout / native dialog implementation; test our wiring only.
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.SEED=data;w.eval(rd('db.js'));w.eval(rd('calc.js'));w.eval(rd('app.js'));await w.__ready;
 w.eval('D=JSON.parse('+JSON.stringify(JSON.stringify(data))+');K=Calc.compute(D,today());render()');
 return {w,doc:w.document,dialog:w.document.querySelector('#metric-details')};
}
const keyClick=(w,el,key)=>el.dispatchEvent(new w.KeyboardEvent('keydown',{bubbles:true,key,cancelable:true}));
const back=(w,fn)=>new Promise(resolve=>{w.addEventListener('popstate',resolve,{once:true});fn();});

test('all Home cards, KPI boxes, inventory and bid numbers expose a working detail target',async t=>{
 const {w,doc,dialog}=await setup(t);
 for(const card of doc.querySelectorAll('#v-home .card')){assert.ok(card.dataset.detail,card.id);const b=card.querySelector('.detail-link');assert.ok(b,card.id);assert.equal(b.type,'button');assert.equal(b.getAttribute('aria-haspopup'),'dialog');}
 for(const el of doc.querySelectorAll('#v-home .kpi,#v-home .box')){assert.ok(el.dataset.detail,el.textContent);assert.equal(el.tabIndex,0);assert.equal(el.getAttribute('role'),'button');}
 const targets=Array.from(doc.querySelectorAll('#v-home [role="button"][data-detail],#v-home .detail-link'));
 for(const el of targets){el.click();assert.equal(dialog.open,true,el.textContent);assert.ok(doc.querySelector('#metric-title').textContent);assert.ok(doc.querySelector('#metric-body dl'));assert.ok(doc.querySelector('#metric-body details'));}
 assert.equal(w.history.length,2,'switching detail targets never stacks many back entries');
 assert.equal(dialog.getAttribute('aria-labelledby'),'metric-title');assert.equal(dialog.getAttribute('aria-describedby'),'metric-scope');
 assert.ok(doc.querySelector('#metric-body .detail-table[tabindex="0"]'));
});

test('Enter / Space, Close, browser Back / Forward, Escape and focus restoration', {timeout:5000},async t=>{
 const {w,doc,dialog}=await setup(t),el=doc.querySelector('#kpis .kpi');el.focus();
 keyClick(w,el,'Enter');assert.equal(dialog.open,true);assert.equal(doc.activeElement.id,'metric-close');
 await back(w,()=>doc.querySelector('#metric-close').click());assert.equal(dialog.open,false);assert.equal(doc.activeElement,el);
 keyClick(w,el,' ');assert.equal(dialog.open,true);
 await back(w,()=>w.history.back());assert.equal(dialog.open,false);assert.equal(doc.activeElement,el);
 await back(w,()=>w.history.forward());assert.equal(dialog.open,true);
 const ev=new w.Event('cancel',{cancelable:true});await back(w,()=>dialog.dispatchEvent(ev));assert.ok(ev.defaultPrevented);assert.equal(dialog.open,false);
});

test('card surface opens details while existing Sell action is not hijacked',async t=>{
 const {w,doc,dialog}=await setup(t);doc.querySelector('#stock .kv b').click();assert.equal(dialog.open,true);
 await back(w,()=>w.history.back());doc.querySelector('#stock [data-sell]').click();assert.equal(dialog.open,false);assert.ok(doc.querySelector('#v-add').classList.contains('on'));
 assert.equal(doc.querySelector('#f_batch').value,'partial');
 assert.ok(doc.querySelector('#addinv .box').dataset.detail);
});

test('detail rendering escapes record text, has empty states and does not mutate local records',async t=>{
 const data=fixture();data.batches[0].source='<img src=x onerror="alert(1)">';data.expenses[0].note='<script>bad()</script>';
 const {w,doc}=await setup(t,data),before=w.eval('JSON.stringify(D)');
 doc.querySelector('#kpis .kpi').click();assert.ok(doc.querySelector('#metric-body').textContent.includes(data.batches[0].source));assert.equal(doc.querySelector('#metric-body img,#metric-body script'),null);assert.equal(w.eval('JSON.stringify(D)'),before);
 assert.match(doc.querySelector('#metric-body').textContent,/Read-only|read-only/);
 w.eval("D.batches=[];D.sales=[];D.expenses=[];D.charcoal=[];D.uling_sales=[];D.lifetime_items=[];K=Calc.compute(D,today());render()");
 assert.match(doc.querySelector('#metric-body').textContent,/No matching records/);
 doc.querySelector('#bidguide .detail-link').click();assert.match(doc.querySelector('#metric-body').textContent,/no bid \(—\)/);
});

test('open sheet recomputes from new device snapshot after edits; close restores a live trigger',async t=>{
 const {w,doc}=await setup(t);doc.querySelector('#kpis .kpi').click();const old=doc.querySelector('#metric-value').textContent;
 w.eval('D.sales[0].price=41;K=Calc.compute(D,today());render()');assert.notEqual(doc.querySelector('#metric-value').textContent,old);
 await back(w,()=>doc.querySelector('#metric-close').click());assert.equal(doc.activeElement,doc.querySelector('#kpis .kpi'));
});


test('restores a detail history entry after app reload/render without adding another history entry',async t=>{
 const {w,doc,dialog}=await setup(t);w.history.pushState({jbMetric:'stock'},'');const size=w.history.length;
 w.eval('render()');assert.equal(dialog.open,true);assert.match(doc.querySelector('#metric-title').textContent,/Unsold copra/);assert.equal(w.history.length,size);
 await back(w,()=>doc.querySelector('#metric-close').click());assert.equal(dialog.open,false);
});
