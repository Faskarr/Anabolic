/**
 * Poids : saisie du jour (date LOCALE), statistiques, courbe, historique.
 */
import { h } from '../lib/dom.js';
import { formatShortDate, frNum, localISODate, daysBetween } from '../lib/dates.js';
import { state } from '../store.js';
import { addWeight, deleteWeight, clearWeights } from '../data/repo.js';
import { PageHeader, Empty, Skeleton, IconButton } from '../ui/layout.js';
import { confirmSheet } from '../ui/sheet.js';
import { toast, undoToast } from '../ui/toast.js';
import { lineChart } from '../ui/chart.js';

/** Statistiques utilisées ici et par l'accueil. */
export function weightStats(log = state.weights) {
  if (!log.length) return null;
  const last = log.at(-1);
  // Référence ~7 jours avant la dernière pesée (la plus proche disponible).
  const ref = [...log].reverse().find((e) => daysBetween(e.date, last.date) >= 7) || null;
  const prev = log.length > 1 ? log.at(-2) : null;
  const all = log.map((e) => e.kg);
  return {
    last,
    prev,
    delta: prev ? last.kg - prev.kg : null,
    delta7: ref ? last.kg - ref.kg : null,
    min: Math.min(...all),
    max: Math.max(...all),
  };
}

/** Champ de saisie rapide (réutilisé sur l'accueil). */
export function WeightInput({ compact = false } = {}) {
  const today = state.weights.find((e) => e.date === localISODate());
  const input = h('input', {
    class: 'input input--num input--xl', id: compact ? 'w-quick' : 'w-main',
    inputmode: 'decimal', maxlength: 6, autocomplete: 'off',
    placeholder: today ? frNum(today.kg) : frNum(state.weights.at(-1)?.kg ?? 80),
    'aria-label': 'Poids du jour en kilos',
  });
  return h('form', {
    class: 'weight-input', novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      const v = parseFloat(input.value.replace(',', '.'));
      if (!(v >= 30 && v <= 300)) {
        input.classList.add('input--invalid');
        toast('Entre un poids entre 30 et 300 kg.', { type: 'error' });
        return;
      }
      addWeight(v);
      input.value = '';
      input.blur();
      toast(`${frNum(v)} kg enregistré`);
    },
  }, input, h('span', { class: 'weight-input__unit' }, 'kg'),
  h('button', { class: 'btn btn--primary', type: 'submit' }, today ? 'Mettre à jour' : 'Ajouter'));
}

function Stat(value, label, tone = '') {
  return h('div', { class: `stat${tone ? ` stat--${tone}` : ''}` },
    h('span', { class: 'stat__value' }, value), h('span', { class: 'stat__label' }, label));
}

const signed = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${frNum(v)}`);

export function WeightView() {
  const header = PageHeader({
    eyebrow: 'Suivi',
    title: 'Mon poids',
    trailing: IconButton('back', 'Retour', () => { location.hash = '#/me'; }, 'icon-btn--soft'),
  });
  if (!state.ready) return [header, Skeleton(3)];

  const log = state.weights;
  const s = weightStats(log);

  return [
    header,
    h('section', { class: 'card' }, h('p', { class: 'eyebrow' }, 'Pesée du jour'), WeightInput()),
    s ? [
      h('div', { class: 'stats stats--4' },
        Stat(frNum(s.last.kg), 'Actuel'),
        Stat(signed(s.delta7), '7 jours', s.delta7 > 0 ? 'up' : s.delta7 < 0 ? 'down' : ''),
        Stat(frNum(s.min), 'Mini'),
        Stat(frNum(s.max), 'Maxi')),
      h('section', { class: 'card' },
        h('p', { class: 'eyebrow' }, `Courbe · ${Math.min(30, log.length)} dernières pesées`),
        h('div', { class: 'chart-wrap' },
          lineChart(log.slice(-30).map((e) => ({ label: formatShortDate(e.date, { day: 'numeric', month: 'short' }), value: e.kg })),
            { unit: ' kg', ariaLabel: 'Évolution du poids' }))),
      h('section', { class: 'card card--flush' },
        h('header', { class: 'meal__head' }, h('h3', { class: 'meal__name' }, 'Historique'),
          h('button', {
            class: 'link-btn link-btn--danger', type: 'button',
            onclick: async () => {
              const ok = await confirmSheet({ title: "Effacer tout l'historique ?", message: `${log.length} pesée(s) seront supprimées.`, confirmLabel: 'Tout effacer' });
              if (!ok) return;
              undoToast('Historique effacé', clearWeights());
            },
          }, 'Tout effacer')),
        h('ul', { class: 'list' }, (() => { const rev = [...log].reverse(); return rev.slice(0, 120).map((e, i) => {
          const older = rev[i + 1];   // liste complète : la 120ᵉ ligne a aussi son écart
          const d = older ? e.kg - older.kg : null;
          return h('li', { class: 'list__row' },
            h('span', { class: 'list__meta list__meta--date' }, formatShortDate(e.date)),
            h('span', { class: 'list__main' }, `${frNum(e.kg)} kg`),
            h('span', { class: `list__meta${d > 0 ? ' up' : d < 0 ? ' down' : ''}` }, d == null ? '' : signed(d)),
            IconButton('x', `Supprimer la pesée du ${formatShortDate(e.date)}`,
              () => undoToast('Pesée supprimée', deleteWeight(e.date)), 'icon-btn--ghost'));
        }); })())),
    ] : Empty({ iconName: 'scale', title: 'Aucune pesée', text: 'Pèse-toi le matin, à jeun, pour un suivi fiable.' }),
  ];
}

