/*
 * Service worker.
 *
 * Scope for Phase 6: make the app shell available offline, handle install prompts,
 * and provide honest offline fallbacks for practice modes.
 *
 * Strategy:
 *   - navigations: network first, fall back to the cached shell, then to offline.html;
 *   - static assets: cache first, refreshed in the background;
 *   - /api: network only (never cached);
 *   - install prompt handling for PWA installability.
 */

const CACHE_NAME = 'speaking-coach-shell-v2';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-maskable.svg',
  '/offline.html',
  '/screenshot-conversation.svg',
  '/screenshot-interview.svg',
  '/screenshot-vocabulary.svg',
];

let deferredPrompt = null;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Handle install prompt
self.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  // Notify clients that install is available
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type: 'INSTALL_AVAILABLE' });
    });
  });
});

self.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  console.log('Speaking Coach installed as PWA');
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'PROMPT_INSTALL') {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choice) => {
        if (choice.outcome === 'accepted') {
          console.log('User accepted install');
        }
        deferredPrompt = null;
      });
    }
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never serve a cached or stale API answer. A wrong session state is worse than
  // an honest "you appear to be offline".
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match('/index.html')) ?? (await cache.match('/offline.html')) ?? Response.error();
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});