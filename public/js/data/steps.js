/**
 * Nombre de pas : users/{uid}/data/steps
 *   { log: { d20261006: 8432, … }, goal: 10000 }
 *
 * Une PWA ne peut pas lire l'app Santé d'iOS (pas d'accès HealthKit depuis le
 * web). Deux sources :
 *  • saisie manuelle ;
 *  • Raccourci iOS (app Raccourcis) qui lit le total du jour dans Santé et
 *    ouvre  https://anabolic-adc6a.web.app/#/steps?n=8432&d=2026-10-06
 *    → l'app enregistre la valeur (voir `consumeStepsLink`).
 */
import { db, fs } from '../firebase.js';
import { state, emit } from '../store.js';
import { localISODate } from '../lib/dates.js';
import { toast } from '../ui/toast.js';

const { doc, setDoc } = fs;

export const STEPS_DEFAULT_GOAL = 10000;
const keyOf = (iso) => `d${iso.replace(/-/g, '')}`;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeSteps(raw) {
  const log = {};
  const min = keyOf(localISODate(new Date(Date.now() - 120 * 86400000)));
  for (const [k, v] of Object.entries(raw?.log || {})) {
    const n = Math.round(Number(v));
    if (/^d\d{8}$/.test(k) && k >= min && n >= 0 && n <= 200000) log[k] = n;
  }
  const goal = Math.round(Number(raw?.goal));
  return { log, goal: goal >= 1000 && goal <= 100000 ? goal : STEPS_DEFAULT_GOAL };
}

export const stepsOn = (iso, s = state.steps) => s?.log?.[keyOf(iso)] ?? null;

/** Total et moyenne de la semaine en cours (lundi → aujourd'hui) + 7 jours. */
export function stepsSummary(s = state.steps, now = new Date()) {
  const today = localISODate(now);
  const wd = ((now.getDay() + 6) % 7);                // 0 = lundi
  let week = 0; let days = 0;
  for (let i = 0; i <= wd; i += 1) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const v = stepsOn(localISODate(d), s);
    if (v != null) { week += v; days += 1; }
  }
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (6 - i));
    const iso = localISODate(d);
    return { iso, day: d.toLocaleDateString('fr-FR', { weekday: 'narrow' }), n: stepsOn(iso, s) };
  });
  return { today: stepsOn(today, s), week, avg: days ? Math.round(week / days) : 0, days, goal: s?.goal || STEPS_DEFAULT_GOAL, last7 };
}

/** Enregistre le total d'une journée (remplace la valeur précédente). */
export function setSteps(n, iso = localISODate()) {
  const v = Math.max(0, Math.min(200000, Math.round(n)));
  const k = keyOf(iso);
  state.steps = { ...state.steps, log: { ...state.steps.log, [k]: v } };
  emit();
  return setDoc(doc(db, 'users', state.uid, 'data', 'steps'), { log: { [k]: v } }, { mergeFields: [`log.${k}`] })
    .catch((err) => { console.error('[steps]', err); toast('Échec de l’enregistrement des pas.', { type: 'error' }); });
}

export function setStepsGoal(goal) {
  state.steps = { ...state.steps, goal };
  emit();
  return setDoc(doc(db, 'users', state.uid, 'data', 'steps'), { goal }, { mergeFields: ['goal'] }).catch(() => {});
}

/**
 * Lien ouvert par le Raccourci : #/steps?n=8432[&d=YYYY-MM-DD]
 * @returns {boolean} true si le lien a été traité
 */
export function consumeStepsLink() {
  const m = location.hash.match(/^#\/steps\?(.*)$/);
  if (!m) return false;
  const p = new URLSearchParams(m[1]);
  // « 8432 », « 8 432 », « 8432,0 » ou « 8432.0 » (format du Raccourci selon la langue).
  const n = Math.round(parseFloat(String(p.get('n') || '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')));
  const d = p.get('d');
  const iso = d && ISO_RE.test(d) ? d : localISODate();
  history.replaceState(null, '', '#/home');
  if (Number.isFinite(n) && n >= 0 && n <= 200000) {
    setSteps(n, iso);
    toast(`${n.toLocaleString('fr-FR')} pas enregistrés${iso === localISODate() ? ' aujourd’hui' : ''} ✓`);
  } else {
    toast('Lien de pas invalide.', { type: 'error' });
  }
  return true;
}
