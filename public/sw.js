/**
 * Service worker AnabolicOS — démarrage instantané.
 *
 * Stratégies :
 *  • Fichiers de l'app (même origine) : CACHE D'ABORD. Chaque version (VERSION)
 *    est téléchargée EN ENTIER à l'installation du service worker, puis servie
 *    depuis le téléphone → plus aucune requête réseau au lancement, et jamais de
 *    mélange ancienne / nouvelle version (cause des pages blanches).
 *  • Nouvelle version déployée : le navigateur la détecte (sw.js modifié), la
 *    télécharge en arrière-plan, puis l'app se recharge d'elle-même si elle
 *    vient d'être ouverte, ou propose « Recharger » (voir app.js).
 *  • SDK Firebase (gstatic, URL versionnée) : cache d'abord.
 *  • Tout le reste (API Firestore, Auth, /__/auth/…) : NON intercepté.
 *
 * Incrémente VERSION à chaque déploiement (fait automatiquement avec la liste).
 */
const VERSION = 'vf1165392ef';
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
  '/js/data/links.js',
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
  '/js/ui/ambient.js',
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
  '/js/views/admin-links.js',
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
  // cache: 'reload' → on télécharge vraiment la nouvelle version (pas le cache HTTP).
  // Si un seul fichier manque, l'installation échoue et l'ancienne version reste
  // servie intacte : pas de page blanche.
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((c) => c.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
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
    event.respondWith(appFirst(request, event));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
  // Sinon : laisser passer (Firestore, Auth, Google…).
});

/**
 * Cache d'abord pour les fichiers de l'app (version complète téléchargée à
 * l'installation). Fichier absent du cache (ex. image) : réseau, puis mis en cache.
 */
async function appFirst(request, event) {
  const cache = await caches.open(APP_CACHE);
  const url = new URL(request.url);
  const key = request.mode === 'navigate' ? '/' : url.pathname;
  const cached = await cache.match(key, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && request.mode !== 'navigate') event.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch {
    return (await cache.match('/')) || Response.error();
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
