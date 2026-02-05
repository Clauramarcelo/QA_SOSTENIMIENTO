// Service Worker - cache básico para uso offline
const CACHE_NAME = 'ce-offline-v6';
const ASSETS = [
  './',
  './index_v2.html',
  './styles_v2.css',
  './app_v2.js',
  './manifest_v2.json',
  './report.py',
  './pyscript.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('./index_v2.html')));
    return;
  }
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        try {
          if (req.method === 'GET' && new URL(req.url).origin === self.location.origin) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
        } catch (_) {}
        return resp;
      });
    })
  );
});
