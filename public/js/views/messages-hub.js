/**
 * Onglet Contact = messagerie :
 *   • le coach (utilisateur) ou les messages des utilisateurs (admin) ;
 *   • les amis : code personnel, ajout par code, discussions privées.
 */
import { h } from '../lib/dom.js';
import { localISODate } from '../lib/dates.js';
import { state } from '../store.js';
import { unreadForUser, unreadForAdmin } from '../data/messages.js';
import {
  ensureMyCode, addFriendByCode, removeFriend, friendOf, unreadFriend,
  watchFriendMessages, sendFriendMessage, markFriendRead,
  acceptFriend, isAccepted, isIncoming, isOutgoing,
} from '../data/friends.js';
import { PageHeader, SectionTitle, IconButton, Skeleton } from '../ui/layout.js';
import { Thread, Composer, scrollToEnd, shortWhen } from '../ui/chat.js';
import { formSheet, confirmSheet, actionSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { Avatar } from '../ui/avatar.js';

const rerender = () => window.dispatchEvent(new Event('app:render'));
const initial = (n) => (n || '?').trim().charAt(0).toUpperCase();
export const trainedToday = (a) => Boolean(a && a.day === localISODate());

// ── Code ami ────────────────────────────────────────────────────────────

let myCode = null;
let codeLoading = false;

function loadMyCode(session) {
  if (myCode || codeLoading) return;
  codeLoading = true;
  ensureMyCode(session.user, session.profile?.friendCode)
    .then((c) => { myCode = c; if (session.profile) session.profile.friendCode = c; })
    .catch((err) => toast(err.message, { type: 'error' }))
    .finally(() => { codeLoading = false; rerender(); });
}

async function shareCode() {
  const text = `Ajoute-moi sur AnabolicOS avec mon code ami : ${myCode}\nhttps://anabolic-adc6a.web.app`;
  try {
    if (navigator.share) await navigator.share({ title: 'AnabolicOS', text });
    else { await navigator.clipboard.writeText(myCode); toast('Code copié'); }
  } catch (err) { if (err?.name !== 'AbortError') toast('Partage impossible.', { type: 'error' }); }
}

async function addFriendFlow(session) {
  const r = await formSheet({
    title: 'Envoyer une demande d’ami',
    subtitle: 'Saisis son code ami : il recevra une demande à accepter.',
    fields: [{ name: 'code', label: 'Code ami', required: true, maxlength: 8, placeholder: 'ABC234', inputmode: 'text' }],
    submitLabel: 'Envoyer la demande',
  });
  if (!r?.values) return;
  try {
    const name = await addFriendByCode(session.user, r.values.code, state.friendships);
    toast(`Demande envoyée à ${name}. Il doit l’accepter.`);
  } catch (err) {
    toast(err.code === 'permission-denied' ? 'Code invalide ou ami déjà ajouté.' : err.message, { type: 'error' });
  }
}

// ── Lignes ──────────────────────────────────────────────────────────────

function Row({ href, title, preview, when, unread, avatar, tag }) {
  return h('a', { class: `conv${unread ? ' conv--unread' : ''}`, href },
    avatar,
    h('span', { class: 'conv__body' },
      h('span', { class: 'conv__top' }, h('span', { class: 'conv__name' }, title), h('span', { class: 'conv__when' }, when || '')),
      h('span', { class: 'conv__preview' }, preview)),
    tag || null,
    unread ? h('span', { class: 'dot', 'aria-label': 'Non lu' }) : null);
}

function CoachRow(session) {
  if (session.isAdmin) {
    const n = (state.adminConversations || []).filter(unreadForAdmin).length;
    return Row({
      href: '#/admin/messages', title: 'Messages des utilisateurs',
      preview: n ? `${n} conversation${n > 1 ? 's' : ''} non lue${n > 1 ? 's' : ''}` : 'Tout est lu',
      unread: n > 0, avatar: h('span', { class: 'avatar avatar--brand' }, icon('shield', 20)),
    });
  }
  const c = state.conversation;
  return Row({
    href: '#/contact/coach', title: 'Ton coach',
    preview: c?.lastText ? `${c.lastFrom === 'user' ? 'Toi : ' : ''}${c.lastText}` : 'Pose-lui une question',
    when: shortWhen(c?.lastAt), unread: unreadForUser(c),
    avatar: h('span', { class: 'avatar avatar--brand' }, icon('message', 20)),
  });
}

function FriendRow(f, me) {
  const other = friendOf(f, me);
  const name = f.names?.[other] || 'Ami';
  const act = state.friendActivity[other];
  return Row({
    href: `#/friends/${encodeURIComponent(f.id)}`,
    title: name,
    preview: f.lastText ? `${f.lastFrom === me ? 'Toi : ' : ''}${f.lastText}` : 'Dis bonjour 👋',
    when: shortWhen(f.lastAt), unread: unreadFriend(f, me),
    avatar: Avatar({ uid: other, name }),
    tag: trainedToday(act) ? h('span', { class: 'tag tag--ok', title: act.sessionName || '' }, icon('dumbbell', 14), 'Auj.') : null,
  });
}

// ── Vue : hub ───────────────────────────────────────────────────────────

/** Demande reçue : Accepter / Refuser. */
function RequestRow(f, me) {
  const other = friendOf(f, me);
  const name = f.names?.[other] || 'Quelqu’un';
  return h('div', { class: 'request' },
    h('span', { class: 'avatar' }, initial(name)),
    h('span', { class: 'request__body' },
      h('span', { class: 'request__name' }, name),
      h('span', { class: 'muted small' }, 'veut t’ajouter en ami')),
    h('div', { class: 'request__actions' },
      h('button', {
        class: 'btn btn--primary btn--sm', type: 'button',
        onclick: async (e) => { e.currentTarget.disabled = true; await acceptFriend(f.id).catch(() => {}); toast(`${name} est maintenant ton ami`); },
      }, 'Accepter'),
      h('button', {
        class: 'btn btn--ghost btn--sm', type: 'button',
        onclick: async () => { if (await confirmSheet({ title: `Refuser la demande de ${name} ?`, confirmLabel: 'Refuser' })) removeFriend(f.id); },
      }, 'Refuser')));
}

/** Demande envoyée : en attente, annulable. */
function PendingRow(f, me) {
  const other = friendOf(f, me);
  const name = f.names?.[other] || 'Ami';
  return h('div', { class: 'request request--pending' },
    h('span', { class: 'avatar' }, initial(name)),
    h('span', { class: 'request__body' },
      h('span', { class: 'request__name' }, name),
      h('span', { class: 'muted small' }, 'Demande envoyée · en attente')),
    h('button', { class: 'link-btn link-btn--danger', type: 'button', onclick: () => removeFriend(f.id) }, 'Annuler'));
}

export function MessagesHubView(session) {
  loadMyCode(session);
  const me = session.user.uid;
  const friends = state.friendships.filter(isAccepted);
  const incoming = state.friendships.filter((f) => isIncoming(f, me));
  const outgoing = state.friendships.filter((f) => isOutgoing(f, me));

  return [
    PageHeader({ eyebrow: 'Messagerie', title: 'Contact' }),
    h('nav', { class: 'card card--flush', 'aria-label': 'Coach' }, CoachRow(session)),
    incoming.length ? [
      SectionTitle(`Demandes d’ami (${incoming.length})`),
      h('section', { class: 'card card--flush requests requests--in' }, incoming.map((f) => RequestRow(f, me))),
    ] : null,
    SectionTitle('Amis', h('button', { class: 'link-btn', type: 'button', onclick: () => addFriendFlow(session) }, icon('plus', 16), 'Ajouter')),
    friends.length
      ? h('nav', { class: 'card card--flush', 'aria-label': 'Amis' }, friends.map((f) => FriendRow(f, me)))
      : h('p', { class: 'hint' }, 'Ajoute tes partenaires d’entraînement avec leur code : une fois la demande acceptée, vous pourrez discuter et voir qui s’est entraîné.'),
    outgoing.length ? h('section', { class: 'card card--flush requests' }, outgoing.map((f) => PendingRow(f, me))) : null,
    h('section', { class: 'card friend-code' },
      h('p', { class: 'eyebrow' }, 'Mon code ami'),
      myCode
        ? h('p', { class: 'friend-code__value', 'aria-label': `Code ${myCode.split('').join(' ')}` }, myCode)
        : h('div', { class: 'spinner', style: { margin: '12px 0' } }),
      h('p', { class: 'muted small' }, 'Donne-le à un ami pour qu’il t’ajoute.'),
      myCode ? h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn--ink', type: 'button', onclick: shareCode }, icon('share', 18), 'Partager'),
        h('button', {
          class: 'btn btn--ghost', type: 'button',
          onclick: () => navigator.clipboard.writeText(myCode).then(() => toast('Code copié'), () => toast('Copie impossible', { type: 'error' })),
        }, icon('copy', 18), 'Copier')) : null),
  ];
}

// ── Vue : discussion avec un ami ────────────────────────────────────────

let feed = null;
let messages = null;
let lastCount = 0;
const drafts = {};

function ensureFeed(pid) {
  if (feed?.pid === pid) return;
  leaveFriendChat();
  feed = { pid, unsub: watchFriendMessages(pid, (list) => { messages = list; rerender(); }) };
}

export function leaveFriendChat() {
  feed?.unsub?.();
  feed = null;
  messages = null;
  lastCount = 0;
}

export function FriendChatView(session, pid) {
  const me = session.user.uid;
  const f = state.friendships.find((x) => x.id === pid);
  const back = IconButton('back', 'Retour', () => { location.hash = '#/contact'; }, 'icon-btn--soft');
  if (!f) {
    return [PageHeader({ eyebrow: 'Ami', title: '…', trailing: back }),
      state.friendships.length ? h('p', { class: 'muted' }, 'Cette amitié n’existe plus.') : Skeleton(2)];
  }
  if (!isAccepted(f)) {
    return [PageHeader({ eyebrow: 'Ami', title: f.names?.[friendOf(f, me)] || 'Ami', trailing: back }),
      h('p', { class: 'muted' }, isIncoming(f, me) ? 'Accepte sa demande dans Contact pour discuter.' : 'En attente de son acceptation.')];
  }
  ensureFeed(pid);
  if (unreadFriend(f, me)) markFriendRead(me, pid);

  const other = friendOf(f, me);
  const name = f.names?.[other] || 'Ami';
  const act = state.friendActivity[other];

  const header = PageHeader({
    eyebrow: 'Ami', title: name,
    trailing: h('div', { class: 'row-gap' },
      Avatar({ uid: other, name }),
      IconButton('more', 'Options', () => actionSheet({
        title: name,
        actions: [{ label: 'Retirer de mes amis', icon: 'trash', danger: true, onClick: async () => {
          const ok = await confirmSheet({ title: `Retirer ${name} ?`, message: 'Votre discussion ne sera plus accessible.', confirmLabel: 'Retirer' });
          if (ok) { await removeFriend(pid); location.hash = '#/contact'; }
        } }],
      }), 'icon-btn--soft'),
      back),
  });

  if (messages === null) return [header, Skeleton(2)];
  if (messages.length !== lastCount) { scrollToEnd(lastCount > 0); lastCount = messages.length; }
  drafts[pid] = drafts[pid] || { text: '' };

  return [
    header,
    trainedToday(act)
      ? h('p', { class: 'friend-status' }, icon('dumbbell', 16), `S’est entraîné aujourd’hui${act.sessionName ? ` · ${act.sessionName}` : ''}`)
      : null,
    messages.length ? Thread(messages, me) : h('p', { class: 'muted center' }, `Commence la discussion avec ${name}.`),
    h('div', { class: 'composer-spacer' }),
    Composer({ id: `friend-input-${pid}`, draft: drafts[pid], placeholder: 'Message…', onSend: (t) => sendFriendMessage(me, pid, t) }),
  ];
}
