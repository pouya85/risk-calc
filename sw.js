// هر بار فایل‌ها عوض شدند، این نسخه را بالا ببر تا کش قدیمی پاک شود
const CACHE = 'riskcalc-v8';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'killzone.js',
  'journal.js',
  'fonts/Vazirmatn-wght.woff2',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  // cache:'reload' تا کش ۱۰ دقیقه‌ای GitHub Pages نسخهٔ قدیمی را در کش جدید نگذارد
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
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
  const sameOrigin = new URL(e.request.url).origin === self.location.origin;
  e.respondWith(
    // no-cache: همیشه با سرور چک کن (با ETag سبک است)، وگرنه تا ۱۰ دقیقه نسخهٔ قدیمی می‌ماند
    (sameOrigin ? fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(e.request))
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

// ---------- نوتیفیکیشن Killzone (از GitHub Actions) ----------
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Killzone', {
    body: data.body || '',
    tag: data.tag || 'kz',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: './?tab=kz' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        c.postMessage({ tab: 'kz' });
        return c.focus();
      }
      return self.clients.openWindow(e.notification.data?.url || './?tab=kz');
    })
  );
});
