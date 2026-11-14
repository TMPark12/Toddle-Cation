const CACHE_NAME = 'toddle-cation-v14';
const APP_FILES = ['./', './index.html', './style.css', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('toddle-cation-') && key !== CACHE_NAME).map(key => caches.delete(key)))));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).catch(() => caches.open(CACHE_NAME).then(cache => cache.match(request).then(response => response || (request.mode === 'navigate' ? cache.match('./index.html') : Response.error())))));
});