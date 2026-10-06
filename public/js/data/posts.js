/**
 * Publications partagées avec les amis : activity/{uid}/posts/{id}
 *   record  : { type: 'pr', name, exercise, w, r, e1rm, at, likes: [uid…] }
 *   musique : { type: 'music', name, url, title, service, at, likes: [uid…] }
 * Visibles et « likables » par les amis (cf. firestore.rules).
 */
import { db, fs } from '../firebase.js';
import { toast } from '../ui/toast.js';

const { doc, collection, query, orderBy, limit, onSnapshot, setDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove, serverTimestamp } = fs;

const e1rm = (w, r) => (r <= 1 ? w : w * (1 + r / 30));

export function sharePR(me, { exercise, w, r }) {
  return setDoc(doc(collection(db, 'activity', me.uid, 'posts')), {
    type: 'pr',
    name: (me.displayName || 'Utilisateur').slice(0, 120),
    exercise: String(exercise).slice(0, 120),
    w: Math.round(w * 10) / 10,
    r: Math.round(r),
    e1rm: Math.round(e1rm(w, r)),
    at: serverTimestamp(),
    likes: [],
  }).then(() => toast('Record partagé avec tes amis 🏆'))
    .catch((err) => { console.error(err); toast('Partage impossible.', { type: 'error' }); });
}

// ── Musique ─────────────────────────────────────────────────────────────

/** Services reconnus : le lien universel ouvre directement l'app installée. */
export const MUSIC_SERVICES = {
  spotify: { label: 'Spotify',     hosts: ['open.spotify.com', 'spotify.link'] },
  deezer:  { label: 'Deezer',      hosts: ['www.deezer.com', 'deezer.com', 'deezer.page.link', 'link.deezer.com'] },
  apple:   { label: 'Apple Music', hosts: ['music.apple.com'] },
};

/**
 * Valide un lien de partage musical. Accepte un texte collé contenant le lien
 * (ex. « Écoute ce titre sur Deezer : https://… »).
 * @returns {{ url: string, service: string } | null}
 */
export function detectMusic(text) {
  const m = String(text || '').match(/https:\/\/[^\s<>"']+/i);
  if (!m) return null;
  let u;
  try { u = new URL(m[0]); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const service = Object.keys(MUSIC_SERVICES).find((k) => MUSIC_SERVICES[k].hosts.includes(host));
  if (!service) return null;
  const url = u.toString();
  return url.length <= 300 ? { url, service } : null;
}

export function shareMusic(me, { url, service, title }) {
  return setDoc(doc(collection(db, 'activity', me.uid, 'posts')), {
    type: 'music',
    name: (me.displayName || 'Utilisateur').slice(0, 120),
    url,
    service,
    title: String(title || '').trim().slice(0, 120),
    at: serverTimestamp(),
    likes: [],
  }).then(() => toast('Son partagé avec tes amis 🎵'))
    .catch((err) => { console.error(err); toast('Partage impossible.', { type: 'error' }); });
}

/** 5 dernières publications d'un utilisateur. */
export function watchPosts(uid, cb) {
  const q = query(collection(db, 'activity', uid, 'posts'), orderBy('at', 'desc'), limit(5));
  return onSnapshot(q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, owner: uid, ...d.data({ serverTimestamps: 'estimate' }) }))),
    () => cb([]));
}

export function toggleLike(meUid, post) {
  const liked = (post.likes || []).includes(meUid);
  return updateDoc(doc(db, 'activity', post.owner, 'posts', post.id), { likes: liked ? arrayRemove(meUid) : arrayUnion(meUid) })
    .catch((err) => { console.error(err); toast('Action impossible.', { type: 'error' }); });
}

export function deletePost(meUid, post) {
  return deleteDoc(doc(db, 'activity', meUid, 'posts', post.id)).catch(() => {});
}
