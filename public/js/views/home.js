/**
 * Accueil — widgets du jour.
 * Version phase 2 : contenu utile immédiatement. La phase 3 ajoutera le logo
 * animé et le geste « tirer vers le bas » pour révéler la navigation.
 */
import { h } from '../lib/dom.js';
import { greeting, isoWeekday, formatShortDate, frNum } from '../lib/dates.js';
import { state, activeProfileId, profileData, sessionWeekKey, sessionCount } from '../store.js';
import { Skeleton } from '../ui/layout.js';
import { icon } from '../ui/icons.js';
import { selectSession } from './training.js';
import { todaysProtocolDays, ItemRow } from './protocol.js';
import { dietTotals } from './diet.js';
import { weightStats, WeightInput } from './weight.js';
import { unreadForUser } from '../data/messages.js';

function Widget({ eyebrow, action, children, tone }) {
  return h('section', { class: `card widget${tone ? ` widget--${tone}` : ''}` },
    h('div', { class: 'card__row' }, h('p', { class: 'eyebrow' }, eyebrow), action || null),
    children);
}

const link = (label, href) => h('a', { class: 'link-btn', href }, label, icon('chevron', 16));

/** Réponse du coach non lue → en tête de l'accueil. */
function CoachMessage() {
  const c = state.conversation;
  if (!unreadForUser(c)) return null;
  return h('a', { class: 'card widget coach-msg', href: '#/me/contact' },
    h('span', { class: 'coach-msg__icon' }, icon('message', 22)),
    h('span', { class: 'coach-msg__body' },
      h('span', { class: 'eyebrow' }, 'Nouveau message du coach'),
      h('span', { class: 'coach-msg__text' }, c.lastText || '')),
    icon('chevron', 20));
}

function TodaySession() {
  const pid = activeProfileId('workout');
  const sessions = pid ? profileData('workout').sessions || [] : [];
  const today = isoWeekday();
  const planned = sessions.filter((s) => s.weekdays?.includes(today));

  if (!sessions.length) {
    return Widget({ eyebrow: 'Séance du jour', action: link('Créer', '#/training'),
      children: h('p', { class: 'muted' }, 'Aucun programme pour le moment.') });
  }
  if (!planned.length) {
    const anyScheduled = sessions.some((s) => s.weekdays?.length);
    return Widget({ eyebrow: 'Séance du jour', action: link('Programme', '#/training'),
      children: [
        h('p', { class: 'widget__title' }, anyScheduled ? 'Repos' : 'Pas de planning'),
        h('p', { class: 'muted' }, anyScheduled
          ? 'Aucune séance prévue aujourd’hui. Récupère bien.'
          : 'Assigne des jours à tes séances (Entraînement › ⋯ › Modifier) pour les voir ici.'),
      ] });
  }

  return Widget({ eyebrow: 'Séance du jour', tone: 'ink', children: planned.map((s) => {
    const done = state.week[sessionWeekKey(pid, s.id)]?.done;
    return h('a', {
      class: 'today-session', href: '#/training',
      onclick: () => selectSession(s.id),
    },
    h('span', {},
      h('span', { class: 'today-session__name' }, s.name),
      h('span', { class: 'today-session__meta' }, `${(s.exercises || []).length} exercices${done ? ' · terminée' : ''}`)),
    h('span', { class: `today-session__go${done ? ' today-session__go--done' : ''}` }, icon(done ? 'check' : 'chevron', 22)));
  }) });
}

function TodayProtocol() {
  const pid = activeProfileId('protocol');
  if (!pid) return null;
  const days = todaysProtocolDays();
  const items = days.flatMap((d) => d.injections || []);
  return Widget({
    eyebrow: 'Protocole du jour',
    action: link('Planning', '#/protocol'),
    children: items.length
      ? h('div', { class: 'check-list check-list--flat' }, items.map((it) => ItemRow(pid, it)))
      : h('p', { class: 'muted' }, 'Rien de prévu aujourd’hui.'),
  });
}

function WeightWidget() {
  const s = weightStats();
  return Widget({
    eyebrow: 'Poids',
    action: link('Suivi', '#/me/weight'),
    children: [
      s ? h('div', { class: 'kcal' },
        h('span', { class: 'kcal__big' }, frNum(s.last.kg)),
        h('span', { class: 'kcal__unit' }, ' kg'),
        s.delta7 != null ? h('span', { class: `trend${s.delta7 > 0 ? ' up' : s.delta7 < 0 ? ' down' : ''}` },
          `${s.delta7 > 0 ? '+' : ''}${frNum(s.delta7)} kg / 7 j`) : null) : null,
      s ? h('p', { class: 'muted small' }, `Dernière pesée : ${formatShortDate(s.last.date)}`) : null,
      WeightInput({ compact: true }),
    ],
  });
}

function MacrosWidget() {
  if (!activeProfileId('diet')) return null;
  const d = profileData('diet');
  const t = dietTotals(d);
  const obj = d.objective || t.cal;
  return Widget({
    eyebrow: 'Objectifs nutrition',
    action: link('Diet', '#/diet'),
    children: [
      h('div', { class: 'kcal' }, h('span', { class: 'kcal__big' }, String(obj || 0)), h('span', { class: 'kcal__unit' }, ' kcal')),
      h('div', { class: 'macro-grid' },
        [['Protéines', d.macros?.p || t.p], ['Glucides', d.macros?.g || t.g], ['Lipides', d.macros?.l || t.l]]
          .map(([l, v]) => h('div', { class: 'macro-tile' }, h('span', { class: 'macro-tile__v' }, `${Math.round(v)}`), h('span', { class: 'macro-tile__l' }, `${l} (g)`)))),
    ],
  });
}

export function HomeView(session) {
  const first = (session.user.displayName || '').split(' ')[0];
  const head = h('header', { class: 'home-head' },
    h('div', { class: 'topbar' },
      h('span', { class: 'brand brand--sm' }, 'Anabolic', h('span', { class: 'brand__accent' }, 'OS')),
      h('a', { class: 'counter', href: '#/training', 'aria-label': 'Séances effectuées' },
        h('span', { class: 'counter__value' }, String(sessionCount())), h('span', { class: 'counter__label' }, 'séances'))),
    h('p', { class: 'eyebrow' }, `${greeting()} · ${formatShortDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })}`),
    h('h1', { class: 'page-title' }, first || 'Athlète'));

  if (!state.ready) return [head, Skeleton(5)];
  return [head, CoachMessage(), TodaySession(), TodayProtocol(), WeightWidget(), MacrosWidget()];
}

