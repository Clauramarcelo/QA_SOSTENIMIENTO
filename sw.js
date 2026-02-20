// Service Worker - CE Offline (PWA)
// Estrategia: precache de app shell + cache-first (same-origin) con actualización perezosa.
// Sube la versión en cada despliegue para forzar actualización del caché.

const CACHE_NAME = 'ce-offline-v16';

// ⚠️ Asegúrate de que TODOS estos archivos existan en producción.
// Si NO usas alguno (p.ej. pyscript.json), elimínalo del array.
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './report.py',
  './manifest.json',
  './pyscript.json',          // ← bórralo si no lo usas
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Precarga del app shell
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // addAll puede fallar si alguno no existe; lo hacemos robusto:
    await Promise.allSettled(ASSETS.map(async (url) => {
      try {
        const resp = await fetch(url, { cache: 'no-cache' });
        // Sólo cachea OK 200/opaques aceptables para same-origin
        if (resp && (resp.ok || resp.type === 'opaque')) {
          await cache.put(url, resp);
        }
      } catch (e) {
        // Silencioso: no abortar instalación por un asset faltante
        // console.warn('[SW] No se pudo precachear:', url, e);
      }
    }));
  })());
  self.skipWaiting();
});

// Limpieza de versiones antiguas
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k !== CACHE_NAME)
        .map(k => caches.delete(k))
    );
  })());
  self.clients.claim();
});

// Estrategia de respuesta
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // App-shell para navegaciones: si no hay red, sirve index.html
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        return net;
      } catch (_) {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match('./index.html');
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Para otros GET del mismo origen: cache-first con actualización perezosa
  if (req.method === 'GET' && new URL(req.url).origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) {
        // Actualiza en segundo plano (no bloquea la respuesta)
        event.waitUntil((async () => {
          try {
            const fresh = await fetch(req, { cache: 'no-cache' });
            if (fresh && fresh.ok) await cache.put(req, fresh);
          } catch (_) { /* sin red o error */ }
        })());
        return cached;
      }
      // Si no está cacheado, intenta red y guarda
      try {
        const resp = await fetch(req);
        if (resp && resp.ok) {
          // Evita cachear POST/PUT o orígenes cruzados
          await cache.put(req, resp.clone());
        }
        return resp;
      } catch (_) {
        // Último recurso: no hay cache ni red
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Peticiones a otros orígenes (CDNs, APIs, etc.): pasa directo
  // (Si deseas, aquí puedes agregar una estrategia específica para PyScript CDN)
});
