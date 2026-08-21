// Minimal service worker — its only real job is to exist, since Chrome/Android
// require a registered service worker with a fetch handler before it will
// offer the native "Install app" prompt. It also caches the app shell so the
// game still opens (menu screen) if you're briefly offline; actual song data
// and audio always come from the network since that's the whole point of the
// game — real, live songs.
const CACHE = 'spindle-shell-v1';
const SHELL_FILES = ['./', './index.html', './style.css', './script.js', './manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL_FILES)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = event.request.url;
  // Never intercept song data/audio/API calls — only the static app shell.
  if(!SHELL_FILES.some(f => url.endsWith(f.replace('./','/')) || url.endsWith(f))){
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

