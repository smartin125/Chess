const CACHE_NAME = 'site-cache-v1';
// List every file your site needs to work offline
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './icon-192.png'
];

// Install event: caches all listed files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Fetch event: serves cached files when offline
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
