/**
 * Contact — conversation de l'utilisateur avec l'administrateur (coach).
 */
import { h } from '../lib/dom.js';
import { state } from '../store.js';
import { watchMessages, sendUserMessage, markReadByUser, unreadForUser } from '../data/messages.js';
import { PageHeader, IconButton, Skeleton } from '../ui/layout.js';
import { Thread, Composer, scrollToEnd } from '../ui/chat.js';
import { icon } from '../ui/icons.js';

// État de l'écran (persiste entre deux rendus).
let feed = null;          // { uid, unsub }
let messages = null;      // null = chargement
let lastCount = 0;
const draft = { text: '' };

function ensureFeed(uid) {
  if (feed?.uid === uid) return;
  leaveContact();
  messages = null;
  feed = {
    uid,
    unsub: watchMessages(uid, (list) => {
      messages = list;
      window.dispatchEvent(new Event('app:render'));
    }),
  };
}

/** Appelé par le routeur quand on quitte l'écran. */
export function leaveContact() {
  feed?.unsub?.();
  feed = null;
  messages = null;
  lastCount = 0;
}

export function ContactView(session) {
  const uid = session.user.uid;
  ensureFeed(uid);

  // Ouvrir l'écran = lire la réponse.
  if (unreadForUser(state.conversation)) markReadByUser(uid);

  const header = PageHeader({
    eyebrow: 'Ton coach', title: 'Contact',
    trailing: IconButton('back', 'Retour', () => { location.hash = '#/me'; }, 'icon-btn--soft'),
  });

  if (messages === null) return [header, Skeleton(2)];

  // Défilement en bas à l'ouverture et à chaque nouveau message.
  if (messages.length !== lastCount) { scrollToEnd(lastCount > 0); lastCount = messages.length; }

  const intro = messages.length ? null : h('section', { class: 'card contact-intro' },
    h('div', { class: 'empty__icon' }, icon('message', 26)),
    h('p', { class: 'card__title' }, 'Écris à ton coach'),
    h('p', { class: 'card__text' },
      'Une question sur ton programme, ta diet ou ton protocole ? La réponse arrivera ici, et un badge te préviendra.'));

  const status = state.conversation?.status === 'done' && messages.length
    ? h('p', { class: 'thread__day' }, 'Conversation marquée comme traitée — écris pour la rouvrir')
    : null;

  return [
    header,
    intro,
    Thread(messages, 'user'),
    status,
    h('div', { class: 'composer-spacer' }),
    Composer({
      id: 'contact-input', draft, placeholder: 'Écrire un message…',
      onSend: (text) => sendUserMessage(session.user, text),
    }),
  ];
}
