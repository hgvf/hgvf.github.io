/* sw.js — offline cache for 下班倒數. Network-first for pages/scripts so updates
   land immediately when online; cache fallback when offline. Bump VERSION to purge. */
const VERSION = 'offwork-v1';
const CORE = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'assets/Cubic_11.woff2', 'assets/icon-192.png', 'assets/icon-512.png',
  'js/main.js', 'js/palette.js', 'js/pixel.js', 'js/sprites.js', 'js/storage.js', 'js/clock.js',
  'js/schedule.js', 'js/events.js', 'js/eggs.js', 'js/copy.js', 'js/finale.js', 'js/fx.js',
  'js/achievements.js', 'js/ui.js', 'js/offscene.js',
  'js/themes/index.js', 'js/themes/common.js', 'js/themes/meteor.js', 'js/themes/rocket.js',
  'js/themes/hourglass.js', 'js/themes/digital.js', 'js/themes/doomsday.js', 'js/themes/command.js',
  'js/themes/plant.js',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
