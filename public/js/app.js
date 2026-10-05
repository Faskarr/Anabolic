/**
 * Point d'entrée de l'app utilisateur : session → store → routeur → vues.
 *
 * Routes (hash) : #/home  #/training  #/diet  #/protocol  #/me  #/me/weight  #/me/share  #/me/check
 * Chaque vue est une fonction pure (session) => Node[] ; elle est ré-exécutée
 * à chaque changement du store (temps réel) ou de route.
 */
import { mount, h } from './lib/dom.js';
import { onSession } from './auth.js';
import { startStore, stopStore, subscribe } from './store.js';
import { TabBar } from './ui/tabbar.js';
import { showTimer, stopTimer } from './ui/timer.js';
import { LoginView } from './views/login.js';
import { DisabledView } from './views/disabled.js';
import { FoundationView } from './views/foundation.js';
import { HomeView } from './views/home.js';
import { TrainingView } from './views/training.js';
import { DietView } from './views/diet.js';
import { ProtocolView } from './views/protocol.js';
import { MeView } from './views/me.js';
import { WeightView } from './views/weight.js';
import { ShareView } from './views/share.js';

// Version des fichiers statiques (à incrémenter à chaque déploiement visuel).
export const ASSET_VERSION = '0.2.1';

/**
 * Garde-fou : si un ancien index.html (mis en cache par iOS) est servi avec le
 * nouveau JavaScript, les feuilles de style récentes manquent. On les ajoute.
 */
function ensureStyles() {
  for (const name of ['tokens', 'base', 'components', 'app']) {
    if (!document.querySelector(`link[href^="/css/${name}.css"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `/css/${name}.css?v=${ASSET_VERSION}`;
      document.head.appendChild(link);
    }
  }
}
ensureStyles();

const ROUTES = {
  home: HomeView,
  training: TrainingView,
  diet: DietView,
  protocol: ProtocolView,
  me: MeView,
  'me/weight': WeightView,
  'me/share': ShareView,
  'me/check': FoundationView,
};

const root = document.getElementById('app');
let session = null;
let route = 'home';
let viewEl = null;
let tabHost = null;
let unsubStore = null;

function parseRoute() {
  const r = location.hash.replace(/^#\/?/, '');
  return ROUTES[r] ? r : 'home';
}

function LoadingView() {
  return h('main', { class: 'screen', 'aria-busy': 'true' },
    h('div', { class: 'center-stack', style: { alignItems: 'center' } },
      h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Chargement' })));
}

function ErrorView(error) {
  return h('main', { class: 'screen' },
    h('div', { class: 'center-stack' },
      h('div', { class: 'card' },
        h('h1', { class: 'card__title' }, 'Impossible de charger ton compte'),
        h('p', { class: 'card__text' }, error?.code || error?.message || 'Erreur inconnue'),
        h('button', {
          class: 'btn btn--ink btn--block', style: { marginTop: '16px' },
          type: 'button', onclick: () => location.reload(),
        }, 'Réessayer'))));
}

function mountShell() {
  viewEl = h('main', { class: 'view', id: 'view' });
  tabHost = h('div');
  mount(root, h('div', { class: 'shell' }, viewEl, tabHost));
}

/**
 * Rend la vue courante. Préserve le champ en cours de saisie (valeur + curseur)
 * pour qu'une mise à jour temps réel n'efface pas ce que l'utilisateur tape.
 */
function render({ scrollTop = false } = {}) {
  if (!session || session.state !== 'active' || !viewEl) return;

  const active = document.activeElement;
  const keep = active && active.id && viewEl.contains(active) && 'value' in active
    ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd }
    : null;

  showTimer(route === 'training');
  try {
    mount(viewEl, [ROUTES[route](session)].flat(Infinity));
  } catch (err) {
    console.error('[render]', err);
    mount(viewEl, h('div', { class: 'card' }, h('p', { class: 'card__title' }, 'Erreur d’affichage'), h('p', { class: 'card__text' }, String(err.message))));
  }
  mount(tabHost, TabBar(route));

  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      el.value = keep.value;
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(keep.start, keep.end); } catch { /* type sans sélection */ }
    }
  }
  if (scrollTop) window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => { route = parseRoute(); render({ scrollTop: true }); });
window.addEventListener('app:render', () => render());

onSession((s) => {
  const wasActive = session?.state === 'active';
  session = s;

  if (s.state !== 'active') {
    if (wasActive) { unsubStore?.(); unsubStore = null; stopStore(); stopTimer(); showTimer(false); }
    viewEl = null;
    switch (s.state) {
      case 'loading':    mount(root, LoadingView()); break;
      case 'signed-out': mount(root, LoginView()); break;
      case 'disabled':   mount(root, DisabledView()); break;
      case 'error':      mount(root, ErrorView(s.error)); break;
    }
    return;
  }

  if (!wasActive) {
    startStore(s.user.uid);
    unsubStore = subscribe(() => render());
    mountShell();
  }
  route = parseRoute();
  render({ scrollTop: true });
});

// Service worker : cache de l'app pour un démarrage rapide et hors ligne.
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[sw]', err));
}
