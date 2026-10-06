/**
 * Fil des amis : records et musiques partagés, « likables ».
 * Utilisé par le widget Amis de l'accueil et par l'onglet Contact.
 */
import { h } from '../lib/dom.js';
import { frNum } from '../lib/dates.js';
import { state, ensureExlogs } from '../store.js';
import { toggleLike, sharePR, shareMusic, detectMusic, musicTargets, MUSIC_SERVICES } from '../data/posts.js';
import { ms } from '../data/messages.js';
import { shortWhen } from './chat.js';
import { Avatar } from './avatar.js';
import { icon } from './icons.js';
import { formSheet, openSheet, actionSheet } from './sheet.js';
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

/** Sons conseillés : la dernière musique partagée par chacun (amis + moi), récente d'abord. */
export function recentMusic(days = 14, max = 3) {
  const since = Date.now() - days * 86400000;
  return Object.entries(state.friendActivity)
    .map(([uid, a]) => {
      // Re-vérification du lien (défense en profondeur) : jamais de lien arbitraire.
      const m = a?.lastMusic?.url ? detectMusic(a.lastMusic.url) : null;
      return m ? { ...a.lastMusic, url: m.url, service: m.service, owner: uid, name: String(a.name || 'Ami'), partial: true } : null;
    })
    .filter((p) => p && ms(p.at) > since)
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

/**
 * Choix de l'app pour écouter un son : Spotify, Deezer ou YouTube Music.
 * Vrais liens <a> (et non window.open après coup) : sur iPhone, l'ouverture
 * doit partir directement du toucher, sinon Safari la bloque.
 */
export function openMusic(m) {
  const who = m.owner === state.me?.uid ? 'toi' : String(m.name || 'un ami').split(' ')[0];
  let sheet = null;
  const rows = musicTargets(m).map((t) => h('a', {
    class: `action music-open music-open--${t.key}`, href: t.href, target: '_blank', rel: 'noopener noreferrer',
    onclick: () => setTimeout(() => sheet?.close(), 300),
  },
  h('span', { class: 'music-open__dot', 'aria-hidden': 'true' }, icon('play', 14)),
  h('span', { class: 'music-open__label' }, t.label,
    h('span', { class: 'music-open__sub' }, t.original ? 'Lien partagé' : 'Recherche du titre')),
  icon('external', 16)));
  sheet = openSheet({
    title: m.title || 'Écouter le son',
    subtitle: `Conseillé par ${who}. Ouvrir avec :`,
    body: h('div', { class: 'action-list' }, rows,
      m.title ? null : h('p', { class: 'hint' }, 'Sans titre, seul le lien d’origine est disponible.')),
  });
}

export function PostRow(post, me) {
  const who = post.owner === me ? 'Toi' : String(post.name || 'Ami').split(' ')[0];
  const head = h('span', { class: 'record__who' }, who, h('span', { class: 'record__when' }, ` · ${shortWhen(post.at)}`));

  if (post.type === 'music') {
    const ok = detectMusic(post.url);
    if (!ok) return null;                       // lien non conforme : ignoré
    post = { ...post, url: ok.url, service: ok.service };
    const svc = MUSIC_SERVICES[post.service]?.label || 'Musique';
    return h('li', { class: 'record record--music' },
      Avatar({ uid: post.owner, name: post.name, size: 'sm' }),
      h('button', { class: 'record__body record__link', type: 'button', onclick: () => openMusic(post) },
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
    subtitle: 'Dans Spotify, Deezer, YouTube Music ou Apple Music : Partager › Copier le lien, puis colle-le ici.',
    fields: [
      { name: 'url', type: 'url', label: 'Lien du titre / de la playlist', required: true, maxlength: 400, placeholder: 'https://open.spotify.com/track/…', inputmode: 'url' },
      // Titre obligatoire : il permet à tes amis d'ouvrir le son sur LEUR app (recherche).
      { name: 'title', label: 'Artiste – Titre', required: true, maxlength: 120, placeholder: 'Ex. Kanye West – Power' },
    ],
    submitLabel: 'Partager à mes amis',
  });
  if (!r?.values) return;
  const m = detectMusic(r.values.url);
  if (!m) { toast('Lien non reconnu : Spotify, Deezer, YouTube Music ou Apple Music uniquement.', { type: 'error', duration: 5000 }); return; }
  if (!state.me) return;
  shareMusic(state.me, { ...m, title: r.values.title });
}

// ── Partager un record (widget Amis de l'accueil) ───────────────────────

const e1rm = (w, r) => (r <= 1 ? w : w * (1 + r / 30));
const kg = (w) => frNum(w, w % 1 ? 1 : 0);

/** Meilleure série (1RM estimé) de chaque exercice du carnet, les plus récents d'abord. */
function bestSets() {
  const names = {};
  for (const prog of Object.values(state.workouts || {})) {
    for (const s of prog?.sessions || []) for (const e of s.exercises || []) names[e.id] ||= e.n;
  }
  return Object.entries(state.exlogs || {})
    .filter(([eid, arr]) => names[eid] && arr?.length)
    .map(([eid, arr]) => {
      const best = arr.reduce((b, x) => (e1rm(x.w, x.r) > e1rm(b.w, b.r) ? x : b), arr[0]);
      return { eid, name: names[eid], w: best.w, r: best.r, last: Math.max(...arr.map((x) => x.ts || 0)) };
    })
    .sort((a, b) => b.last - a.last)
    .slice(0, 10);
}

async function manualPR() {
  const r = await formSheet({
    title: 'Partager un record',
    fields: [
      { name: 'exercise', label: 'Exercice', required: true, maxlength: 120, placeholder: 'Ex. Squat' },
      { type: 'row', fields: [
        { name: 'w', type: 'number', label: 'Charge (kg)', required: true, min: 0.5, max: 999, inputmode: 'decimal' },
        { name: 'r', type: 'number', label: 'Répétitions', required: true, min: 1, max: 100, integer: true, inputmode: 'numeric' },
      ] },
    ],
    submitLabel: 'Partager à mes amis',
  });
  if (r?.values && state.me) sharePR(state.me, r.values);
}

/** Choix de l'exercice (meilleure série pré-remplie) ou saisie libre. */
export async function sharePRFlow() {
  if (!state.me) return;
  // Carnet chargé à la demande (3 s max : hors ligne, on propose la saisie libre).
  await Promise.race([ensureExlogs(), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
  const sets = bestSets();
  actionSheet({
    title: 'Partager un record',
    subtitle: sets.length ? 'Ta meilleure série par exercice (1RM estimé). Tes amis la verront sur leur accueil.' : 'Aucune charge notée pour l’instant : saisis ton record.',
    actions: [
      ...sets.map((x) => ({
        label: `${x.name} · ${kg(x.w)} kg × ${x.r}`, icon: 'up',
        onClick: () => sharePR(state.me, { exercise: x.name, w: x.w, r: x.r }),
      })),
      { label: 'Autre record (saisie libre)', icon: 'edit', onClick: manualPR },
    ],
  });
}
