/**
 * Store central — état de l'utilisateur connecté, synchronisé en TEMPS RÉEL
 * avec Firestore (onSnapshot sur chaque document).
 *
 * Remplace `window.D` de l'ancienne app. Différences :
 *  • tous les documents sont écoutés en temps réel (plus d'écrasement
 *    silencieux entre deux appareils ouverts) ;
 *  • les vues s'abonnent via `subscribe()` et se re-rendent automatiquement ;
 *  • `state.ready` indique quand les premières données sont disponibles.
 *
 * Les chemins Firestore sont IDENTIQUES à l'ancienne app :
 *   users/{uid}/data/{workouts|diet|protocol|profiles|weights|exlogs|counter}
 *   users/{uid}/weeks/{YYYYMMDD}
 */
import { db, fs } from './firebase.js';
import { weekKey } from './lib/dates.js';
import { watchConversation, watchAllConversations, unreadForUser, unreadForAdmin } from './data/messages.js';
import { watchPendingInbox } from './data/inbox.js';
import { watchUsers } from './data/admin.js';
import { watchFriendships, watchActivity, unreadFriend, friendOf, isAccepted, isIncoming } from './data/friends.js';
import { watchPosts } from './data/posts.js';
import { emptyGoals, normalizeGoals } from './data/goals.js';
import { normalizeSteps } from './data/steps.js';

const { doc, onSnapshot } = fs;

/** Catégories de profils (clé interne → clé du document `profiles`). */
export const CATS = /** @type {const} */ (['workout', 'diet', 'protocol']);

export const emptyProfiles = () => ({
  workout:  { active: null, list: [] },
  diet:     { active: null, list: [] },
  protocol: { active: null, list: [] },
});

export const state = {
  uid: null,
  ready: false,
  profiles: emptyProfiles(),
  workouts: {},     // { [pid]: { sessions: [...] } }
  diet: {},         // { [pid]: { objective, macros, meals } }
  protocol: {},     // { [pid]: { days: [...] } }
  weights: [],      // [{ date: 'YYYY-MM-DD', kg }]
  exlogs: {},       // { [exerciseId]: [{ ts, d, w, r }] }
  counterBase: 0,
  week: {},         // cases cochées de la semaine courante
  goals: emptyGoals(),                 // objectifs & habitudes { items, done }
  steps: { log: {}, goal: 10000 },     // nombre de pas { log: { dYYYYMMDD: n }, goal }
  home: { order: null, hidden: [] },   // personnalisation des widgets de l'accueil
  weekKey: weekKey(),
  conversation: null,        // ma conversation avec l'admin (métadonnées)
  inbox: [],                 // envois du coach en attente
  me: null,                  // { uid, displayName, email } de l'utilisateur connecté
  friendships: [],           // mes amitiés (avec aperçu du dernier message)
  friendActivity: {},        // { [uidAmi]: { name, day, sessionName } }
  posts: {},                 // { [uid]: [records partagés] } — mes amis + moi
  adminUsers: null,          // ADMIN : tous les utilisateurs (null = non chargé)
  adminConversations: null,  // ADMIN : toutes les conversations (null = non chargé)
  error: null,
};

// ── Abonnements ─────────────────────────────────────────────────────────
const listeners = new Set();
let emitQueued = false;

/** S'abonne aux changements. Renvoie la fonction de désabonnement. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Notifie les abonnés (regroupé sur une frame pour éviter les rendus en rafale). */
export function emit() {
  if (emitQueued) return;
  emitQueued = true;
  requestAnimationFrame(() => {
    emitQueued = false;
    for (const fn of listeners) {
      try { fn(state); } catch (err) { console.error('[store] listener', err); }
    }
  });
}

// ── Synchronisation Firestore ───────────────────────────────────────────
let unsubs = [];
let pending = 0;

/** Normalise le document `profiles` (tolère les anciennes données partielles). */
function normalizeProfiles(raw) {
  const out = emptyProfiles();
  for (const cat of CATS) {
    const p = raw?.[cat];
    if (p && Array.isArray(p.list)) out[cat] = { active: p.active ?? null, list: p.list };
  }
  return out;
}

const DOC_HANDLERS = {
  workouts: (d) => { state.workouts = d || {}; },
  diet:     (d) => { state.diet = d || {}; },
  protocol: (d) => { state.protocol = d || {}; },
  profiles: (d) => { state.profiles = normalizeProfiles(d); },
  weights:  (d) => { state.weights = Array.isArray(d?.log) ? d.log : []; },
  exlogs:   (d) => { state.exlogs = d?.logs || {}; },
  counter:  (d) => { state.counterBase = Number(d?.base) || 0; },
  goals:    (d) => { state.goals = normalizeGoals(d); },
  steps:    (d) => { state.steps = normalizeSteps(d); },
  home:     (d) => {
    state.home = {
      order: Array.isArray(d?.order) ? d.order.filter((x) => typeof x === 'string').slice(0, 30) : null,
      hidden: Array.isArray(d?.hidden) ? d.hidden.filter((x) => typeof x === 'string').slice(0, 30) : [],
    };
  },
};

function listen(ref, apply) {
  pending += 1;
  let first = true;
  const unsub = onSnapshot(ref,
    (snap) => {
      apply(snap.exists() ? snap.data() : null);
      if (first) { first = false; pending -= 1; if (pending === 0) state.ready = true; }
      emit();
    },
    (err) => {
      console.error('[store] snapshot', ref.path, err);
      state.error = err;
      if (first) { first = false; pending -= 1; if (pending === 0) state.ready = true; }
      emit();
    });
  unsubs.push(unsub);
}

function listenWeek() {
  state.weekKey = weekKey();
  listen(doc(db, 'users', state.uid, 'weeks', state.weekKey), (d) => { state.week = d || {}; });
}

/** Démarre la synchro pour un utilisateur. */
const activityUnsubs = new Map();

/**
 * Abonne/désabonne l'activité et les records de chaque ami (et mes propres
 * records) quand la liste d'amis change.
 */
function syncFriendActivity() {
  const friends = new Set(state.friendships.filter(isAccepted).map((f) => friendOf(f, state.uid)));
  const wanted = new Set([...friends, state.uid]);
  for (const [uid, unsub] of activityUnsubs) {
    if (!wanted.has(uid)) {
      unsub(); activityUnsubs.delete(uid);
      delete state.friendActivity[uid]; delete state.posts[uid];
    }
  }
  for (const uid of wanted) {
    if (activityUnsubs.has(uid)) continue;
    const subs = [watchPosts(uid, (list) => { state.posts = { ...state.posts, [uid]: list }; emit(); })];
    if (uid !== state.uid) {
      subs.push(watchActivity(uid, (a) => { state.friendActivity = { ...state.friendActivity, [uid]: a }; emit(); }));
    }
    activityUnsubs.set(uid, () => subs.forEach((u) => u()));
  }
}

export function startStore(uid, user) {
  stopStore();
  state.uid = uid;
  state.me = user ? { uid, displayName: user.displayName, email: user.email } : { uid };
  state.ready = false;
  state.error = null;
  for (const [name, apply] of Object.entries(DOC_HANDLERS)) {
    listen(doc(db, 'users', uid, 'data', name), apply);
  }
  listenWeek();
  unsubs.push(watchConversation(uid, (c) => { state.conversation = c; emit(); updateAppBadge(); }));
  unsubs.push(watchPendingInbox(uid, (items) => { state.inbox = items; emit(); }));
  unsubs.push(watchFriendships(uid, (list) => { state.friendships = list; syncFriendActivity(); emit(); updateAppBadge(); }));
  document.addEventListener('visibilitychange', onVisible);
}

/** ADMIN : écoute toutes les conversations (badge + boîte de réception). */
export function startAdminFeeds() {
  unsubs.push(watchAllConversations((list) => { state.adminConversations = list; emit(); updateAppBadge(); }));
  unsubs.push(watchUsers((list) => { state.adminUsers = list; emit(); }));
}

/** Nombre de non-lus à afficher (badge onglet « Moi » et icône de l'app). */
export function unreadCount() {
  const mine = unreadForUser(state.conversation) ? 1 : 0;
  const admin = (state.adminConversations || []).filter(unreadForAdmin).length;
  const friends = state.friendships.filter((f) => unreadFriend(f, state.uid)).length;
  const requests = state.friendships.filter((f) => isIncoming(f, state.uid)).length;
  return mine + admin + friends + requests;
}

/** Pastille sur l'icône de l'app (iOS 16.4+, app installée sur l'écran d'accueil). */
function updateAppBadge() {
  const n = unreadCount();
  try {
    if (n > 0) navigator.setAppBadge?.(n)?.catch?.(() => {});
    else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch { /* non supporté */ }
}

export function stopStore() {
  unsubs.forEach((u) => u());
  unsubs = [];
  activityUnsubs.forEach((u) => u());
  activityUnsubs.clear();
  pending = 0;
  document.removeEventListener('visibilitychange', onVisible);
  Object.assign(state, {
    uid: null, ready: false, profiles: emptyProfiles(), workouts: {}, diet: {}, protocol: {},
    weights: [], exlogs: {}, counterBase: 0, week: {}, error: null,
    goals: emptyGoals(), home: { order: null, hidden: [] }, steps: { log: {}, goal: 10000 },
    conversation: null, adminConversations: null, inbox: [], adminUsers: null,
    me: null, friendships: [], friendActivity: {}, posts: {},
  });
}

/** Si l'app reste ouverte d'une semaine à l'autre, on bascule sur la nouvelle semaine. */
function onVisible() {
  if (document.visibilityState !== 'visible' || !state.uid) return;
  if (weekKey() !== state.weekKey) {
    const { uid, me } = state;
    startStore(uid, me);
  }
}

// ── Sélecteurs ──────────────────────────────────────────────────────────

/** Id du profil actif d'une catégorie (ou du premier, ou null). */
export function activeProfileId(cat) {
  const p = state.profiles[cat];
  if (!p?.list?.length) return null;
  return p.list.find((x) => x.id === p.active)?.id || p.list[0].id;
}

export function activeProfile(cat) {
  const id = activeProfileId(cat);
  return id ? state.profiles[cat].list.find((x) => x.id === id) : null;
}

const DATA_KEY = { workout: 'workouts', diet: 'diet', protocol: 'protocol' };

/** Données du profil actif, avec valeurs par défaut sûres. */
export function profileData(cat, pid = activeProfileId(cat)) {
  if (!pid) return null;
  const raw = state[DATA_KEY[cat]]?.[pid];
  if (cat === 'workout')  return { sessions: [], ...raw };
  if (cat === 'diet')     return { objective: 0, macros: { p: 0, g: 0, l: 0 }, meals: [], ...raw };
  return { days: [], ...raw };
}

/** Nombre de séances : base manuelle + séances cochées cette semaine. */
export function sessionCount() {
  const done = Object.entries(state.week || {})
    .filter(([k, v]) => k.includes('_sess_') && v?.done).length;
  return (state.counterBase || 0) + done;
}

export const sessionWeekKey = (pid, sid) => `${pid}_sess_${sid}`;
export const injectionWeekKey = (pid, iid) => `${pid}_${iid}`;
