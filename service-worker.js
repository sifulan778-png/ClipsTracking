/* ══ Clips Tracking — Service Worker v2 ══ */

const CACHE_NAME = 'clips-tracking-v2';
const CACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './192.png',
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'
];

/* ── Install: cache semua aset, skip waiting agar langsung aktif ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // addAll gagal jika satu saja request error (misal font offline saat install).
      // Pakai Promise.allSettled manual agar aset lokal tetap ter-cache.
      return Promise.allSettled(
        CACHE_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Gagal cache:', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* ── Activate: hapus SEMUA cache lama, bukan hanya prefix tertentu ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Hapus cache lama:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: Cache-first untuk aset lokal, Network-first untuk CDN ── */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const swScope = self.registration.scope;

  // Abaikan request di luar scope SW ini
  if (!event.request.url.startsWith(swScope) && !event.request.url.includes('fonts.googleapis.com') && !event.request.url.includes('fonts.gstatic.com')) {
    return;
  }

  // Font CDN: Cache-first (font jarang berubah)
  if (url.hostname.includes('fonts.')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached); // fallback ke cache jika offline
      })
    );
    return;
  }

  // Aset lokal: Cache-first, update di background (Stale-While-Revalidate)
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(response => {
          if (response && response.status === 200 && response.type !== 'opaque') {
            cache.put(event.request, response.clone());
          }
          return response;
        }).catch(() => null);

        // Kembalikan cache dulu (cepat), fetch di background untuk update
        return cached || fetchPromise.then(res => {
          if (res) return res;
          // Offline fallback: kembalikan index.html untuk navigation request
          if (event.request.destination === 'document') {
            return cache.match('./index.html') || cache.match('./');
          }
        });
      })
    )
  );
});

/* ── Push Notification ── */
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Clips Tracking';
  const options = {
    body: data.body || 'Ada pengingat untuk kamu!',
    icon: '192.png',
    badge: '192.png',
    data: data.url || './',
    vibrate: [100, 50, 100],
    tag: 'clips-tracking-notif', // Cegah notif duplikat
    renotify: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/* ── Notification Click ── */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Cari tab yang sudah buka app ini
      for (const client of clientList) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      // Tidak ada tab terbuka — buka baru
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data || self.registration.scope);
      }
    })
  );
});
