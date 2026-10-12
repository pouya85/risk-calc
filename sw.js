// هر بار فایل‌ها عوض شدند، این نسخه را بالا ببر تا کش قدیمی پاک شود
const CACHE = 'riskcalc-v4';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'killzone.js',
  'fonts/Vazirmatn-wght.woff2',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// اول شبکه (تا نسخهٔ جدید برسد)، اگر آفلاین بود از کش
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
