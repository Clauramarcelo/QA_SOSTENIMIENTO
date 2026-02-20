// Service Worker - CE Offline (v18)
// App shell: cache-first (mismo origen) + PyScript CDN: network-first (CORS).
const CACHE_NAME = 'ce-offline-v18';

const ASSETS_LOCAL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './report.py',
  './manifest.json',
  './pyscript.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const PYSCRIPT_VERSION = '2026.1.1';
const CDN_ASSETS = [
  `https://pyscript.net/releases/${PYSCRIPT_VERSION}/core.css`,
  `https://pyscript.net/releases/${PYSCRIPT_VERSION}/core.js`
];
const PYSCRIPT_ORIGIN = 'https://pyscript.net';

async function precacheLocal(cache){
  await Promise.allSettled(ASSETS_LOCAL.map(async (u)=>{
    try{ const resp=await fetch(u,{cache:'no-cache'}); if(resp&&resp.ok) await cache.put(u, resp.clone()); }catch(_){}
  }));
}
async function precachePyScriptCors(cache){
  await Promise.allSettled(CDN_ASSETS.map(async (url)=>{
    try{
      const req=new Request(url,{mode:'cors',cache:'no-cache'});
      const resp=await fetch(req);
      if(resp && (resp.ok || resp.type==='cors')) await cache.put(req, resp.clone());
    }catch(_){}
  }));
}

self.addEventListener('install', (event)=>{
  event.waitUntil((async ()=>{
    const cache=await caches.open(CACHE_NAME);
    await precacheLocal(cache);
    await precachePyScriptCors(cache);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event)=>{
  event.waitUntil((async ()=>{
    const keys=await caches.keys();
    await Promise.all(keys.map(k=> k!==CACHE_NAME ? caches.delete(k) : Promise.resolve()));
  })());
  self.clients.claim();
});

self.addEventListener('fetch', (event)=>{
  const req=event.request;
  const url=new URL(req.url);

  if(req.mode==='navigate'){
    event.respondWith((async ()=>{
      try{ return await fetch(req); }
      catch{ const cache=await caches.open(CACHE_NAME); return (await cache.match('./index.html')) || new Response('Offline', {status:503}); }
    })());
    return;
  }

  const same = url.origin === self.location.origin;
  const isPy = url.origin === PYSCRIPT_ORIGIN;

  // PyScript CDN: network-first (CORS), fallback caché
  if(isPy && req.method==='GET'){
    event.respondWith((async ()=>{
      const cache=await caches.open(CACHE_NAME);
      try{
        const net=await fetch(req); // cors por defecto
        if(net && (net.ok || net.type==='cors')) await cache.put(req, net.clone());
        return net;
      }catch{
        const cached=await cache.match(req);
        return cached || new Response('Offline (PyScript)', {status:503});
      }
    })());
    return;
  }

  // Mismo origen: cache-first con actualización perezosa
  if(same && req.method==='GET'){
    event.respondWith((async ()=>{
      const cache=await caches.open(CACHE_NAME);
      const cached=await cache.match(req);
      if(cached){
        event.waitUntil((async ()=>{
          try{
            const fresh=await fetch(req,{cache:'no-cache'});
            if(fresh && fresh.ok) await cache.put(req, fresh);
          }catch(_){}
        })());
        return cached;
      }
      try{
        const net=await fetch(req);
        if(net && net.ok) await cache.put(req, net.clone());
        return net;
      }catch{
        return new Response('Offline', {status:503});
      }
    })());
  }
});
