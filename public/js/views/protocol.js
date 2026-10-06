/**
 * Protocole : profils, jours (rattachés aux jours de la semaine), produits,
 * cochage hebdomadaire, réinitialisation de la semaine.
 */
import { h } from '../lib/dom.js';
import { uid } from '../lib/ids.js';
import { formatWeekdays, isoWeekday, localISODate } from '../lib/dates.js';
import { guessWeekdays } from '../lib/schema.js';
import { state, activeProfileId, profileData, injectionWeekKey } from '../store.js';
import { updateProfileData, setWeekItem, resetWeek } from '../data/repo.js';
import { PageHeader, ProfileBar, NoProfile, Empty, Skeleton, IconButton, SectionTitle } from '../ui/layout.js';
import { parseTimeOfDay, formatMinutes } from '../lib/schedule.js';
import { formSheet, confirmSheet, actionSheet, openSheet } from '../ui/sheet.js';
import { undoToast, toast } from '../ui/toast.js';
import { buildICS, openICS, shareICS } from '../lib/ics.js';
import { icon } from '../ui/icons.js';

const CAT = 'protocol';

/** Jours du protocole actif prévus aujourd'hui (pour l'accueil). */
export function todaysProtocolDays() {
  const today = isoWeekday();
  return (profileData(CAT)?.days || []).filter((d) => effectiveWeekdays(d).includes(today));
}

/** Jours explicites, sinon déduits du nom (« Lundi » → [1]). */
export function effectiveWeekdays(day) {
  return day.weekdays?.length ? day.weekdays : (guessWeekdays(day.name) || []);
}

async function editDay(day) {
  const r = await formSheet({
    title: day ? 'Modifier le jour' : 'Nouveau jour',
    fields: [
      { name: 'name', label: 'Nom', value: day?.name, required: true, maxlength: 60, placeholder: 'Lundi' },
      { name: 'label', label: 'Libellé (optionnel)', value: day?.label, maxlength: 60, placeholder: 'Jour 1 · Matin' },
      { name: 'weekdays', type: 'weekdays', label: 'Jours de la semaine', value: day ? effectiveWeekdays(day) : [],
        hint: "Affiché dans « Protocole du jour » sur l'accueil." },
    ],
    submitLabel: day ? 'Enregistrer' : 'Ajouter',
    deleteLabel: day ? 'Supprimer ce jour' : null,
  });
  if (!r) return;
  if (r.action === 'delete') return deleteDay(day);
  const { name, label, weekdays } = r.values;
  updateProfileData(CAT, (d) => {
    if (day) {
      const x = d.days.find((y) => y.id === day.id);
      if (x) Object.assign(x, { name, label, weekdays: weekdays.length ? weekdays : null });
    } else {
      d.days.push({ id: uid('day'), name, label, ...(weekdays.length ? { weekdays } : {}), injections: [] });
    }
  });
}

async function deleteDay(day) {
  const ok = await confirmSheet({ title: `Supprimer « ${day.name} » ?`, message: 'Le jour et ses produits seront supprimés.' });
  if (!ok) return;
  const undo = updateProfileData(CAT, (d) => { d.days = d.days.filter((x) => x.id !== day.id); });
  undoToast(`« ${day.name} » supprimé`, undo);
}

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const sameDays = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Nom automatique d'un groupe de jours : « Tous les jours », « En semaine »… */
export function daysLabel(wd) {
  if (sameDays(wd, ALL_DAYS)) return 'Tous les jours';
  if (sameDays(wd, [1, 2, 3, 4, 5])) return 'En semaine';
  if (sameDays(wd, [6, 7])) return 'Week-end';
  return formatWeekdays(wd);
}

/** Heure lisible d'un produit (« Matin » → 08:00 ; défaut 09:00). */
const itemMinutes = (item, day) => parseTimeOfDay(item.time) ?? parseTimeOfDay(day?.label) ?? 9 * 60;

/**
 * Ajout / modification d'un produit, SANS notion de « jour » à créer :
 * on choisit les jours de prise, l'app range le produit dans le bon groupe
 * (créé automatiquement, supprimé quand il se vide).
 */
async function editItem(day, item) {
  const wd = day ? effectiveWeekdays(day) : [];
  const knownTime = item ? parseTimeOfDay(item.time) : null;
  const r = await formSheet({
    title: item ? 'Modifier le produit' : 'Ajouter un produit',
    fields: [
      { name: 'name', label: 'Produit', value: item?.name, required: true, placeholder: 'Nom du produit' },
      { name: 'type', label: 'Dose / précision', value: item?.type, placeholder: 'Ex. 2 gélules, 0,5 ml…' },
      { name: 'time', type: 'time', label: 'Heure de prise', value: knownTime != null ? formatMinutes(knownTime) : '',
        hint: item?.time && knownTime == null ? `Actuellement « ${item.time} » — choisis une heure précise si tu veux.` : 'Sert au tri, à l’accueil et aux rappels Calendrier.' },
      { name: 'weekdays', type: 'weekdays', label: 'Jours de prise', value: wd,
        hint: 'Aucun jour coché = tous les jours.' },
    ],
    submitLabel: item ? 'Enregistrer' : 'Ajouter',
    deleteLabel: item ? 'Supprimer' : null,
  });
  if (!r) return;
  if (r.action === 'delete') {
    const undo = updateProfileData(CAT, (d) => {
      const x = d.days.find((y) => y.id === day.id);
      if (x) x.injections = x.injections.filter((i) => i.id !== item.id);
      pruneAutoDays(d);
    });
    undoToast(`« ${item.name} » supprimé`, undo);
    return;
  }
  const v = r.values;
  const days = v.weekdays.length ? v.weekdays : ALL_DAYS;
  // Heure : garde le texte d'origine (« Matin ») si aucune heure n'a été choisie.
  const time = v.time || (knownTime == null ? item?.time || '' : '');
  const next = { id: item?.id || uid('inj'), name: v.name, type: v.type || '', time };

  updateProfileData(CAT, (d) => {
    // 1. Retire le produit de son groupe actuel.
    if (item) for (const x of d.days) x.injections = (x.injections || []).filter((i) => i.id !== next.id);
    // 2. Groupe existant avec exactement ces jours ? (le groupe d'origine en priorité)
    const same = (x) => sameDays(effectiveWeekdays(x), days);
    let target = (day && d.days.find((x) => x.id === day.id && same(x))) || d.days.find(same);
    if (!target) {
      target = { id: uid('day'), name: daysLabel(days), label: '', weekdays: days, auto: true, injections: [] };
      d.days.push(target);
    }
    target.injections = target.injections || [];
    target.injections.push(next);
    pruneAutoDays(d);
  });
}

/** Supprime les groupes créés automatiquement et devenus vides. */
function pruneAutoDays(d) {
  d.days = d.days.filter((x) => !x.auto || (x.injections || []).length);
}

// ── Rappels Calendrier ──────────────────────────────────────────────────

function remindersOf(days) {
  return days.flatMap((day) => (day.injections || []).map((it) => ({
    id: it.id, title: it.name, note: [it.type, 'AnabolicOS · protocole'].filter(Boolean).join(' — '),
    weekdays: effectiveWeekdays(day).length ? effectiveWeekdays(day) : ALL_DAYS,
    minutes: itemMinutes(it, day),
  })));
}

/** Panneau « Rappels » : ajout au Calendrier (tous ou un produit) + mode d'emploi pour les retirer. */
function calendarSheet(days, only = null) {
  const list = remindersOf(days).filter((x) => !only || x.id === only.id);
  if (!list.length) { toast('Ajoute d’abord un produit.', { type: 'error' }); return; }
  const ics = buildICS(list);
  const name = only ? `anabolicos-${only.name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').slice(0, 30)}.ics` : 'anabolicos-rappels.ics';
  openSheet({
    title: only ? `Rappel · ${only.name}` : 'Rappels dans Calendrier',
    subtitle: `${list.length} rappel${list.length > 1 ? 's' : ''} récurrent${list.length > 1 ? 's' : ''}, avec alerte à l’heure de prise.`,
    body: h('div', { class: 'cal-sheet' },
      h('ul', { class: 'cal-list' }, list.map((x) => h('li', {},
        h('span', { class: 'cal-list__time' }, formatMinutes(x.minutes)),
        h('span', { class: 'cal-list__name' }, x.title),
        h('span', { class: 'cal-list__days' }, daysLabel(x.weekdays))))),
      h('div', { class: 'form__actions' },
        h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: () => openICS(ics, name) },
          icon('calendar', 18), 'Ajouter au Calendrier'),
        h('button', {
          class: 'btn btn--ghost btn--block', type: 'button',
          onclick: () => shareICS(ics, name).catch((err) => { if (err?.name !== 'AbortError') toast('Partage impossible.', { type: 'error' }); }),
        }, icon('share', 18), 'Partager le fichier')),
      h('div', { class: 'cal-help' },
        h('p', { class: 'cal-help__title' }, 'Ajouter'),
        h('p', {}, 'Touche « Ajouter au Calendrier », puis « Tout ajouter ». Conseil : choisis un calendrier dédié « AnabolicOS » (à créer dans l’app Calendrier › Calendriers › Ajouter).'),
        h('p', { class: 'cal-help__title' }, 'Modifier ou supprimer'),
        h('p', {}, 'Calendrier › touche un rappel › Supprimer l’événement › « Supprimer tous les événements futurs ». Pour tout retirer d’un coup : supprime le calendrier « AnabolicOS ».'),
        h('p', { class: 'muted small' }, 'Après une modification du protocole, supprime les anciens rappels avant de ré-ajouter, sinon ils seront en double.'))),
  });
}

/**
 * Clé de la case cochée d'un produit.
 *  • jour prévu une seule fois par semaine → clé hebdomadaire (format historique) ;
 *  • jour récurrent (ex. « Quotidien ») → clé par DATE, sinon une prise cochée
 *    lundi resterait cochée toute la semaine.
 */
export function itemKey(pid, day, item, date = localISODate()) {
  return effectiveWeekdays(day).length > 1
    ? `${injectionWeekKey(pid, item.id)}_${date}`
    : injectionWeekKey(pid, item.id);
}

/**
 * Ligne de produit, lisible d'un coup d'œil :  [ HEURE ]  Produit / dose  [ ✓ ]
 * La case coche/décoche ; un tap sur le texte ouvre l'édition (si onEdit),
 * sinon coche aussi. Réutilisée par l'accueil.
 */
export function ItemRow(pid, day, item, onEdit, timeText) {
  const key = itemKey(pid, day, item);
  const on = Boolean(state.week[key]?.done);
  const toggle = () => setWeekItem(key, { done: !on });
  const time = typeof timeText === 'string' ? timeText : (item.time || '');
  return h('div', { class: `pr-row${on ? ' pr-row--on' : ''}` },
    h('span', { class: `pr-row__time${time.length > 5 ? ' pr-row__time--word' : ''}` }, time || '—'),
    h('button', {
      class: 'pr-row__body', type: 'button',
      'aria-label': onEdit ? `Modifier ${item.name}` : `${on ? 'Décocher' : 'Cocher'} ${item.name}`,
      onclick: onEdit || toggle,
    },
    h('span', { class: 'pr-row__name' }, item.name),
    item.type ? h('span', { class: 'pr-row__dose' }, item.type) : null),
    h('button', {
      class: 'pr-check', type: 'button', 'aria-pressed': String(on), 'aria-label': `${on ? 'Décocher' : 'Cocher'} ${item.name}`,
      onclick: toggle,
    }, icon('check', 18)));
}

const byTime = (a, b) => (parseTimeOfDay(a.i.time) ?? 9999) - (parseTimeOfDay(b.i.time) ?? 9999);

/** Bloc « Aujourd'hui » : toutes les prises du jour, triées par heure. */
function TodayCard(pid, days) {
  const today = isoWeekday();
  const items = days.filter((d) => effectiveWeekdays(d).includes(today))
    .flatMap((d) => (d.injections || []).map((i) => ({ d, i })))
    .sort(byTime);
  const done = items.filter(({ d, i }) => state.week[itemKey(pid, d, i)]?.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const dayName = new Date().toLocaleDateString('fr-FR', { weekday: 'long' });

  return h('section', { class: 'card proto-today' },
    h('div', { class: 'card__row' },
      h('div', {},
        h('p', { class: 'eyebrow' }, `Aujourd’hui · ${dayName}`),
        h('p', { class: 'proto-today__count' }, items.length ? `${done}/${items.length}` : '—', h('span', {}, items.length ? ' pris' : ''))),
      items.length ? h('span', { class: `proto-today__pct${pct === 100 ? ' proto-today__pct--done' : ''}` }, pct === 100 ? 'Terminé ✓' : `${pct} %`) : null),
    items.length ? h('div', { class: 'bar' }, h('div', { class: 'bar__fill bar__fill--p', style: { width: `${pct}%` } })) : null,
    items.length
      ? h('div', { class: 'pr-list' }, items.map(({ d, i }) => ItemRow(pid, d, i)))
      : h('p', { class: 'muted', style: { marginTop: '8px' } }, 'Rien de prévu aujourd’hui.'));
}

/** Jours de prise en pastilles : L M M J V S D. */
function DayDots(wd) {
  const set = new Set(wd);
  return h('span', { class: 'daydots', 'aria-label': daysLabel(wd) },
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((l, i) => h('span', { class: `daydot${set.has(i + 1) ? ' daydot--on' : ''}` }, l)));
}

/** Vue « Mes produits » : un produit par ligne, heure + jours visibles d'un coup d'œil. */
function ProductList(pid, days) {
  const rows = days.flatMap((day) => (day.injections || []).map((it) => ({ day, it, m: itemMinutes(it, day) })))
    .sort((a, b) => a.m - b.m || a.it.name.localeCompare(b.it.name));
  if (!rows.length) return null;
  return h('section', { class: 'card card--flush products' }, rows.map(({ day, it, m }) => {
    const wd = effectiveWeekdays(day);   // vide = jour non assigné (dans « Par jour »)
    return h('button', { class: 'product', type: 'button', onclick: () => productMenu(days, day, it) },
      h('span', { class: 'product__time' }, it.time && parseTimeOfDay(it.time) == null ? it.time : formatMinutes(m)),
      h('span', { class: 'product__body' },
        h('span', { class: 'product__name' }, it.name),
        it.type ? h('span', { class: 'product__dose' }, it.type) : null,
        DayDots(wd)),
      icon('chevron', 18));
  }));
}

function productMenu(days, day, it) {
  actionSheet({
    title: it.name,
    subtitle: [it.type, daysLabel(effectiveWeekdays(day).length ? effectiveWeekdays(day) : ALL_DAYS)].filter(Boolean).join(' · '),
    actions: [
      { label: 'Modifier (dose, heure, jours)', icon: 'edit', onClick: () => editItem(day, it) },
      { label: 'Rappel dans Calendrier', icon: 'bell', onClick: () => calendarSheet(days, it) },
      { label: 'Supprimer', icon: 'trash', danger: true, onClick: async () => {
        if (!await confirmSheet({ title: `Supprimer « ${it.name} » ?` })) return;
        const undo = updateProfileData(CAT, (d) => {
          const x = d.days.find((y) => y.id === day.id);
          if (x) x.injections = x.injections.filter((i) => i.id !== it.id);
          pruneAutoDays(d);
        });
        undoToast(`« ${it.name} » supprimé`, undo);
      } },
    ],
  });
}

let mode = 'products';

function DayCard(pid, day, isToday) {
  const items = [...(day.injections || [])].sort((a, b) => (parseTimeOfDay(a.time) ?? 9999) - (parseTimeOfDay(b.time) ?? 9999));
  const wd = effectiveWeekdays(day);
  return h('section', { class: `card card--flush${isToday ? ' card--today' : ''}` },
    h('header', { class: 'meal__head' },
      h('div', {},
        h('h3', { class: 'meal__name' }, day.name, isToday ? h('span', { class: 'badge badge--inline' }, "Aujourd'hui") : null),
        h('span', { class: 'meal__kcal' }, [wd.length ? formatWeekdays(wd) : 'Aucun jour assigné', day.label].filter(Boolean).join(' · '))),
      h('div', { class: 'row-gap' },
        IconButton('plus', `Ajouter à ${day.name}`, () => editItem(day, null), 'icon-btn--soft'),
        IconButton('more', `Options de ${day.name}`, () => actionSheet({
          title: day.name,
          actions: [
            { label: 'Modifier (nom, jours)', icon: 'edit', onClick: () => editDay(day) },
            { label: 'Supprimer ce jour', icon: 'trash', danger: true, onClick: () => deleteDay(day) },
          ],
        }), 'icon-btn--soft'))),
    items.length
      ? h('div', { class: 'pr-list pr-list--card' }, items.map((it) => ItemRow(pid, day, it, () => editItem(day, it))))
      : h('button', { class: 'meal__empty', type: 'button', onclick: () => editItem(day, null) }, 'Aucun produit — appuie pour ajouter'));
}

export function ProtocolView() {
  const header = PageHeader({ eyebrow: 'Planning', title: 'Mon protocole' });
  if (!state.ready) return [header, Skeleton(4)];
  const pid = activeProfileId(CAT);
  if (!pid) return [header, NoProfile(CAT, 'pill')];

  const days = profileData(CAT).days || [];
  const today = isoWeekday();
  const count = days.reduce((n, d) => n + (d.injections || []).length, 0);
  const setMode = (m) => { mode = m; window.dispatchEvent(new Event('app:render')); };

  return [
    header,
    ProfileBar(CAT),
    count ? TodayCard(pid, days) : null,
    SectionTitle(mode === 'products' ? `Mes produits${count ? ` (${count})` : ''}` : 'Par jour',
      count ? h('button', { class: 'link-btn', type: 'button', onclick: () => calendarSheet(days) }, icon('bell', 16), 'Rappels') : null),
    count ? h('div', { class: 'segmented segmented--fill segmented--compact', role: 'tablist', 'aria-label': 'Affichage' },
      [['products', 'Par produit'], ['days', 'Par jour']].map(([m, l]) => h('button', {
        class: `segment${mode === m ? ' segment--on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(mode === m),
        onclick: () => setMode(m),
      }, l))) : null,
    !count
      ? Empty({ iconName: 'pill', title: 'Protocole vide', text: 'Ajoute tes produits : nom, dose, heure et jours de prise. L’app organise ta semaine toute seule.', actionLabel: 'Ajouter un produit', onAction: () => editItem(null, null) })
      : mode === 'products'
        ? [ProductList(pid, days), h('p', { class: 'hint' }, 'Touche un produit pour le modifier ou créer un rappel. Coche tes prises du jour dans le bloc « Aujourd’hui ».')]
        : [h('div', { class: 'stack' }, days.filter((d) => (d.injections || []).length || !d.auto)
          .map((d) => DayCard(pid, d, effectiveWeekdays(d).includes(today)))),
        h('button', { class: 'btn btn--ghost btn--block add-btn', type: 'button', onclick: () => editDay(null) }, icon('plus', 18), 'Ajouter un jour nommé')],
    count ? h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: () => editItem(null, null) },
      icon('plus', 18), 'Ajouter un produit') : null,
    h('button', {
      class: 'btn btn--quiet btn--block', type: 'button',
      onclick: async () => {
        const ok = await confirmSheet({
          title: 'Réinitialiser la semaine ?',
          message: 'Décoche toutes les séances et tous les produits de la semaine en cours.',
          confirmLabel: 'Réinitialiser',
        });
        if (ok) undoToast('Semaine réinitialisée', resetWeek());
      },
    }, icon('reset', 18), 'Réinitialiser la semaine'),
  ];
}
