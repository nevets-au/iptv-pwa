const CACHE = "iptv-pwa-v1";
const FILES = ["/","/index.html","/manifest.json"];
self.addEventListener('install', e=> e.waitUntil(
  caches.open(CACHE).then(c=> c.addAll(FILES)).catch(()=>{})
));
self.addEventListener('fetch', event=>{
  if(event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(r => r || fetch(event.request))
  );
});