/**
 * Records partagés : activity/{uid}/posts/{id}
 *   { type: 'pr', name, exercise, w, r, e1rm, at, likes: [uid…] }
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

/** 5 derniers records d'un utilisateur. */
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
