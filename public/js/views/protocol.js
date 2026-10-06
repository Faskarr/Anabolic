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
import { parseTimeOfDay } from '../lib/schedule.js';
import { formSheet, confirmSheet, actionSheet } from '../ui/sheet.js';
import { undoToast } from '../ui/toast.js';
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

async function editItem(day, item) {
  const r = await formSheet({
    title: item ? 'Modifier' : `Ajouter à ${day.name}`,
    fields: [
      { name: 'name', label: 'Produit', value: item?.name, required: true, placeholder: 'Nom du produit' },
      { name: 'type', label: 'Type / dosage / fréquence', value: item?.type, placeholder: 'Ex. 2 gélules · Lun & Jeu' },
      { name: 'time', label: 'Moment', value: item?.time, maxlength: 40, placeholder: 'Matin' },
    ],
    deleteLabel: item ? 'Supprimer' : null,
  });
  if (!r) return;
  if (r.action === 'delete') {
    const undo = updateProfileData(CAT, (d) => {
      const x = d.days.find((y) => y.id === day.id);
      if (x) x.injections = x.injections.filter((i) => i.id !== item.id);
    });
    undoToast(`« ${item.name} » supprimé`, undo);
    return;
  }
  const next = { id: item?.id || uid('inj'), ...r.values };
  updateProfileData(CAT, (d) => {
    const x = d.days.find((y) => y.id === day.id);
    if (!x) return;
    x.injections = x.injections || [];
    const i = x.injections.findIndex((y) => y.id === next.id);
    if (i >= 0) x.injections[i] = next; else x.injections.push(next);
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
  const header = PageHeader({ eyebrow: 'Planning', title: 'Protocole' });
  if (!state.ready) return [header, Skeleton(4)];
  const pid = activeProfileId(CAT);
  if (!pid) return [header, NoProfile(CAT, 'pill')];

  const days = profileData(CAT).days || [];
  const today = isoWeekday();

  return [
    header,
    ProfileBar(CAT),
    days.length ? TodayCard(pid, days) : null,
    days.length ? SectionTitle('Planning de la semaine') : null,
    h('p', { class: 'hint' }, 'Touche un produit pour le modifier, la case pour le cocher.'),
    days.length
      ? h('div', { class: 'stack' }, days.map((d) => DayCard(pid, d, effectiveWeekdays(d).includes(today))))
      : Empty({ iconName: 'pill', title: 'Protocole vide', text: 'Ajoute un jour puis ses produits.' }),
    h('button', { class: 'btn btn--ghost btn--block add-btn', type: 'button', onclick: () => editDay(null) },
      icon('plus', 18), 'Ajouter un jour'),
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
