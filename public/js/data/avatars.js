/**
 * Photos de profil : avatars/{uid} = { img: 'data:image/jpeg;base64,…', at }.
 * Lecture : soi-même, ses amis, l'admin (cf. firestore.rules).
 * Cache mémoire : une seule lecture par utilisateur et par session.
 */
import { db, fs } from '../firebase.js';

const { doc, getDoc, setDoc, deleteDoc, serverTimestamp } = fs;

const cache = new Map(); // uid → string | null | Promise

const rerender = () => window.dispatchEvent(new Event('app:render'));

/** Image d'un utilisateur si déjà connue ; déclenche le chargement sinon. */
export function avatarOf(uid) {
  if (!uid) return null;
  const v = cache.get(uid);
  if (typeof v === 'string' || v === null) return v;
  if (!v) {
    cache.set(uid, getDoc(doc(db, 'avatars', uid))
      .then((snap) => { cache.set(uid, snap.exists() ? snap.data().img : null); rerender(); })
      .catch(() => cache.set(uid, null)));
  }
  return null;
}

/** Enregistre MA photo (JPEG carré déjà recadré, en data URL). */
export async function uploadMyAvatar(uid, img) {
  if (!/^data:image\/jpeg;base64,/.test(img) || img.length >= 150000) throw new Error('Image invalide.');
  await setDoc(doc(db, 'avatars', uid), { img, at: serverTimestamp() });
  cache.set(uid, img);
  rerender();
}

export async function removeMyAvatar(uid) {
  await deleteDoc(doc(db, 'avatars', uid));
  cache.set(uid, null);
  rerender();
}
