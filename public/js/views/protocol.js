/**
 * Protocole : profils, jours (rattachés aux jours de la semaine), produits,
 * cochage hebdomadaire, réinitialisation de la semaine.
 */
import { h } from '../lib/dom.js';
import { uid } from '../lib/ids.js';
import { formatWeekdays, isoWeekday } from '../lib/dates.js';
import { guessWeekdays } from '../lib/schema.js';
import { state, activeProfileId, profileData, injectionWeekKey } from '../store.js';
import { updateProfileData, setWeekItem, resetWeek } from '../data/repo.js';
import { PageHeader, ProfileBar, NoProfile, Empty, Skeleton, IconButton } from '../ui/layout.js';
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

/** Ligne cochable d'un produit (réutilisée par l'accueil). */
export function ItemRow(pid, item, onEdit) {
  const key = injectionWeekKey(pid, item.id);
  const on = Boolean(state.week[key]?.done);
  return h('div', { class: `check-item${on ? ' check-item--on' : ''}` },
    h('button', {
      class: 'check-item__toggle', type: 'button', 'aria-pressed': String(on),
      onclick: () => setWeekItem(key, { done: !on }),
    },
    h('span', { class: 'check-item__box' }, icon('check', 16)),
    h('span', { class: 'check-item__body' },
      h('span', { class: 'check-item__name' }, item.name),
      item.type ? h('span', { class: 'check-item__meta' }, item.type) : null),
    item.time ? h('span', { class: 'check-item__time' }, item.time) : null),
    onEdit ? IconButton('edit', `Modifier ${item.name}`, onEdit, 'icon-btn--ghost') : null);
}

function DayCard(pid, day, isToday) {
  const items = day.injections || [];
  const wd = effectiveWeekdays(day);
  return h('section', { class: `card card--flush${isToday ? ' card--today' : ''}` },
    h('header', { class: 'meal__head' },
      h('div', {},
        h('h3', { class: 'meal__name' }, day.name, isToday ? h('span', { class: 'badge badge--inline' }, "Aujourd'hui") : null),
        h('span', { class: 'meal__kcal' }, [day.label, wd.length ? formatWeekdays(wd) : null].filter(Boolean).join(' · '))),
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
      ? h('div', { class: 'check-list' }, items.map((it) => ItemRow(pid, it, () => editItem(day, it))))
      : h('button', { class: 'meal__empty', type: 'button', onclick: () => editItem(day, null) }, 'Aucun produit — appuie pour ajouter'));
}

export function ProtocolView() {
  const header = PageHeader({ eyebrow: 'Planning', title: 'Protocole' });
  if (!state.ready) return [header, Skeleton(4)];
  const pid = activeProfileId(CAT);
  if (!pid) return [header, NoProfile(CAT, 'pill')];

  const days = profileData(CAT).days || [];
  const today = isoWeekday();
  const allItems = days.flatMap((d) => d.injections || []);
  const doneCount = allItems.filter((i) => state.week[injectionWeekKey(pid, i.id)]?.done).length;
  const pct = allItems.length ? Math.round((doneCount / allItems.length) * 100) : 0;

  return [
    header,
    ProfileBar(CAT),
    h('section', { class: 'card' },
      h('div', { class: 'card__row' },
        h('p', { class: 'eyebrow' }, 'Cette semaine'),
        h('span', { class: 'muted' }, `${doneCount} / ${allItems.length}`)),
      h('div', { class: 'kcal' }, h('span', { class: 'kcal__big' }, `${pct}`), h('span', { class: 'kcal__unit' }, ' % complété')),
      h('div', { class: 'bar bar--lg' }, h('div', { class: 'bar__fill', style: { width: `${pct}%` } }))),
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
