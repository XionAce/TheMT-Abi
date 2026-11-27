// The build supplies a content-based cache name and a list of public static assets.
const CACHE = __CACHE_NAME__;
const FILES = __SHELL_FILES__;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache =>
    cache.addAll(FILES.map(url => new Request(url, { cache: 'reload' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('abiverse-shell-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const home = request.mode === 'navigate' && ['/', '/index.html'].includes(url.pathname);
  const key = home ? '/index.html' : url.pathname;
  if (!FILES.includes(key) || (!home && url.search)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(key)) || fetch(request)));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const date = event.notification.data?.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    const page = windows.find(client => ['/', '/index.html'].includes(new URL(client.url).pathname));
    if (page) {
      await page.focus();
      page.postMessage({type:'planner-reminder', date});
    } else {
      await self.clients.openWindow('/?plannerDay=' + date + '#planner');
    }
  })());
});
