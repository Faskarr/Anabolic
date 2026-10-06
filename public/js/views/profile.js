/**
 * Page profil d'un ami (ou la mienne, « telle que mes amis la voient ») :
 * photo, séances, poids, records et sons partagés, programme, diet, protocole.
 *
 * N'affiche QUE ce que la personne a choisi de partager (shared/{uid}) ;
 * le contenu reçu repasse par les normaliseurs (jamais utilisé tel quel).
 * Lectures : 1 document + 10 publications, à l'ouverture (temps réel ensuite).
 */
import { h } from '../lib/dom.js';
import { frNum, formatWeekdays, formatShortDate } from '../lib/dates.js';
import { state } from '../store.js';
import { watchShared } from '../data/shared.js';
import { watchPosts } from '../data/posts.js';
import { friendOf, isAccepted, pairOf } from '../data/friends.js';
import { normalizeWorkout, normalizeDiet, normalizeProtocol } from '../lib/schema.js';
import { applyImport } from '../data/importer.js';
import { PageHeader, IconButton, Skeleton } from '../ui/layout.js';
import { Avatar } from '../ui/avatar.js';
import { PostRow } from '../ui/feed.js';
import { icon } from '../ui/icons.js';
import { confirmSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { dietTotals } from './diet.js';
import { trainedToday } from './messages-hub.js';

const rerender = () => window.dispatchEvent(new Event('app:render'));

// Abonnements de la page ouverte (coupés en la quittant).
const view = { uid: null, shared: undefined, denied: false, posts: null, unsubs: [] };
const opened = new Set();   // sections dépliées (survivent aux re-rendus)

function open(uid) {
  if (view.uid === uid) return;
  leaveProfile();
  Object.assign(view, { uid, shared: undefined, denied: false, posts: null });
  view.unsubs.push(watchShared(uid, (d, err) => { view.shared = d; view.denied = Boolean(err); rerender(); }));
  view.unsubs.push(watchPosts(uid, (list) => { view.posts = list; rerender(); }, 10));
}

export function leaveProfile() {
  view.unsubs.forEach((u) => u?.());
  view.unsubs = [];
  view.uid = null;
}

/** Bloc repliable (état gardé entre deux rendus). */
function Fold(key, summary, body) {
  const el = h('details', { class: 'pfold', ontoggle: () => (el.open ? opened.add(key) : opened.delete(key)) },
    h('summary', { class: 'pfold__sum' }, summary, icon('chevron', 16)),
    h('div', { class: 'pfold__body' }, body));
  if (opened.has(key)) el.open = true;
  return el;
}

/** « Ajouter à mes programmes / diets / protocoles » (nouveau profil, rien d'écrasé). */
async function copyToMine(cat, data, title, owner) {
  const label = { workout: 'programme', diet: 'diet', protocol: 'protocole' }[cat];
  const name = `${title || label} (${owner})`.slice(0, 60);
  if (!(await confirmSheet({ title: `Ajouter ce ${label} ?`, message: `« ${name} » sera ajouté à tes ${label}s et activé. Rien n’est remplacé.`, confirmLabel: 'Ajouter', danger: false }))) return;
  applyImport({ name, [cat]: structuredClone(data) }, { [cat]: true });
  toast(`${label[0].toUpperCase()}${label.slice(1)} « ${name} » ajouté`);
}

const Stat = (value, label) => h('div', { class: 'pstat' }, h('span', { class: 'pstat__value' }, value), h('span', { class: 'pstat__label' }, label));

function WorkoutCard(w, owner, isMe) {
  const n = w.sessions.reduce((a, s) => a + s.exercises.length, 0);
  return h('section', { class: 'card pcard-sec' },
    h('div', { class: 'card__row' }, h('p', { class: 'eyebrow' }, icon('dumbbell', 13), ' Programme'),
      isMe ? null : h('button', { class: 'link-btn', type: 'button', onclick: () => copyToMine('workout', w, w.name, owner) }, icon('plus', 15), 'Copier')),
    h('p', { class: 'pcard-sec__title' }, w.name || 'Programme'),
    h('p', { class: 'muted small' }, `${w.sessions.length} séance${w.sessions.length > 1 ? 's' : ''} · ${n} exercice${n > 1 ? 's' : ''}`),
    w.sessions.map((s, i) => Fold(`w${i}`,
      h('span', { class: 'pfold__title' }, s.name, s.weekdays?.length ? h('span', { class: 'pfold__meta' }, ` · ${formatWeekdays(s.weekdays)}`) : null),
      h('ol', { class: 'plist' }, s.exercises.map((e) => h('li', {},
        h('span', { class: 'plist__main' }, e.n),
        h('span', { class: 'plist__meta' }, [e.s !== '—' && e.s, e.r !== '—' && `repos ${e.r}`].filter(Boolean).join(' · '))))))));
}

function DietCard(d, owner, isMe) {
  const t = dietTotals(d);
  const kcal = d.objective || Math.round(t.cal);
  const m = d.macros?.p || d.macros?.g || d.macros?.l ? d.macros : { p: Math.round(t.p), g: Math.round(t.g), l: Math.round(t.l) };
  return h('section', { class: 'card pcard-sec' },
    h('div', { class: 'card__row' }, h('p', { class: 'eyebrow' }, icon('leaf', 13), ' Diet'),
      isMe ? null : h('button', { class: 'link-btn', type: 'button', onclick: () => copyToMine('diet', d, d.name, owner) }, icon('plus', 15), 'Copier')),
    h('p', { class: 'pcard-sec__title' }, d.name || 'Diet'),
    h('div', { class: 'pmacros' },
      Stat(kcal ? `${kcal}` : '—', 'kcal'), Stat(`${m.p || 0} g`, 'Protéines'), Stat(`${m.g || 0} g`, 'Glucides'), Stat(`${m.l || 0} g`, 'Lipides')),
    d.meals.map((meal, i) => Fold(`d${i}`,
      h('span', { class: 'pfold__title' }, meal.name, meal.time ? h('span', { class: 'pfold__meta' }, ` · ${meal.time}`) : null),
      h('ul', { class: 'plist' },
        (meal.foods || []).map((f) => h('li', {}, h('span', { class: 'plist__main' }, f.name), h('span', { class: 'plist__meta' }, [f.qty, f.cal ? `${f.cal} kcal` : null].filter(Boolean).join(' · ')))),
        (meal.supplements || []).map((s) => h('li', {}, h('span', { class: 'plist__main' }, `💊 ${s.name}`), h('span', { class: 'plist__meta' }, s.dose || '')))))));
}

function ProtocolCard(p, owner, isMe) {
  const items = p.days.flatMap((d) => d.injections.map((i) => ({ d, i })));
  return h('section', { class: 'card pcard-sec' },
    h('div', { class: 'card__row' }, h('p', { class: 'eyebrow' }, icon('pill', 13), ' Protocole'),
      isMe ? null : h('button', { class: 'link-btn', type: 'button', onclick: () => copyToMine('protocol', p, p.name, owner) }, icon('plus', 15), 'Copier')),
    h('p', { class: 'pcard-sec__title' }, p.name || 'Protocole'),
    p.products.length
      ? h('ul', { class: 'plist' }, p.products.map((x) => h('li', {}, h('span', { class: 'plist__main' }, x.name), h('span', { class: 'plist__meta' }, x.dose || ''))))
      : null,
    items.length ? Fold('p0', h('span', { class: 'pfold__title' }, `Planning · ${items.length} prise${items.length > 1 ? 's' : ''}`),
      h('ul', { class: 'plist' }, items.map(({ d, i }) => h('li', {},
        h('span', { class: 'plist__main' }, i.name, i.type ? h('span', { class: 'plist__meta' }, ` · ${i.type}`) : null),
        h('span', { class: 'plist__meta' }, [d.weekdays?.length ? formatWeekdays(d.weekdays) : d.name, i.time].filter(Boolean).join(' · ')))))) : null);
}

export function ProfileView(session, uid) {
  const me = session.user.uid;
  const isMe = uid === me;
  const back = IconButton('back', 'Retour', () => history.length > 1 ? history.back() : (location.hash = '#/home'), 'icon-btn--soft');
  const f = isMe ? null : state.friendships.find((x) => x.id === pairOf(me, uid));

  if (!isMe && (!f || !isAccepted(f))) {
    return [PageHeader({ eyebrow: 'Profil', title: '…', trailing: back }),
      h('p', { class: 'muted' }, state.friendships.length ? 'Ce profil est visible uniquement par ses amis.' : 'Chargement…')];
  }
  open(uid);

  const sh = view.shared;
  const name = String(sh?.name || (isMe ? session.user.displayName : f?.names?.[uid]) || 'Ami');
  const first = name.split(' ')[0];
  const act = isMe ? null : state.friendActivity[uid];
  const header = PageHeader({ eyebrow: isMe ? 'Mon profil' : 'Profil', title: name, trailing: back });

  const hero = h('section', { class: 'card phero' },
    Avatar({ uid, name, photoURL: isMe ? session.user.photoURL : null, size: 'lg' }),
    h('div', { class: 'phero__txt' },
      act && trainedToday(act)
        ? h('p', { class: 'friend-status' }, icon('dumbbell', 15), `Entraîné aujourd’hui${act.sessionName ? ` · ${act.sessionName}` : ''}`)
        : h('p', { class: 'muted small' }, isMe ? 'Voici ce que voient tes amis.' : 'Pas encore entraîné aujourd’hui.'),
      h('div', { class: 'phero__actions' },
        isMe
          ? h('a', { class: 'btn btn--ghost', href: '#/me' }, icon('edit', 16), 'Choisir ce que je partage')
          : h('a', { class: 'btn btn--ghost', href: `#/friends/${encodeURIComponent(f.id)}` }, icon('message', 16), 'Message'))));

  if (sh === undefined && !view.denied) return [header, hero, Skeleton(3)];

  // Contenu partagé, re-validé.
  const w = sh?.workout ? { name: String(sh.workout.name || '').slice(0, 60), ...normalizeWorkout(sh.workout) } : null;
  const d = sh?.diet ? { name: String(sh.diet.name || '').slice(0, 60), ...normalizeDiet(sh.diet) } : null;
  const p = sh?.protocol ? { name: String(sh.protocol.name || '').slice(0, 60), ...normalizeProtocol(sh.protocol) } : null;
  const weight = sh?.weight && Number(sh.weight.kg) > 0 ? sh.weight : null;
  const posts = (view.posts || []);
  const prs = posts.filter((x) => x.type === 'pr');
  const music = posts.filter((x) => x.type === 'music');

  const stats = [
    Number.isInteger(sh?.sessions) ? Stat(String(sh.sessions), 'séances') : null,
    weight ? Stat(`${frNum(weight.kg, weight.kg % 1 ? 1 : 0)} kg`, weight.date ? `poids · ${formatShortDate(weight.date, { day: 'numeric', month: 'short' })}` : 'poids') : null,
    d ? Stat(String(d.objective || Math.round(dietTotals(d).cal) || '—'), 'kcal / jour') : null,
    Stat(String(prs.length), `record${prs.length > 1 ? 's' : ''}`),
  ].filter(Boolean);

  const nothing = !w && !d && !p && !weight && !Number.isInteger(sh?.sessions);
  return [
    header,
    hero,
    h('div', { class: 'pstats' }, stats),
    prs.length ? h('section', { class: 'card pcard-sec' },
      h('p', { class: 'eyebrow' }, icon('flame', 13), ' Records partagés'),
      h('ul', { class: 'records' }, prs.map((x) => PostRow(x, me)))) : null,
    music.length ? h('section', { class: 'card pcard-sec' },
      h('p', { class: 'eyebrow' }, icon('music', 13), ' Sons partagés'),
      h('ul', { class: 'records' }, music.map((x) => PostRow(x, me)))) : null,
    w ? WorkoutCard(w, first, isMe) : null,
    d ? DietCard(d, first, isMe) : null,
    p ? ProtocolCard(p, first, isMe) : null,
    nothing ? h('p', { class: 'muted center' }, isMe
      ? 'Tu ne partages rien pour l’instant. Choisis quoi montrer dans Moi › Ce que voient mes amis.'
      : `${first} ne partage pas encore son programme, sa diet ou son protocole.`) : null,
  ];
}
