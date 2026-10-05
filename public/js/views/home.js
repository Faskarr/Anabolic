/**
 * Accueil — widgets du jour, toujours visibles (avec un état « vide » utile) :
 *   envois du coach · message · séance du jour · protocole (2 prochaines prises)
 *   · prochain repas + macros · poids.
 */
import { h } from '../lib/dom.js';
import { greeting, formatShortDate, frNum, formatWeekdays } from '../lib/dates.js';
import { nextMeal, nextProtocolItems, formatMinutes } from '../lib/schedule.js';
import { state, activeProfileId, profileData, sessionWeekKey, sessionCount } from '../store.js';
import { setWeekItem } from '../data/repo.js';
import { LiveLogo } from '../ui/logo.js';
import { Skeleton } from '../ui/layout.js';
import { icon } from '../ui/icons.js';
import { selectSession, nextSession } from './training.js';
import { effectiveWeekdays, ItemRow, itemKey } from './protocol.js';
import { dietTotals } from './diet.js';
import { weightStats, WeightInput } from './weight.js';
import { unreadForUser, unreadForAdmin } from '../data/messages.js';
import { acceptItem, dismissItem, TYPE_LABEL } from '../data/inbox.js';

function Widget({ eyebrow, action, children, tone, cls = '' }) {
  return h('section', { class: `card widget${tone ? ` widget--${tone}` : ''} ${cls}` },
    h('div', { class: 'card__row' }, h('p', { class: 'eyebrow' }, eyebrow), action || null),
    children);
}

const link = (label, href) => h('a', { class: 'link-btn', href }, label, icon('chevron', 16));
const cta = (label, href) => h('a', { class: 'btn btn--ghost btn--block', href }, icon('plus', 18), label);

// ── Envois du coach ─────────────────────────────────────────────────────

function CoachSends(session) {
  if (!state.inbox.length) return null;
  return state.inbox.map((it) => Widget({
    eyebrow: `${TYPE_LABEL[it.type] || 'Envoi'} de ton coach`,
    cls: 'coach-send',
    children: [
      h('p', { class: 'widget__title' }, it.title),
      it.message ? h('p', { class: 'muted' }, it.message) : null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn--primary', type: 'button', onclick: () => acceptItem(session.user.uid, it) }, icon('check', 18), 'Ajouter et activer'),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => dismissItem(session.user.uid, it) }, 'Ignorer')),
    ],
  }));
}

// ── Messages ────────────────────────────────────────────────────────────

function MessagesWidget(session) {
  if (session.isAdmin) {
    const n = (state.adminConversations || []).filter(unreadForAdmin).length;
    return h('a', { class: `card widget coach-msg${n ? '' : ' coach-msg--calm'}`, href: '#/contact' },
      h('span', { class: 'coach-msg__icon' }, icon('message', 22)),
      h('span', { class: 'coach-msg__body' },
        h('span', { class: 'eyebrow' }, 'Messages'),
        h('span', { class: 'coach-msg__text' }, n ? `${n} conversation${n > 1 ? 's' : ''} non lue${n > 1 ? 's' : ''}` : 'Aucun message non lu')),
      icon('chevron', 20));
  }
  const c = state.conversation;
  const unread = unreadForUser(c);
  return h('a', { class: `card widget coach-msg${unread ? '' : ' coach-msg--calm'}`, href: '#/contact' },
    h('span', { class: 'coach-msg__icon' }, icon('message', 22)),
    h('span', { class: 'coach-msg__body' },
      h('span', { class: 'eyebrow' }, unread ? 'Nouveau message du coach' : 'Messages'),
      h('span', { class: 'coach-msg__text' }, unread ? (c.lastText || '') : 'Aucun message non lu · écrire au coach')),
    icon('chevron', 20));
}

// ── Séance du jour : la prochaine séance à faire ────────────────────────

function TodaySession() {
  const { session, plannedToday, sessions, doneToday, pid } = nextSession();

  if (!sessions?.length) {
    return Widget({ eyebrow: 'Séance du jour', children: [
      h('p', { class: 'muted' }, 'Aucun programme pour le moment.'), cta('Créer mon programme', '#/training')] });
  }

  const doneLine = doneToday.length
    ? h('p', { class: 'today-session__done' }, icon('check', 16), `${doneToday.map((s) => s.name).join(', ')} terminée${doneToday.length > 1 ? 's' : ''} aujourd’hui`)
    : null;

  if (!session) {
    return Widget({ eyebrow: 'Séances de la semaine', tone: 'ink', action: link('Programme', '#/training'), children: [
      doneLine,
      h('p', { class: 'widget__title' }, 'Semaine bouclée'),
      h('p', { class: 'today-session__meta' }, `${sessions.length}/${sessions.length} séances faites. Repos bien mérité.`)] });
  }

  const n = (session.exercises || []).length;
  return Widget({
    eyebrow: plannedToday ? 'Séance du jour' : 'Prochaine séance',
    tone: 'ink',
    children: [
      doneLine,
      h('a', { class: 'today-session', href: '#/training', onclick: () => selectSession(session.id) },
        h('span', {},
          h('span', { class: 'today-session__name' }, session.name),
          h('span', { class: 'today-session__meta' }, `${n} exercice${n > 1 ? 's' : ''}${session.weekdays?.length ? ` · ${formatWeekdays(session.weekdays)}` : ''}`)),
        h('span', { class: 'today-session__go' }, icon('chevron', 22))),
      h('button', {
        class: 'today-session__check', type: 'button',
        onclick: () => setWeekItem(sessionWeekKey(pid, session.id), { done: true, ts: Date.now() }),
      }, icon('check', 18), 'Marquer comme faite'),
    ],
  });
}

// ── Protocole : 2 prochaines prises ─────────────────────────────────────

function ProtocolWidget() {
  const pid = activeProfileId('protocol');
  if (!pid) {
    return Widget({ eyebrow: 'Protocole', children: [
      h('p', { class: 'muted' }, 'Aucun protocole pour le moment.'), cta('Créer mon protocole', '#/protocol')] });
  }
  const days = profileData('protocol').days || [];
  const dayOf = (it) => days.find((d) => (d.injections || []).includes(it));
  const { items, todayTotal, todayDone } = nextProtocolItems(
    days, (it) => Boolean(state.week[itemKey(pid, dayOf(it), it)]?.done), effectiveWeekdays, 2);

  const progress = todayTotal ? `${todayDone}/${todayTotal} aujourd’hui` : null;
  return Widget({
    eyebrow: 'Prochaines prises',
    action: link(progress || 'Planning', '#/protocol'),
    children: items.length
      ? h('div', { class: 'check-list check-list--flat' }, items.map(({ item, day, minutes, tomorrow }) => (tomorrow
        ? h('div', { class: 'check-item check-item--later' },
          h('div', { class: 'check-item__toggle' },
            h('span', { class: 'check-item__box' }),
            h('span', { class: 'check-item__body' }, h('span', { class: 'check-item__name' }, item.name), item.type ? h('span', { class: 'check-item__meta' }, item.type) : null),
            h('span', { class: 'check-item__time' }, `Demain · ${item.time || formatMinutes(minutes)}`)))
        : ItemRow(pid, day, item, null, h('span', { class: 'check-item__time' }, item.time || formatMinutes(minutes))))))
      : h('p', { class: 'muted' }, todayTotal ? 'Tout est fait pour aujourd’hui ✓' : 'Rien de prévu aujourd’hui ni demain.'),
  });
}

// ── Diet : prochain repas + macros du jour ──────────────────────────────

function DietWidget() {
  if (!activeProfileId('diet')) {
    return Widget({ eyebrow: 'Nutrition', children: [
      h('p', { class: 'muted' }, 'Aucune diet pour le moment.'), cta('Créer ma diet', '#/diet')] });
  }
  const d = profileData('diet');
  const totals = dietTotals(d);
  const target = { cal: d.objective || totals.cal, p: d.macros?.p || totals.p, g: d.macros?.g || totals.g, l: d.macros?.l || totals.l };
  const next = nextMeal(d.meals || []);

  let mealBlock;
  if (!next) {
    mealBlock = h('p', { class: 'muted' }, 'Ajoute tes repas dans Diet pour voir le prochain ici.');
  } else {
    const m = next.meal;
    const foods = m.foods || [];
    const mt = dietTotals({ meals: [m] });
    mealBlock = h('a', { class: 'next-meal', href: '#/diet' },
      h('div', { class: 'next-meal__head' },
        h('span', { class: 'next-meal__name' }, m.name),
        h('span', { class: 'next-meal__time' }, `${next.tomorrow ? 'Demain · ' : ''}${m.time || `~${formatMinutes(next.minutes)}`}`)),
      foods.length
        ? h('ul', { class: 'next-meal__foods' }, foods.slice(0, 5).map((f) => h('li', {}, h('span', {}, f.name), h('span', { class: 'muted' }, f.qty || ''))),
          foods.length > 5 ? h('li', { class: 'muted' }, `+ ${foods.length - 5} autre(s)`) : null)
        : h('p', { class: 'muted small' }, 'Aucun aliment dans ce repas.'),
      h('p', { class: 'next-meal__macros' }, `${mt.cal} kcal · P ${Math.round(mt.p)} · G ${Math.round(mt.g)} · L ${Math.round(mt.l)}`));
  }

  return Widget({
    eyebrow: 'Prochain repas',
    action: link('Diet', '#/diet'),
    children: [
      mealBlock,
      h('p', { class: 'eyebrow', style: { marginTop: '16px' } }, 'Objectifs du jour'),
      h('div', { class: 'macro-grid macro-grid--4' },
        [['kcal', target.cal], ['Prot. (g)', target.p], ['Gluc. (g)', target.g], ['Lip. (g)', target.l]]
          .map(([l, v]) => h('div', { class: 'macro-tile' }, h('span', { class: 'macro-tile__v' }, `${Math.round(v || 0)}`), h('span', { class: 'macro-tile__l' }, l)))),
    ],
  });
}

// ── Poids ───────────────────────────────────────────────────────────────

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
          `${s.delta7 > 0 ? '+' : ''}${frNum(s.delta7)} kg / 7 j`) : null) : h('p', { class: 'muted' }, 'Première pesée ? Le matin, à jeun.'),
      s ? h('p', { class: 'muted small' }, `Dernière pesée : ${formatShortDate(s.last.date)}`) : null,
      WeightInput({ compact: true }),
    ],
  });
}

export function HomeView(session) {
  const first = (session.user.displayName || '').split(' ')[0];
  const head = h('header', { class: 'home-head' },
    h('div', { class: 'topbar' },
      LiveLogo(),
      h('a', { class: 'counter', href: '#/training', 'aria-label': 'Séances effectuées' },
        h('span', { class: 'counter__value' }, String(sessionCount())), h('span', { class: 'counter__label' }, 'séances'))),
    h('p', { class: 'eyebrow' }, `${greeting()} · ${formatShortDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })}`),
    h('h1', { class: 'page-title' }, first || 'Athlète'));

  if (!state.ready) return [head, Skeleton(5)];
  return [
    head,
    MessagesWidget(session),     // toujours en premier
    CoachSends(session),
    TodaySession(),
    ProtocolWidget(),
    DietWidget(),
    WeightWidget(),
  ];
}
