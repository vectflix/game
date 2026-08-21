// Minimal service worker. Its only job is to exist and be registered, since
// that's one of the checks Chrome/Android use before offering the native
// "Install app" prompt.
//
// Deliberately NOT caching any files here. A caching service worker can get
// stuck serving an old, broken version of the site indefinitely — a normal
// browser refresh (even a hard refresh) does NOT clear it, only an explicit
// "unregister service worker" / clear-site-data action does. That's a bad
// trade while this app is still being actively changed, so every request
// just passes straight through to the network.
const CACHE_VERSION = 'spindle-v2-nocache';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Clean up any caches a previous version of this service worker created.
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// No fetch handler at all — every request goes straight to the network,
// exactly as if there were no service worker in the way.
