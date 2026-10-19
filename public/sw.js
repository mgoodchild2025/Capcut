// Offline support. Pages come from the network when it's there (so a new release shows up on the
// next launch) and from the cache when it isn't. Built files have content hashes in their names,
// so once cached they never change.
//
// Each release's code files are cached up front, and the last few releases are kept: a page left
// open across a release can still load the code it asks for later (export, AI tools), which the
// server no longer has. The build fills in BUILD (see vite.config.ts).
const BUILD = { id: 'dev', assets: [] };
const PREFIX = 'clipforge-';
const CACHE = PREFIX + BUILD.id;
const KEEP = 4;
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png'];
const STAMP = './__cached-at';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await c.put(STAMP, new Response(String(Date.now())));
      // One by one, so a single failure doesn't stop the rest.
      await Promise.all([...SHELL, ...BUILD.assets.map((a) => './' + a)].map((u) => c.add(u).catch(() => {})));
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Keep the newest few releases (older caches have no stamp and count as oldest).
      const mine = (await caches.keys()).filter((k) => k.startsWith(PREFIX));
      const dated = await Promise.all(
        mine.map(async (k) => {
          const r = await (await caches.open(k)).match(STAMP);
          return { k, at: r ? Number(await r.text()) : 0 };
        }),
      );
      dated.sort((a, b) => b.at - a.at);
      for (const { k } of dated.slice(KEEP)) if (k !== CACHE) await caches.delete(k);
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
