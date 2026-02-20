// Service Worker - CE Offline (PWA)
// Estrategia: precache de app shell + cache-first con actualización perezosa.
// Se añade soporte offline para PyScript (CDN) tras la primera carga online.

const CACHE_NAME = 'ce-offline-v18';

// ⚠️ Asegúrate que estos archivos existan en producción.
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

// PyScript (CDN) usado en index.html — precache como 'opaque' para offline.
const PYSCRIPT_VERSION = '2026.1.1';
const CDN_ASSETS = [
  `https://pyscript.net/releases/${PYSCRIPT_VERSION}/core.css`,
  `https://pyscript.net/releases/${PYSCRIPT_VERSION}/core.js`
];
const PYSCRIPT_ORIGIN = 'https://pyscript.net';

async function cacheUrl(cache, url) {
  try {
    const isHTTP = /^https?:\/\//i.test(url);
    const isCross = isHTTP && new URL(url).origin !== self.location.origin;
    const fetchOpts = isCross
      ? { mode: 'no-cors', cache: 'no-cache' } // respuestas 'opaque' aceptables
      : { cache: 'no-cache' };

    const resp = await fetch(url, fetchOpts);
    if (resp && (resp.ok || resp.type === 'opaque')) {
      await cache.put(url, resp);
    }
  } catch (e) {
    // no abortar por un asset faltante
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled([...ASSETS_LOCAL, ...CDN_ASSETS].map((u) => cacheUrl(cache, u)));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
  })());
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Navegaciones: fallback al shell cuando no hay red
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(req); }
      catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('./index.html')) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const isPyScriptCDN = url.origin === PYSCRIPT_ORIGIN;

  if (req.method === 'GET' && (sameOrigin || isPyScriptCDN)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) {
        event.waitUntil((async () => {
          try {
            const fresh = await fetch(req, sameOrigin ? { cache: 'no-cache' } : { mode: 'no-cors', cache: 'no-cache' });
            if (fresh && (fresh.ok || fresh.type === 'opaque')) await cache.put(req, fresh);
          } catch {}
        })());
        return cached;
      }
      try {
        const resp = await fetch(req, sameOrigin ? undefined : { mode: 'no-cors', cache: 'no-cache' });
        if (resp && (resp.ok || resp.type === 'opaque')) await cache.put(req, resp.clone());
        return resp;
      } catch {
        return new Response('Offline', { status: 503 });
      }
    })());
  }
});
