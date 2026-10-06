/**
 * Écritures Firestore — SEUL module (avec auth.js) qui écrit des données.
 *
 * Stratégie :
 *  1. mise à jour locale immédiate de `state` + emit() → UI instantanée ;
 *  2. écriture Firestore en arrière-plan (jamais attendue par l'UI) :
 *     hors ligne, elle est mise en file par le cache persistant et part au
 *     retour du réseau (corrige le bug « modale bloquée hors ligne ») ;
 *  3. en cas d'échec réel (droits, quota), toast d'erreur — plus d'échec silencieux.
 *
 * Granularité : on n'écrit QUE le profil modifié (`mergeFields: [pid]`) au lieu
 * de réécrire tout le document → deux appareils qui modifient deux profils
 * différents ne s'écrasent plus.
 */
import { db, fs } from '../firebase.js';
import { state, emit, CATS, activeProfileId } from '../store.js';
import { localISODate } from '../lib/dates.js';
import { uid as newId } from '../lib/ids.js';
import { toast } from '../ui/toast.js';
import { periodKey, prune as pruneGoals } from './goals.js';

const { doc, setDoc, updateDoc, deleteField, serverTimestamp } = fs;

const DATA_KEY = { workout: 'workouts', diet: 'diet', protocol: 'protocol' };

const dataRef = (name) => doc(db, 'users', state.uid, 'data', name);
const weekRef = () => doc(db, 'users', state.uid, 'weeks', state.weekKey);

/** Lance une écriture sans bloquer l'UI ; signale les échecs. */
function write(promise, label) {
  promise.catch((err) => {
    console.error(`[repo] ${label}`, err);
    toast(`Échec de l'enregistrement (${label}). Vérifie ta connexion.`, { type: 'error' });
  });
}

const clone = (v) => (v == null ? v : structuredClone(v));

// ── Profils ─────────────────────────────────────────────────────────────

function saveProfiles() {
  write(setDoc(dataRef('profiles'), clone(state.profiles)), 'profils');
}

export function setActiveProfile(cat, pid) {
  state.profiles[cat].active = pid;
  emit();
  saveProfiles();
}

/** Crée un profil vide (ou avec des données) et le rend actif. */
export function createProfile(cat, name, data = null) {
  const pid = newId('p');
  state.profiles[cat].list.push({ id: pid, name });
  state.profiles[cat].active = pid;
  if (data) setProfileDataLocal(cat, pid, data);
  emit();
  saveProfiles();
  if (data) persistProfileData(cat, pid);
  return pid;
}

export function renameProfile(cat, pid, name) {
  const p = state.profiles[cat].list.find((x) => x.id === pid);
  if (!p) return;
  p.name = name;
  emit();
  saveProfiles();
}

/**
 * Supprime un profil et ses données. Renvoie une fonction d'annulation
 * (utilisée par le toast « Annuler »).
 */
export function deleteProfile(cat, pid) {
  const prof = state.profiles[cat];
  const index = prof.list.findIndex((x) => x.id === pid);
  if (index < 0) return () => {};
  const removed = prof.list[index];
  const wasActive = prof.active === pid;
  const data = clone(state[DATA_KEY[cat]]?.[pid]);

  prof.list.splice(index, 1);
  if (wasActive) prof.active = prof.list[0]?.id || null;
  if (state[DATA_KEY[cat]]) delete state[DATA_KEY[cat]][pid];
  emit();
  saveProfiles();
  write(setDoc(dataRef(DATA_KEY[cat]), { [pid]: deleteField() }, { merge: true }), 'suppression');

  return function undo() {
    prof.list.splice(index, 0, removed);
    if (wasActive) prof.active = pid;
    if (data) setProfileDataLocal(cat, pid, data);
    emit();
    saveProfiles();
    if (data) persistProfileData(cat, pid);
  };
}

// ── Données d'un profil (programme / diet / protocole) ──────────────────

function setProfileDataLocal(cat, pid, data) {
  const key = DATA_KEY[cat];
  if (!state[key]) state[key] = {};
  state[key][pid] = data;
}

function persistProfileData(cat, pid) {
  const key = DATA_KEY[cat];
  write(
    setDoc(dataRef(key), { [pid]: clone(state[key][pid]) }, { mergeFields: [pid] }),
    { workouts: 'programme', diet: 'diet', protocol: 'protocole' }[key],
  );
}

/**
 * Applique une modification au profil actif d'une catégorie.
 * @param {'workout'|'diet'|'protocol'} cat
 * @param {(draft: object) => void} mutate  modifie une copie des données
 * @returns {() => void} fonction d'annulation
 */
export function updateProfileData(cat, mutate, pid = activeProfileId(cat)) {
  if (!pid) return () => {};
  const key = DATA_KEY[cat];
  const before = clone(state[key]?.[pid]) ?? null;
  const defaults = { workout: { sessions: [] }, diet: { objective: 0, macros: { p: 0, g: 0, l: 0 }, meals: [] }, protocol: { days: [] } }[cat];
  const draft = { ...structuredClone(defaults), ...clone(before) };
  mutate(draft);
  setProfileDataLocal(cat, pid, draft);
  emit();
  persistProfileData(cat, pid);

  return function undo() {
    setProfileDataLocal(cat, pid, before ?? structuredClone(defaults));
    emit();
    persistProfileData(cat, pid);
  };
}

// ── Semaine (cases cochées) ─────────────────────────────────────────────

export function setWeekItem(key, value) {
  state.week = { ...state.week, [key]: value };
  emit();
  write(setDoc(weekRef(), { [key]: value }, { merge: true }), 'semaine');
}

/** Réinitialise TOUTE la semaine (séances + protocole), pas seulement l'écran affiché. */
export function resetWeek() {
  const before = clone(state.week);
  state.week = {};
  emit();
  write(setDoc(weekRef(), {}), 'semaine');
  return function undo() {
    state.week = before;
    emit();
    write(setDoc(weekRef(), clone(before)), 'semaine');
  };
}

// ── Compteur ────────────────────────────────────────────────────────────

export function setCounterBase(base) {
  state.counterBase = Math.max(0, Math.round(base) || 0);
  emit();
  write(setDoc(dataRef('counter'), { base: state.counterBase }), 'compteur');
}

// ── Poids ───────────────────────────────────────────────────────────────

function persistWeights() {
  const log = clone(state.weights);
  write(setDoc(dataRef('weights'), { log }), 'poids');
  // Dénormalisation pour la liste admin (évite de lire tout l'historique).
  const last = log[log.length - 1];
  write(updateDoc(doc(db, 'users', state.uid), {
    lastWeight: last ? last.kg : null,
    lastWeightAt: last ? last.date : null,
  }), 'profil');
}

/** Ajoute ou remplace la pesée d'une date (aujourd'hui par défaut, date LOCALE). */
export function addWeight(kg, date = localISODate()) {
  const log = state.weights.filter((e) => e.date !== date);
  log.push({ date, kg: Math.round(kg * 10) / 10 });
  log.sort((a, b) => a.date.localeCompare(b.date));
  state.weights = log;
  emit();
  persistWeights();
}

export function deleteWeight(date) {
  const before = clone(state.weights);
  state.weights = state.weights.filter((e) => e.date !== date);
  emit();
  persistWeights();
  return () => { state.weights = before; emit(); persistWeights(); };
}

export function clearWeights() {
  const before = clone(state.weights);
  state.weights = [];
  emit();
  persistWeights();
  return () => { state.weights = before; emit(); persistWeights(); };
}

/** Fusionne des pesées importées : les dates existantes sont CONSERVÉES. */
export function mergeWeights(entries) {
  const known = new Set(state.weights.map((e) => e.date));
  const added = entries.filter((e) => !known.has(e.date));
  if (!added.length) return 0;
  state.weights = [...state.weights, ...added].sort((a, b) => a.date.localeCompare(b.date));
  emit();
  persistWeights();
  return added.length;
}

// ── Carnet de charges ───────────────────────────────────────────────────

function persistExlog(eid) {
  const arr = state.exlogs[eid];
  write(
    setDoc(dataRef('exlogs'),
      { logs: { [eid]: arr ? clone(arr) : deleteField() } },
      arr ? { mergeFields: [`logs.${eid}`] } : { merge: true }),
    'carnet');
}

export function addLog(eid, w, r) {
  const arr = [...(state.exlogs[eid] || [])];
  arr.push({ ts: Date.now(), d: localISODate(), w, r });
  state.exlogs = { ...state.exlogs, [eid]: arr };
  emit();
  persistExlog(eid);
}

export function deleteLog(eid, ts) {
  const before = clone(state.exlogs[eid]);
  const arr = (state.exlogs[eid] || []).filter((e) => e.ts !== ts);
  const next = { ...state.exlogs };
  if (arr.length) next[eid] = arr; else delete next[eid];
  state.exlogs = next;
  emit();
  persistExlog(eid);
  return () => { state.exlogs = { ...state.exlogs, [eid]: before }; emit(); persistExlog(eid); };
}

/** Fusionne des entrées importées (dédoublonnage par timestamp). */
export function mergeLogs(logsByExercise) {
  let count = 0;
  const next = { ...state.exlogs };
  for (const [eid, entries] of Object.entries(logsByExercise)) {
    const arr = [...(next[eid] || [])];
    const known = new Set(arr.map((e) => e.ts));
    for (const e of entries) if (!known.has(e.ts)) { arr.push(e); count += 1; }
    arr.sort((a, b) => a.ts - b.ts);
    next[eid] = arr;
  }
  state.exlogs = next;
  emit();
  for (const eid of Object.keys(logsByExercise)) persistExlog(eid);
  return count;
}

/** Id d'exercice déjà utilisé dans un programme existant ? (détection de collision à l'import) */
export function exerciseIdExists(eid) {
  for (const prog of Object.values(state.workouts || {})) {
    for (const s of prog?.sessions || []) {
      if ((s.exercises || []).some((e) => e.id === eid)) return true;
    }
  }
  return false;
}

// ── Objectifs & habitudes ───────────────────────────────────────────────

/**
 * Modifie les objectifs (liste + cases) puis réécrit le document entier
 * (petit : historique élagué). Renvoie une fonction d'annulation.
 */
export function updateGoals(mutate) {
  const before = clone(state.goals);
  const draft = clone(state.goals) || { items: [], done: {} };
  mutate(draft);
  draft.done = pruneGoals(draft.done);
  state.goals = draft;
  emit();
  write(setDoc(dataRef('goals'), clone(draft)), 'objectifs');
  return () => { state.goals = before; emit(); write(setDoc(dataRef('goals'), clone(before)), 'objectifs'); };
}

/** Coche / décoche un objectif pour sa période en cours. */
export function toggleGoal(item, date = new Date()) {
  const key = periodKey(item.period, date);
  updateGoals((g) => {
    const cur = { ...(g.done[key] || {}) };
    if (cur[item.id]) delete cur[item.id]; else cur[item.id] = true;
    g.done[key] = cur;
  });
}

// ── Accueil personnalisé ────────────────────────────────────────────────

export function updateHome(next) {
  state.home = { order: next.order, hidden: next.hidden };
  emit();
  write(setDoc(dataRef('home'), clone(state.home)), 'accueil');
}

export { CATS };
