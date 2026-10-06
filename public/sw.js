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
const VERSION = 'v12';
const APP_CACHE = `app-${VERSION}`;
const CDN_CACHE = `cdn-${VERSION}`;

const APP_SHELL = [
  '/',
  '/css/app.css',
  '/css/base.css',
  '/css/components.css',
  '/css/splash.css',
  '/css/tokens.css',
  '/fonts/barlow-condensed-latin-500-normal.woff2',
  '/fonts/barlow-condensed-latin-600-normal.woff2',
  '/js/app.js',
  '/js/auth.js',
  '/js/data/admin.js',
  '/js/data/avatars.js',
  '/js/data/friends.js',
  '/js/data/goals.js',
  '/js/data/importer.js',
  '/js/data/inbox.js',
  '/js/data/messages.js',
  '/js/data/posts.js',
  '/js/data/repo.js',
  '/js/firebase.js',
  '/js/lib/dates.js',
  '/js/lib/dom.js',
  '/js/lib/ics.js',
  '/js/lib/ids.js',
  '/js/lib/image.js',
  '/js/lib/schedule.js',
  '/js/lib/schema.js',
  '/js/store.js',
  '/js/ui/avatar.js',
  '/js/ui/chart.js',
  '/js/ui/chat.js',
  '/js/ui/cropper.js',
  '/js/ui/feed.js',
  '/js/ui/icons.js',
  '/js/ui/install.js',
  '/js/ui/layout.js',
  '/js/ui/logo.js',
  '/js/ui/sheet.js',
  '/js/ui/splash.js',
  '/js/ui/tabbar.js',
  '/js/ui/theme.js',
  '/js/ui/timer.js',
  '/js/ui/toast.js',
  '/js/views/admin-library.js',
  '/js/views/admin-messages.js',
  '/js/views/admin.js',
  '/js/views/contact.js',
  '/js/views/diet-calc.js',
  '/js/views/diet.js',
  '/js/views/disabled.js',
  '/js/views/foundation.js',
  '/js/views/goals.js',
  '/js/views/home.js',
  '/js/views/login.js',
  '/js/views/me.js',
  '/js/views/messages-hub.js',
  '/js/views/protocol.js',
  '/js/views/share.js',
  '/js/views/training.js',
  '/js/views/weight.js',
];

const CDN_HOSTS = ['www.gstatic.com'];

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
    // cache: 'no-cache' → revalidation systématique auprès du serveur
    // (évite qu'iOS serve un index.html périmé avec du JS récent).
    const response = await fetch(request, { cache: 'no-cache' });
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
