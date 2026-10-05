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
  weekKey: weekKey(),
  conversation: null,        // ma conversation avec l'admin (métadonnées)
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
export function startStore(uid) {
  stopStore();
  state.uid = uid;
  state.ready = false;
  state.error = null;
  for (const [name, apply] of Object.entries(DOC_HANDLERS)) {
    listen(doc(db, 'users', uid, 'data', name), apply);
  }
  listenWeek();
  unsubs.push(watchConversation(uid, (c) => { state.conversation = c; emit(); updateAppBadge(); }));
  document.addEventListener('visibilitychange', onVisible);
}

/** ADMIN : écoute toutes les conversations (badge + boîte de réception). */
export function startAdminFeeds() {
  unsubs.push(watchAllConversations((list) => { state.adminConversations = list; emit(); updateAppBadge(); }));
}

/** Nombre de non-lus à afficher (badge onglet « Moi » et icône de l'app). */
export function unreadCount() {
  const mine = unreadForUser(state.conversation) ? 1 : 0;
  const admin = (state.adminConversations || []).filter(unreadForAdmin).length;
  return mine + admin;
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
  pending = 0;
  document.removeEventListener('visibilitychange', onVisible);
  Object.assign(state, {
    uid: null, ready: false, profiles: emptyProfiles(), workouts: {}, diet: {}, protocol: {},
    weights: [], exlogs: {}, counterBase: 0, week: {}, error: null,
    conversation: null, adminConversations: null,
  });
}

/** Si l'app reste ouverte d'une semaine à l'autre, on bascule sur la nouvelle semaine. */
function onVisible() {
  if (document.visibilityState !== 'visible' || !state.uid) return;
  if (weekKey() !== state.weekKey) {
    const uid = state.uid;
    startStore(uid);
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
