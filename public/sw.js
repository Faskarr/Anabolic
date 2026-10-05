/**
 * Service worker AnabolicOS.
 *
 * Stratégies :
 *  • Fichiers de l'app (même origine) : réseau d'abord, cache en secours
 *    → une mise à jour déployée est visible dès la réouverture, et l'app
 *      s'ouvre quand même hors ligne.
 *  • SDK Firebase (gstatic, URL versionnée) et polices : cache d'abord
 *    → ces fichiers ne changent jamais pour une version donnée.
 *  • Tout le reste (API Firestore, Auth, /__/auth/…) : NON intercepté.
 *
 * Incrémente VERSION pour forcer la purge des anciens caches.
 */
const VERSION = 'v1';
const APP_CACHE = `app-${VERSION}`;
const CDN_CACHE = `cdn-${VERSION}`;

const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/css/tokens.css',
  '/css/base.css',
  '/css/components.css',
  '/js/app.js',
  '/js/firebase.js',
  '/js/auth.js',
  '/js/lib/dom.js',
  '/js/lib/dates.js',
  '/js/ui/toast.js',
  '/js/views/login.js',
  '/js/views/disabled.js',
  '/js/views/foundation.js',
  '/icons/apple-touch-icon.png',
];

const CDN_HOSTS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== APP_CACHE && k !== CDN_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Same origin, hors routes réservées Firebase.
  if (url.origin === self.location.origin && !url.pathname.startsWith('/__/')) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
  // Sinon : laisser passer (Firestore, Auth, Google…).
});

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true })
      || (request.mode === 'navigate' ? await cache.match('/') : undefined);
    return cached || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}
