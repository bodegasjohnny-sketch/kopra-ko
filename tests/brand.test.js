// v1.6.0 JB Integrated Farm rename and /buying sales page checks.
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path'),cp=require('child_process');
const ROOT=path.join(__dirname,'..');const rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const shipped=cp.execSync('git ls-files -co --exclude-standard',{cwd:ROOT}).toString().split('\n').filter(f=>f&&!f.startsWith('screenshots/')&&!f.startsWith('tests/')&&/\.(html|js|css|webmanifest|json|md|txt|xml|sql)$/.test(f)&&fs.existsSync(path.join(ROOT,f)));
// supabase/ holds setup SQL that is not part of the app UI (left untouched in this task; see README open question).
const ui=shipped.filter(f=>!f.startsWith('supabase/'));
test('owner name appears in no shipped app file',()=>{for(const f of ui){const s=rd(f);assert.ok(!/juvy|barbosa/i.test(s),f)}});
test('address is not shipped',()=>{for(const f of shipped)assert.ok(!/ohong|purok|duque road/i.test(rd(f)),f)});
test('user-visible name is JB Integrated Farm',()=>{const m=JSON.parse(rd('manifest.webmanifest'));assert.equal(m.name,'JB Integrated Farm');assert.equal(m.short_name,'JB Farm');
  const h=rd('index.html');assert.ok(h.includes('<title>JB Integrated Farm</title>')&&h.includes('🥥 JB Integrated Farm')&&!/Kopra Ko/.test(h));assert.ok(!/Kopra Ko v/.test(rd('app.js')));assert.ok(!/Kopra Ko/.test(rd('buying/index.html')))});
test('storage names kept for data carry-over',()=>{assert.ok(rd('db.js').includes("'kopra'"));assert.ok(rd('sw.js').includes("const V='kopra-'+SW_VERSION"));assert.ok(rd('app.js').includes("'kopra_sync'"))});
test('phone links are correct everywhere',()=>{for(const f of ['index.html','app.js','buying/index.html']){const s=rd(f);const tels=s.match(/tel:[^"']+/g)||[];assert.ok(tels.length>0,f);tels.forEach(t=>assert.equal(t,'tel:+639682705321',f))}
  const b=rd('buying/index.html');(b.match(/sms:[^"?]+/g)).forEach(t=>assert.equal(t,'sms:+639682705321'));(b.match(/https:\/\/wa\.me\/[0-9]+/g)).forEach(t=>assert.equal(t,'https://wa.me/639682705321'));
  assert.ok(b.includes('viber://chat?number=%2B639682705321'));const want='Magandang araw po, magbebenta po ako ng buong niyog (matured). Ilang kilo: __ . Lugar: __';[...b.matchAll(/(?:body|text)=([^"]+)/g)].forEach(m=>assert.equal(decodeURIComponent(m[1]),want))});
test('buying page SEO, JSON-LD and no price claim',()=>{const b=rd('buying/index.html');assert.ok(b.includes('<link rel="canonical" href="https://copra.johnnybodegas.com/buying">'));
  for(const k of ['og:title','og:description','og:image','twitter:card'])assert.ok(b.includes(k),k);
  const ld=[...b.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>JSON.parse(m[1]));const org=ld.find(x=>x['@type']==='Organization');assert.deepEqual(Object.keys(org).sort(),['@context','@type','name','telephone','url']);assert.equal(org.telephone,'+639682705321');
  const faq=ld.find(x=>x['@type']==='FAQPage');assert.ok(faq.mainEntity.length>=6&&faq.mainEntity.length<=8);
  assert.ok(b.includes("var PRICE_TODAY='';"));assert.ok(!/₱\s*\d|PHP\s*[1-9]/.test(b.replace(/\/\/ PRICE:.*\n/,'')));assert.ok(!b.includes('\u2014'));assert.ok(!/serviceWorker|rel="manifest"/.test(b));assert.ok(fs.existsSync(path.join(ROOT,'buying/og.png')))});
test('version consistency 1.6.0',()=>{const v=rd('version.js').match(/APP_VERSION='([^']+)'/)[1],s=rd('sw.js').match(/SW_VERSION='([^']+)'/)[1];assert.equal(v,'1.6.0');assert.equal(s,v);assert.ok(rd('README.md').includes('v1.6.0'))});
test('SW sends /buying to the network, never the app shell',()=>{const s=rd('sw.js');assert.ok(s.includes('isBuying(u)'));assert.ok(!/respondWith\([^)]*index\.html/.test(s))});
test('buying offer: whole matured coconuts, tagline, 200 kg pickup, no dried copra claim',()=>{const b=rd('buying/index.html');
  assert.ok(b.includes('Iwan mo na sa amin ang hassle, kami na ang gagawa ng kopra. Bayad ka sa araw ng bentahan.'));
  assert.ok(b.includes('200 kg pataas, kukunin namin sa inyong lugar'));assert.ok(/buong niyog/.test(b)&&/matured/.test(b));
  assert.ok(!/dried copra|tuyong kopra|libre|free pickup/i.test(b));assert.ok(!/Tinitimbang sa harap|mismo ang sasagot|depende sa dami/i.test(b));
  assert.ok(b.includes('Tawag lang po, pag-usapan natin ang pinakamainam.'));assert.ok(b.includes('Tawag para sa presyo ngayon'))});
