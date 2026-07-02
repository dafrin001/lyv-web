const CACHE = 'lyv-cache-v1';
const STATIC = [
  '/lyv-web/',
  '/lyv-web/index.html',
  '/lyv-web/app.js',
  '/lyv-web/colombia-data.js',
  '/lyv-web/api/local-ai.js',
  '/lyv-web/manifest.json',
  '/lyv-web/assets/logo-final.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Para archivos grandes del modelo ONNX, no cachear
  if (url.pathname.includes('/models/')) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
    return;
  }

  // Para la API, no cachear
  if (url.pathname.includes('/api/index.php')) {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
      if (res.ok && url.protocol === 'http:') {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
      }
      return res;
    }))
  );
});
