const CACHE_NAME = 'chess-offline-v3';
const ASSETS = [
  './index.html',
  './ladder.html',
  './leaderboard.html',
  './scorechart.html',
  './tournamentsetup.html',
  './tournamentsettings.html',
  './downloadtemplates.html',
  './pairing.html',
  './tournament.js',
  './manifest.json',
  './icon-192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) =>
            cacheName === 'site-cache-v1' ||
            (cacheName.startsWith('chess-offline-') && cacheName !== CACHE_NAME)
          )
          .map((cacheName) => caches.delete(cacheName))
      )
    )
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((response) =>
      response || fetch(event.request)
    )
  );
});
