/**
 * Fil des amis : records et musiques partagés, « likables ».
 * Utilisé par le widget Amis de l'accueil et par l'onglet Contact.
 */
import { h } from '../lib/dom.js';
import { frNum } from '../lib/dates.js';
import { state } from '../store.js';
import { toggleLike, shareMusic, detectMusic, MUSIC_SERVICES } from '../data/posts.js';
import { ms } from '../data/messages.js';
import { shortWhen } from './chat.js';
import { Avatar } from './avatar.js';
import { icon } from './icons.js';
import { formSheet } from './sheet.js';
import { toast } from './toast.js';

/**
 * Publications récentes de mes amis et moi (plus récentes d'abord).
 * Hors de l'onglet Contact, on se contente de la DERNIÈRE publication de chacun,
 * recopiée dans son document d'activité (aucune lecture supplémentaire).
 */
export function recentPosts(days = 7, max = 5) {
  const since = Date.now() - days * 86400000;
  const all = state.postsFeed
    ? Object.values(state.posts).flat()
    : Object.entries(state.friendActivity)
      .filter(([, a]) => a?.lastPost?.id)
      .map(([uid, a]) => ({ ...a.lastPost, owner: uid, name: a.name, partial: true }));
  return all
    .filter((p) => ms(p.at) > since)
    .sort((a, b) => ms(b.at) - ms(a.at))
    .slice(0, max);
}

function LikeButton(post, me) {
  // Aperçu (dernière publication recopiée) : les likes se gèrent dans Contact.
  if (post.partial) return h('a', { class: 'like like--static', href: '#/contact', 'aria-label': 'Voir et liker dans Contact' }, icon('heart', 18));
  const mine = post.owner === me;
  const liked = (post.likes || []).includes(me);
  const n = (post.likes || []).length;
  return mine
    ? h('span', { class: `like like--static${n ? ' like--on' : ''}`, 'aria-label': `${n} like${n > 1 ? 's' : ''}` }, icon('heart', 18), n ? String(n) : '')
    : h('button', {
      class: `like${liked ? ' like--on' : ''}`, type: 'button', 'aria-pressed': String(liked),
      'aria-label': liked ? 'Retirer mon like' : 'Liker',
      onclick: (e) => { e.currentTarget.classList.toggle('like--on'); e.currentTarget.classList.add('like--pop'); toggleLike(me, post); },
    }, icon('heart', 18), n ? String(n) : '');
}

export function PostRow(post, me) {
  const who = post.owner === me ? 'Toi' : String(post.name || 'Ami').split(' ')[0];
  const head = h('span', { class: 'record__who' }, who, h('span', { class: 'record__when' }, ` · ${shortWhen(post.at)}`));

  if (post.type === 'music') {
    const svc = MUSIC_SERVICES[post.service]?.label || 'Musique';
    return h('li', { class: 'record record--music' },
      Avatar({ uid: post.owner, name: post.name, size: 'sm' }),
      // Lien universel : ouvre Spotify / Deezer / Apple Music si l'app est installée.
      h('a', { class: 'record__body record__link', href: post.url, target: '_blank', rel: 'noopener noreferrer' },
        head,
        h('span', { class: 'record__what' },
          h('span', { class: `music-tag music-tag--${post.service}` }, icon('music', 12), svc),
          ' ', post.title || 'Écouter le son')),
      LikeButton(post, me));
  }

  return h('li', { class: 'record' },
    Avatar({ uid: post.owner, name: post.name, size: 'sm' }),
    h('span', { class: 'record__body' },
      head,
      h('span', { class: 'record__what' }, '🏆 ', post.exercise, ' · ', h('strong', {}, `${frNum(post.w, post.w % 1 ? 1 : 0)} kg × ${post.r}`))),
    LikeButton(post, me));
}

/** Partage d'un son : lien collé depuis Spotify / Deezer / Apple Music (bouton Partager › Copier le lien). */
export async function shareMusicFlow() {
  const r = await formSheet({
    title: 'Partager un son',
    subtitle: 'Dans Spotify, Deezer ou Apple Music : Partager › Copier le lien, puis colle-le ici.',
    fields: [
      { name: 'url', type: 'url', label: 'Lien du titre / de la playlist', required: true, maxlength: 400, placeholder: 'https://open.spotify.com/track/…', inputmode: 'url' },
      { name: 'title', label: 'Titre (optionnel)', maxlength: 120, placeholder: 'Artiste – Titre, ou « Ma playlist séance jambes »' },
    ],
    submitLabel: 'Partager à mes amis',
  });
  if (!r?.values) return;
  const m = detectMusic(r.values.url);
  if (!m) { toast('Lien non reconnu : Spotify, Deezer ou Apple Music uniquement.', { type: 'error', duration: 5000 }); return; }
  if (!state.me) return;
  shareMusic(state.me, { ...m, title: r.values.title });
}
