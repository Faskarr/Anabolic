/**
 * ADMIN — lecture et gestion des utilisateurs.
 *
 * Tout est protégé côté serveur par firestore.rules (isAdmin()) :
 *  • lecture : users/*, users/{uid}/data/*, weeks/*, inbox/*
 *  • écriture : users/{uid}.status, data/{workouts|diet|protocol|profiles}, inbox (création)
 * Un non-admin qui appellerait ces fonctions recevrait « permission-denied ».
 */
import { db, fs } from '../firebase.js';
import { weekKey } from '../lib/dates.js';
import { uid as newId } from '../lib/ids.js';
import { toast } from '../ui/toast.js';

const {
  doc, collection, query, orderBy, limit, onSnapshot, setDoc, updateDoc, deleteField, serverTimestamp, writeBatch,
} = fs;

const DATA_KEY = { workout: 'workouts', diet: 'diet', protocol: 'protocol' };
const DOCS = ['profiles', 'workouts', 'diet', 'protocol', 'weights', 'exlogs', 'counter'];

const fail = (label) => (err) => {
  console.error(`[admin] ${label}`, err);
  toast(`Action impossible (${label}) : ${err.code || err.message}`, { type: 'error' });
  throw err;
};

/** Tous les utilisateurs (les plus récents d'abord). */
export function watchUsers(cb) {
  const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(500));
  return onSnapshot(q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))),
    (err) => { console.error('[admin] users', err); cb([]); });
}

/**
 * Toutes les données d'un utilisateur, en temps réel.
 * cb reçoit { profiles, workouts, diet, protocol, weights, exlogs, counterBase, week, ready }.
 */
export function watchUserData(uid, cb) {
  const data = {
    profiles: null, workouts: {}, diet: {}, protocol: {}, weights: [], exlogs: {}, counterBase: 0, week: {}, ready: false,
  };
  let pending = DOCS.length + 1;
  const done = () => { if (pending > 0) pending -= 1; data.ready = pending === 0; cb({ ...data }); };

  const apply = {
    profiles: (d) => { data.profiles = d || {}; },
    workouts: (d) => { data.workouts = d || {}; },
    diet: (d) => { data.diet = d || {}; },
    protocol: (d) => { data.protocol = d || {}; },
    weights: (d) => { data.weights = Array.isArray(d?.log) ? d.log : []; },
    exlogs: (d) => { data.exlogs = d?.logs || {}; },
    counter: (d) => { data.counterBase = Number(d?.base) || 0; },
  };
  const unsubs = DOCS.map((name) => {
    let first = true;
    return onSnapshot(doc(db, 'users', uid, 'data', name), (snap) => {
      apply[name](snap.exists() ? snap.data() : null);
      if (first) { first = false; done(); } else cb({ ...data });
    }, (err) => { console.warn('[admin] data', name, err); if (first) { first = false; done(); } });
  });
  let firstWeek = true;
  unsubs.push(onSnapshot(doc(db, 'users', uid, 'weeks', weekKey()), (snap) => {
    data.week = snap.exists() ? snap.data() : {};
    if (firstWeek) { firstWeek = false; done(); } else cb({ ...data });
  }, () => { if (firstWeek) { firstWeek = false; done(); } }));

  return () => unsubs.forEach((u) => u());
}

/** Envois en attente / traités pour un utilisateur. */
export function watchUserInbox(uid, cb) {
  const q = query(collection(db, 'users', uid, 'inbox'), orderBy('sentAt', 'desc'), limit(30));
  return onSnapshot(q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))),
    () => cb([]));
}

// ── Actions ─────────────────────────────────────────────────────────────

/** Désactive / réactive un compte. Aucune donnée n'est supprimée. */
export function setUserStatus(uid, status) {
  return updateDoc(doc(db, 'users', uid), { status }).catch(fail('statut'));
}

/**
 * Propose un programme / diet / protocole : l'utilisateur l'accepte ou l'ignore
 * depuis son accueil (il garde la main sur ses données).
 */
export function proposeToUser(uid, { type, title, message, payload }) {
  return setDoc(doc(collection(db, 'users', uid, 'inbox')), {
    type, title: String(title || '').slice(0, 80), message: String(message || '').slice(0, 500),
    payload: payload ?? null, status: 'pending', sentAt: serverTimestamp(),
  }).catch(fail('envoi'));
}

/** Retire un envoi pas encore traité. */
export function cancelProposal(uid, itemId) {
  return fs.deleteDoc(doc(db, 'users', uid, 'inbox', itemId)).catch(fail('annulation'));
}

/**
 * Installe DIRECTEMENT un profil chez l'utilisateur et le rend actif.
 * @param {object} profiles  document `profiles` actuel de l'utilisateur
 */
export function installProfileForUser(uid, profiles, cat, name, data) {
  const pid = newId('p');
  const next = structuredClone(profiles || {});
  next[cat] = next[cat]?.list ? next[cat] : { active: null, list: [] };
  next[cat].list.push({ id: pid, name: String(name).slice(0, 60) });
  next[cat].active = pid;
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid, 'data', DATA_KEY[cat]), { [pid]: data }, { mergeFields: [pid] });
  batch.set(doc(db, 'users', uid, 'data', 'profiles'), next);
  return batch.commit().catch(fail('installation'));
}

export function renameUserProfile(uid, profiles, cat, pid, name) {
  const next = structuredClone(profiles);
  const p = next[cat]?.list?.find((x) => x.id === pid);
  if (!p) return Promise.resolve();
  p.name = String(name).slice(0, 60);
  return setDoc(doc(db, 'users', uid, 'data', 'profiles'), next).catch(fail('renommage'));
}

export function setUserActiveProfile(uid, profiles, cat, pid) {
  const next = structuredClone(profiles);
  if (!next[cat]) return Promise.resolve();
  next[cat].active = pid;
  return setDoc(doc(db, 'users', uid, 'data', 'profiles'), next).catch(fail('profil actif'));
}

export function deleteUserProfile(uid, profiles, cat, pid) {
  const next = structuredClone(profiles);
  if (!next[cat]?.list) return Promise.resolve();
  next[cat].list = next[cat].list.filter((x) => x.id !== pid);
  if (next[cat].active === pid) next[cat].active = next[cat].list[0]?.id || null;
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid, 'data', 'profiles'), next);
  batch.set(doc(db, 'users', uid, 'data', DATA_KEY[cat]), { [pid]: deleteField() }, { merge: true });
  return batch.commit().catch(fail('suppression'));
}
