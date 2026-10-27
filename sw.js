// JB Integrated Farm app service worker (cache prefix stays kopra- so old caches are cleaned and data is untouched). SW_VERSION MUST equal APP_VERSION in version.js (unit test enforces it).
// It is embedded here on purpose: browsers only install a new worker when sw.js bytes change.
const SW_VERSION='1.6.0';
const V='kopra-'+SW_VERSION;
const F=['./','./index.html','./app.js','./calc.js','./db.js','./sync.js','./seed.js','./version.js','./style.css','./lib/chart.umd.min.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
// cache:'reload' so a new release never pre-caches stale files from the HTTP cache.
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(F.map(u=>new Request(u,{cache:'reload'})))));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith('kopra-')&&x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
// Only same-origin static GETs are cached. Supabase / any API / auth / cross-origin requests go straight to the network, never cached.
const isApi=u=>u.origin!==self.location.origin||/\/(rest|auth|realtime|storage|functions)\/v1\//.test(u.pathname);
// The /buying sales page is a separate static page: network first (fresh copy), cached copy only when offline. It is never answered with the app shell.
const isBuying=u=>/\/buying(\/|$)/.test(u.pathname);
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||isApi(u))return;
  if(isBuying(u)){e.respondWith(fetch(e.request).then(n=>{if(n.ok&&n.type==='basic'){const c=n.clone();caches.open(V).then(x=>x.put(e.request,c))}return n}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||Response.error())));return}
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request).then(n=>{if(n.ok&&n.type==='basic'){const c=n.clone();caches.open(V).then(x=>x.put(e.request,c))}return n})))});
