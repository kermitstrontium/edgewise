/* Edgewise service worker. Network-first with cache fallback: works offline
   once loaded, but always picks up a new deploy when online.
   BUILD is stamped by deploy.sh; the bytes must change for phones to update. */

const BUILD = '20261106-132403';
const CACHE = 'edgewise-' + BUILD;
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/main.js', './js/gen.js', './js/world.js', './js/levels.js', './js/worker.js',
  './js/sound.js', './js/changelog.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'no-store' }))))
    .catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('edgewise-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
