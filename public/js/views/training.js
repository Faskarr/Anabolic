/**
 * Entraînement : profils, séances (avec jours de la semaine), exercices,
 * séance faite cette semaine, minuteur, carnet de charges.
 */
import { h } from '../lib/dom.js';
import { uid } from '../lib/ids.js';
import { formatWeekdays, formatShortDate, isoWeekday, frNum } from '../lib/dates.js';
import {
  state, activeProfileId, profileData, sessionCount, sessionWeekKey, subscribe,
} from '../store.js';
import {
  updateProfileData, setWeekItem, setCounterBase, addLog, deleteLog,
} from '../data/repo.js';
import { PageHeader, ProfileBar, NoProfile, Empty, Skeleton, IconButton, SectionTitle } from '../ui/layout.js';
import { formSheet, confirmSheet, actionSheet, openSheet } from '../ui/sheet.js';
import { undoToast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { lineChart } from '../ui/chart.js';
import { startTimer, parseRest, showTimer } from '../ui/timer.js';

const CAT = 'workout';

/** Séance sélectionnée (mémorisée entre deux rendus). */
let selectedSid = null;

/** Permet à l'accueil d'ouvrir directement une séance. */
export function selectSession(sid) { selectedSid = sid; }

// 1RM estimé — formule d'Epley (identique à l'ancienne app).
export const est1RM = (w, r) => (r <= 1 ? w : w * (1 + r / 30));

// ── Séances ─────────────────────────────────────────────────────────────

async function editSession(session) {
  const r = await formSheet({
    title: session ? 'Modifier la séance' : 'Nouvelle séance',
    subtitle: session ? null : 'Ex. Push, Pull, Legs, Full Body…',
    fields: [
      { name: 'name', label: 'Nom', value: session?.name, required: true, maxlength: 60, placeholder: 'Push' },
      { name: 'weekdays', type: 'weekdays', label: 'Jours prévus', value: session?.weekdays,
        hint: "Utilisé par l'accueil pour afficher la séance du jour." },
    ],
    submitLabel: session ? 'Enregistrer' : 'Créer',
    deleteLabel: session ? 'Supprimer la séance' : null,
  });
  if (!r) return;

  if (r.action === 'delete') { await deleteSession(session); return; }

  const { name, weekdays } = r.values;
  if (session) {
    updateProfileData(CAT, (d) => {
      const s = d.sessions.find((x) => x.id === session.id);
      if (s) { s.name = name; s.weekdays = weekdays.length ? weekdays : null; }
    });
  } else {
    const id = uid('ses');
    updateProfileData(CAT, (d) => {
      d.sessions.push({ id, name, ...(weekdays.length ? { weekdays } : {}), exercises: [] });
    });
    selectedSid = id;
  }
}

async function deleteSession(session) {
  const ok = await confirmSheet({
    title: `Supprimer « ${session.name} » ?`,
    message: 'La séance et ses exercices seront supprimés. Le carnet de charges est conservé.',
  });
  if (!ok) return;
  const undo = updateProfileData(CAT, (d) => { d.sessions = d.sessions.filter((s) => s.id !== session.id); });
  if (selectedSid === session.id) selectedSid = null;
  undoToast(`« ${session.name} » supprimée`, undo);
}

// ── Exercices ───────────────────────────────────────────────────────────

async function editExercise(session, exercise) {
  const r = await formSheet({
    title: exercise ? "Modifier l'exercice" : 'Nouvel exercice',
    fields: [
      { name: 'n', label: 'Nom', value: exercise?.n, required: true, placeholder: 'Développé couché barre' },
      { type: 'row', fields: [
        { name: 's', label: 'Séries × reps', value: exercise?.s === '—' ? '' : exercise?.s, placeholder: '4×6–8', maxlength: 40 },
        { name: 'r', label: 'Repos', value: exercise?.r === '—' ? '' : exercise?.r, placeholder: "2'30", maxlength: 20 },
      ] },
      { name: 'no', label: 'Note', value: exercise?.no, placeholder: 'Charge lourde, tempo 3-1-1…', maxlength: 300 },
    ],
    deleteLabel: exercise ? "Supprimer l'exercice" : null,
  });
  if (!r) return;

  if (r.action === 'delete') {
    const undo = updateProfileData(CAT, (d) => {
      const s = d.sessions.find((x) => x.id === session.id);
      if (s) s.exercises = s.exercises.filter((e) => e.id !== exercise.id);
    });
    undoToast(`« ${exercise.n} » supprimé`, undo);
    return;
  }

  const ex = {
    id: exercise?.id || uid('e'),
    n: r.values.n,
    s: r.values.s || '—',
    r: r.values.r || '—',
    no: r.values.no || '',
  };
  updateProfileData(CAT, (d) => {
    const s = d.sessions.find((x) => x.id === session.id);
    if (!s) return;
    s.exercises = s.exercises || [];
    const i = s.exercises.findIndex((e) => e.id === ex.id);
    if (i >= 0) s.exercises[i] = ex; else s.exercises.push(ex);
  });
}

function moveExercise(session, index, delta) {
  updateProfileData(CAT, (d) => {
    const s = d.sessions.find((x) => x.id === session.id);
    const j = index + delta;
    if (!s || j < 0 || j >= s.exercises.length) return;
    [s.exercises[index], s.exercises[j]] = [s.exercises[j], s.exercises[index]];
  });
}

// ── Carnet de charges ───────────────────────────────────────────────────

function openLog(exercise) {
  const eid = exercise.id;
  const weightIn = h('input', { class: 'input input--num', inputmode: 'decimal', placeholder: 'kg', 'aria-label': 'Charge en kg', maxlength: 6 });
  const repsIn = h('input', { class: 'input input--num', inputmode: 'numeric', placeholder: 'reps', 'aria-label': 'Répétitions', maxlength: 4 });
  const content = h('div', { class: 'log' });

  const form = h('form', {
    class: 'log__form', novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      const w = parseFloat(weightIn.value.replace(',', '.'));
      const r = parseInt(repsIn.value, 10);
      if (!(w > 0 && w < 1000) || !(r > 0 && r < 1000)) {
        (w > 0 ? repsIn : weightIn).classList.add('input--invalid');
        return;
      }
      weightIn.classList.remove('input--invalid');
      repsIn.classList.remove('input--invalid');
      addLog(eid, w, r);
      repsIn.value = '';
      repsIn.focus();
    },
  }, weightIn, h('span', { class: 'log__x', 'aria-hidden': 'true' }, '×'), repsIn,
  h('button', { class: 'btn btn--primary', type: 'submit', 'aria-label': 'Ajouter la série' }, icon('plus', 20)));

  function render() {
    const arr = state.exlogs[eid] || [];
    const last = arr.at(-1);
    if (last) {
      weightIn.placeholder = frNum(last.w, last.w % 1 ? 1 : 0);
      repsIn.placeholder = String(last.r);
    }
    if (!arr.length) {
      content.replaceChildren(h('p', { class: 'muted center' }, 'Aucune charge enregistrée. Ajoute ta première série.'));
      return;
    }
    // Meilleur 1RM par jour → progression
    const byDay = {};
    for (const e of arr) byDay[e.d] = Math.max(byDay[e.d] || 0, est1RM(e.w, e.r));
    const days = Object.keys(byDay).sort();
    const best = Math.max(...Object.values(byDay));
    const delta = days.length > 1 ? byDay[days.at(-1)] - byDay[days.at(-2)] : null;

    content.replaceChildren(
      h('div', { class: 'stats' },
        Stat(`${frNum(last.w, last.w % 1 ? 1 : 0)} kg × ${last.r}`, 'Dernière série'),
        Stat(`${frNum(best, 0)} kg`, '1RM estimé max'),
        Stat(delta == null ? '—' : `${delta >= 0 ? '+' : ''}${frNum(delta, 1)}`, 'Δ 1RM', delta > 0 ? 'up' : delta < 0 ? 'down' : '')),
      days.length > 1 ? h('div', { class: 'chart-wrap' },
        lineChart(days.slice(-20).map((d) => ({ label: formatShortDate(d, { day: 'numeric', month: 'short' }), value: byDay[d] })),
          { unit: '', decimals: 0, ariaLabel: '1RM estimé par séance' })) : null,
      h('ul', { class: 'list' }, [...arr].reverse().slice(0, 60).map((e) => h('li', { class: 'list__row' },
        h('span', { class: 'list__meta' }, formatShortDate(e.d, { day: 'numeric', month: 'short' })),
        h('span', { class: 'list__main' }, `${frNum(e.w, e.w % 1 ? 1 : 0)} kg × ${e.r}`),
        h('span', { class: 'list__meta' }, `1RM ${frNum(est1RM(e.w, e.r), 0)}`),
        IconButton('x', 'Supprimer cette série', () => undoToast('Série supprimée', deleteLog(eid, e.ts)), 'icon-btn--ghost')))),
    );
  }

  render();
  const unsub = subscribe(render);
  openSheet({
    title: exercise.n,
    subtitle: [exercise.s !== '—' && exercise.s, exercise.r !== '—' && `repos ${exercise.r}`].filter(Boolean).join(' · ') || 'Carnet de charges',
    body: h('div', {}, form, content),
    onClose: unsub,
  });
}

function Stat(value, label, tone = '') {
  return h('div', { class: `stat${tone ? ` stat--${tone}` : ''}` },
    h('span', { class: 'stat__value' }, value), h('span', { class: 'stat__label' }, label));
}

// ── Compteur ────────────────────────────────────────────────────────────

async function editCounter() {
  const r = await formSheet({
    title: 'Compteur de séances',
    subtitle: 'Point de départ (les séances cochées chaque semaine s’y ajoutent).',
    fields: [{ name: 'base', label: 'Séances déjà effectuées', type: 'number', integer: true, min: 0, max: 100000, value: state.counterBase }],
  });
  if (r?.values) setCounterBase(r.values.base ?? 0);
}

// ── Vue ─────────────────────────────────────────────────────────────────

function ExerciseCard(session, ex, index, total) {
  const logs = state.exlogs[ex.id] || [];
  const last = logs.at(-1);
  const restSec = parseRest(ex.r);

  return h('article', { class: 'exercise' },
    h('button', { class: 'exercise__main', type: 'button', 'aria-label': `Modifier ${ex.n}`, onclick: () => editExercise(session, ex) },
      h('span', { class: 'exercise__index' }, String(index + 1).padStart(2, '0')),
      h('span', { class: 'exercise__body' },
        h('span', { class: 'exercise__name' }, ex.n),
        ex.no ? h('span', { class: 'exercise__note' }, ex.no) : null),
      h('span', { class: 'exercise__sets' },
        h('span', { class: 'exercise__setsval' }, ex.s),
        ex.r && ex.r !== '—' ? h('span', { class: 'exercise__rest' }, ex.r) : null)),
    h('div', { class: 'exercise__actions' },
      h('button', { class: 'pill-btn', type: 'button', onclick: () => openLog(ex) },
        icon('chart', 16), last ? `${frNum(last.w, last.w % 1 ? 1 : 0)} kg × ${last.r}` : 'Charges'),
      h('button', {
        class: 'pill-btn', type: 'button', 'aria-label': `Lancer le repos ${ex.r}`,
        onclick: () => (restSec ? startTimer(restSec) : startTimer(120)),
      }, icon('timer', 16), restSec ? ex.r : 'Repos'),
      h('span', { class: 'spacer' }),
      index > 0 ? IconButton('back', 'Monter', () => moveExercise(session, index, -1), 'icon-btn--ghost rot-90') : null,
      index < total - 1 ? IconButton('chevron', 'Descendre', () => moveExercise(session, index, 1), 'icon-btn--ghost rot-90') : null));
}

export function TrainingView() {
  showTimer(true);
  const header = PageHeader({
    eyebrow: 'Programme',
    title: 'Entraînement',
    trailing: h('button', { class: 'counter', type: 'button', onclick: editCounter, 'aria-label': 'Modifier le compteur de séances' },
      h('span', { class: 'counter__value' }, String(sessionCount())),
      h('span', { class: 'counter__label' }, 'séances')),
  });

  if (!state.ready) return [header, Skeleton(4)];
  const pid = activeProfileId(CAT);
  if (!pid) return [header, NoProfile(CAT, 'dumbbell')];

  const data = profileData(CAT);
  const sessions = data.sessions || [];
  if (!sessions.some((s) => s.id === selectedSid)) {
    const today = isoWeekday();
    selectedSid = (sessions.find((s) => s.weekdays?.includes(today)) || sessions[0])?.id || null;
  }
  const session = sessions.find((s) => s.id === selectedSid);

  const tabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Séances' },
    sessions.map((s) => h('button', {
      class: `segment${s.id === selectedSid ? ' segment--on' : ''}`, type: 'button', role: 'tab',
      'aria-selected': String(s.id === selectedSid),
      onclick: () => { selectedSid = s.id; window.dispatchEvent(new Event('app:render')); },
    }, s.name)),
    h('button', { class: 'segment segment--add', type: 'button', 'aria-label': 'Nouvelle séance', onclick: () => editSession(null) }, icon('plus', 18)));

  if (!session) {
    return [header, ProfileBar(CAT), Empty({
      iconName: 'dumbbell', title: 'Aucune séance',
      text: 'Crée ta première séance (Push, Full Body, Legs…).',
      actionLabel: 'Créer une séance', onAction: () => editSession(null),
    })];
  }

  const weekKey = sessionWeekKey(pid, session.id);
  const done = state.week[weekKey]?.done;
  const doneTs = state.week[weekKey]?.ts;
  const exercises = session.exercises || [];

  const doneCard = h('button', {
    class: `done-toggle${done ? ' done-toggle--on' : ''}`, type: 'button', 'aria-pressed': String(Boolean(done)),
    onclick: () => setWeekItem(weekKey, done ? { done: false, ts: null } : { done: true, ts: Date.now() }),
  },
  h('span', { class: 'done-toggle__box' }, icon('check', 18)),
  h('span', { class: 'done-toggle__text' },
    h('span', { class: 'done-toggle__title' }, done ? 'Séance terminée' : 'Marquer la séance comme faite'),
    h('span', { class: 'done-toggle__sub' }, done && doneTs ? formatShortDate(doneTs) : 'Cette semaine')));

  return [
    header,
    ProfileBar(CAT),
    tabs,
    doneCard,
    SectionTitle(session.name,
      h('div', { class: 'row-gap' },
        session.weekdays?.length ? h('span', { class: 'tag' }, formatWeekdays(session.weekdays)) : null,
        IconButton('more', 'Options de la séance', () => actionSheet({
          title: session.name,
          actions: [
            { label: 'Modifier (nom, jours)', icon: 'edit', onClick: () => editSession(session) },
            { label: 'Supprimer la séance', icon: 'trash', danger: true, onClick: () => deleteSession(session) },
          ],
        }), 'icon-btn--soft'))),
    exercises.length
      ? h('div', { class: 'stack' }, exercises.map((e, i) => ExerciseCard(session, e, i, exercises.length)))
      : Empty({ iconName: 'dumbbell', title: 'Aucun exercice', text: 'Ajoute le premier exercice de cette séance.' }),
    h('button', { class: 'btn btn--ghost btn--block add-btn', type: 'button', onclick: () => editExercise(session, null) },
      icon('plus', 18), 'Ajouter un exercice'),
    h('p', { class: 'hint' }, 'Progression : +2,5 kg ou +1 rep par semaine sur les mouvements principaux.'),
  ];
}
