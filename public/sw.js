// Offline support. Pages come from the network when it's there (so a new release shows up on the
// next launch) and from the cache when it isn't. Built files have content hashes in their names,
// so once cached they never change.
const CACHE = 'clipforge-v1';
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function put(req, res) {
  if (res.ok && res.status === 200 && res.type !== 'opaque') {
    const cache = await caches.open(CACHE);
    await cache.put(req, res.clone());
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !fonts) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => put('./', res)).catch(async () => (await caches.match('./')) ?? Response.error()));
    return;
  }
  if (url.pathname.includes('/assets/') || fonts) {
    e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then((res) => put(req, res))));
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req).then((res) => put(req, res));
      return hit ?? fresh;
    }),
  );
});
