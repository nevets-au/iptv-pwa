const CACHE = "iptv-pwa-v2";
const APP_SHELL = ["/", "/index.html", "/manifest.json"];

// On install, cache only the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

// On activate, clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // ── Playlist: always go to network, never serve from cache ──
  if (url.pathname.includes('/playlist/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(event.request) // fallback to cache only if offline
      )
    );
    return;
  }

  // ── App shell: cache-first ──
  event.respondWith(
    caches.match(event.request).then(r => r || fetch(event.request))
  );
});
