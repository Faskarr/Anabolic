/**
 * Point d'entrée de l'app : session → store → routeur → vues.
 *
 * Routes (hash) :
 *   #/home  #/training  #/diet  #/protocol
 *   #/contact (messagerie)  #/contact/coach  #/friends/<id>  #/admin/messages
 *   #/diet/calc (calculateur)
 *   #/me  #/me/weight  #/me/share  #/me/check  #/me/goals
 *   #/admin  #/admin/user/<uid>  #/admin/conv/<uid>  #/admin/library  (administrateur uniquement)
 *
 * Chaque vue est une fonction (session, param?) => Node[] ; elle est ré-exécutée
 * à chaque changement du store (temps réel) ou de route.
 */
// En premier : le splash doit s'afficher avant l'initialisation de Firebase.
import { hideSplash, watchResume, splashOutAt } from './ui/splash.js';
import './ui/theme.js';
import { mount, h } from './lib/dom.js';
import { onSession } from './auth.js';
import { state, startStore, stopStore, subscribe, startAdminFeeds, unreadCount } from './store.js';
import { TabBar } from './ui/tabbar.js';
import { showTimer, stopTimer } from './ui/timer.js';
import { LoginView } from './views/login.js';
import { DisabledView } from './views/disabled.js';
import { FoundationView } from './views/foundation.js';
import { HomeView } from './views/home.js';
import { TrainingView } from './views/training.js';
import { DietView } from './views/diet.js';
import { DietCalcView } from './views/diet-calc.js';
import { ProtocolView } from './views/protocol.js';
import { MeView } from './views/me.js';
import { WeightView } from './views/weight.js';
import { ShareView } from './views/share.js';
import { ContactView, leaveContact } from './views/contact.js';
import { AdminInboxView, AdminConversationView, leaveAdminConversation } from './views/admin-messages.js';
import { AdminHomeView, AdminUserView, leaveAdminUser } from './views/admin.js';
import { MessagesHubView, FriendChatView, leaveFriendChat } from './views/messages-hub.js';
import { GoalsView } from './views/goals.js';
import { AdminLibraryView } from './views/admin-library.js';

// Version des fichiers statiques (à incrémenter à chaque déploiement visuel).
export const ASSET_VERSION = '0.9.0';

/**
 * Garde-fou : si un ancien index.html (mis en cache par iOS) est servi avec le
 * nouveau JavaScript, les feuilles de style récentes manquent. On les ajoute.
 */
function ensureStyles() {
  for (const name of ['splash', 'tokens', 'base', 'components', 'app']) {
    if (!document.querySelector(`link[href^="/css/${name}.css"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `/css/${name}.css?v=${ASSET_VERSION}`;
      document.head.appendChild(link);
    }
  }
}
ensureStyles();

// Safari (onglet) vs app installée sur l'écran d'accueil : dans Safari, la barre
// d'adresse occupe déjà le bas de l'écran → pas de marge de sécurité en plus.
const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
document.documentElement.classList.toggle('in-browser', !standalone);

/**
 * Table de routage. `admin: true` = réservé à l'administrateur.
 * `leave` = nettoyage quand on quitte l'écran (abonnements temps réel).
 */
const ROUTES = {
  home:           { view: HomeView },
  training:       { view: TrainingView },
  diet:           { view: DietView },
  'diet/calc':    { view: DietCalcView },
  protocol:       { view: ProtocolView },
  me:             { view: MeView },
  'me/weight':    { view: WeightView },
  'me/share':     { view: ShareView },
  goals:          { view: GoalsView },
  'me/goals':     { view: GoalsView },   // ancien lien
  // Contact = messagerie : coach (ou messages des utilisateurs pour l'admin) + amis.
  contact:          { view: MessagesHubView },
  'contact/coach':  { view: ContactView, leave: leaveContact, chat: true },
  friends:          { view: FriendChatView, param: true, leave: leaveFriendChat, chat: true },
  'admin/messages': { view: AdminInboxView, admin: true },
  'me/check':     { view: FoundationView },
  admin:          { view: AdminHomeView, admin: true },
  'admin/library': { view: AdminLibraryView, admin: true },
  'admin/user':   { view: AdminUserView, admin: true, param: true, leave: leaveAdminUser },
  'admin/conv':   { view: AdminConversationView, admin: true, param: true, leave: leaveAdminConversation, chat: true },
};

const root = document.getElementById('app');

/**
 * Entrée des pages : les blocs glissent en place l'un après l'autre.
 * Les vues sont re-rendues à chaque mise à jour temps réel ; pour qu'un rendu
 * en plein milieu ne coupe pas l'animation, chaque rendu recalcule le délai
 * de chaque bloc par rapport à l'instant de départ (délai négatif = reprise).
 */
const ENTER = { STEP_MS: 90, DURATION_MS: 700 };
let enter = { pending: true, at: 0 };

function applyEnter() {
  const def = ROUTES[current.key];
  // Toutes les pages, sauf les conversations (défilement en bas + zone de saisie fixe).
  if (def.chat || !state.ready) { viewEl.classList.remove('view--enter'); return; }
  const now = performance.now();
  if (enter.pending) {
    // Départ juste après l'effacement du splash (ou tout de suite s'il est parti).
    enter = { pending: false, at: Math.max(now, splashOutAt() + 120) };
  }
  const kids = [...viewEl.children];
  const total = enter.at + kids.length * ENTER.STEP_MS + ENTER.DURATION_MS;
  if (now > total) { viewEl.classList.remove('view--enter'); return; }
  viewEl.classList.add('view--enter');
  kids.forEach((el, i) => { el.style.animationDelay = `${Math.round(enter.at - now + i * ENTER.STEP_MS)}ms`; });
}
let session = null;
let current = { key: 'home', param: null };
let viewEl = null;
let tabHost = null;
let unsubStore = null;

/** '#/admin/conv/abc' → { key: 'admin/conv', param: 'abc' } */
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  for (let n = parts.length; n > 0; n -= 1) {
    const key = parts.slice(0, n).join('/');
    const def = ROUTES[key];
    if (!def) continue;
    const rest = parts.slice(n);
    if (def.param && rest.length === 1) return { key, param: decodeURIComponent(rest[0]) };
    if (!def.param && rest.length === 0) return { key, param: null };
  }
  return { key: 'home', param: null };
}

function LoadingView() {
  return h('main', { class: 'screen', 'aria-busy': 'true' });
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

  const def = ROUTES[current.key];
  if (def.admin && !session.isAdmin) { location.hash = '#/home'; return; }

  const active = document.activeElement;
  const keep = active && active.id && viewEl.contains(active) && 'value' in active
    ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd }
    : null;

  showTimer(current.key === 'training');
  document.documentElement.classList.toggle('route-chat', Boolean(def.chat || def.chatIf?.(session)));
  try {
    mount(viewEl, [def.view(session, current.param)].flat(Infinity));
  } catch (err) {
    console.error('[render]', err);
    mount(viewEl, h('div', { class: 'card' }, h('p', { class: 'card__title' }, 'Erreur d’affichage'), h('p', { class: 'card__text' }, String(err.message))));
  }
  applyEnter();
  mount(tabHost, TabBar(current.key, { contact: unreadCount() }));

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

window.addEventListener('hashchange', () => {
  const next = parseRoute();
  const prev = ROUTES[current.key];
  if (prev?.leave && (next.key !== current.key || next.param !== current.param)) prev.leave();
  current = next;
  enter = { pending: true, at: 0 };
  render({ scrollTop: true });
});
window.addEventListener('app:render', () => render());

onSession((s) => {
  const wasActive = session?.state === 'active';
  session = s;

  // Dès que l'état de session est connu, l'animation d'ouverture s'efface.
  if (s.state !== 'loading') hideSplash();

  if (s.state !== 'active') {
    if (wasActive) {
      ROUTES[current.key]?.leave?.();
      unsubStore?.(); unsubStore = null; stopStore(); stopTimer(); showTimer(false);
    }
    viewEl = null;
    document.documentElement.classList.remove('route-chat', 'kb-open');
    switch (s.state) {
      case 'loading':    mount(root, LoadingView()); break;
      case 'signed-out': mount(root, LoginView()); break;
      case 'disabled':   mount(root, DisabledView()); break;
      case 'error':      mount(root, ErrorView(s.error)); break;
    }
    return;
  }

  if (!wasActive) {
    enter = { pending: true, at: 0 };
    startStore(s.user.uid, s.user);
    if (s.isAdmin) startAdminFeeds();
    unsubStore = subscribe(() => render());
    mountShell();
  }
  current = parseRoute();
  render({ scrollTop: true });
});

// Retour dans l'app après une longue absence : animation rejouée + accueil.
watchResume(() => {
  ROUTES[current.key]?.leave?.();
  enter = { pending: true, at: 0 };
  if (location.hash !== '#/home') location.hash = '#/home';
  else render({ scrollTop: true }); // déjà sur l'accueil : rejoue l'entrée des widgets
});

// Service worker : cache de l'app pour un démarrage rapide et hors ligne.
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[sw]', err));
}
