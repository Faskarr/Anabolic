/**
 * Session utilisateur : connexion, profil racine users/{uid}, rôle admin, statut.
 *
 * Expose `onSession(cb)` qui notifie un objet unique :
 *   { state: 'loading' | 'signed-out' | 'active' | 'disabled' | 'error',
 *     user, profile, isAdmin, error }
 */
import { auth, db, googleProvider, authSdk, fs } from './firebase.js';

const { signInWithPopup, signOut: fbSignOut, onAuthStateChanged } = authSdk;
const { doc, getDoc, setDoc, updateDoc, serverTimestamp } = fs;

/** Messages d'erreur Firebase traduits pour l'utilisateur. */
const AUTH_ERRORS = {
  'auth/popup-blocked': 'La fenêtre de connexion a été bloquée. Autorise les pop-ups pour ce site dans Réglages › Safari.',
  'auth/network-request-failed': 'Pas de connexion internet. Réessaie dans un instant.',
  'auth/unauthorized-domain': "Ce domaine n'est pas autorisé dans Firebase Authentication.",
  'auth/too-many-requests': 'Trop de tentatives. Patiente quelques minutes.',
};

export async function signIn() {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    // Fermeture volontaire de la fenêtre : pas une erreur.
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
    throw new Error(AUTH_ERRORS[err.code] || `Connexion impossible (${err.code || err.message}).`);
  }
}

export function signOut() {
  return fbSignOut(auth);
}

/**
 * Crée users/{uid} au premier login, sinon met à jour lastActiveAt.
 * Les champs envoyés correspondent EXACTEMENT à ce qu'autorisent les règles.
 */
async function ensureProfile(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const profile = {
      displayName: (user.displayName || '').slice(0, 120),
      email: user.email,
      photoURL: user.photoURL || '',
      createdAt: serverTimestamp(),
      lastActiveAt: serverTimestamp(),
      status: 'active',
    };
    await setDoc(ref, profile);
    return { profile: { ...profile, status: 'active' }, created: true };
  }

  const profile = snap.data();
  if (profile.status === 'active') {
    // Rafraîchit nom/photo Google et la dernière activité (sans bloquer l'UI).
    updateDoc(ref, {
      displayName: (user.displayName || profile.displayName || '').slice(0, 120),
      photoURL: user.photoURL || profile.photoURL || '',
      lastActiveAt: serverTimestamp(),
    }).catch((err) => console.warn('[auth] lastActiveAt', err));
  }
  return { profile, created: false };
}

/** Lit admins/{uid}. Renvoie l'erreur au lieu de l'avaler (diagnostic). */
async function checkAdmin(uid) {
  try {
    return { isAdmin: (await getDoc(doc(db, 'admins', uid))).exists(), adminError: null };
  } catch (err) {
    console.warn('[auth] admin check', err);
    return { isAdmin: false, adminError: err.code || err.message };
  }
}

export function onSession(callback) {
  callback({ state: 'loading' });

  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback({ state: 'signed-out' });
      return;
    }
    try {
      const [{ profile, created }, { isAdmin, adminError }] = await Promise.all([
        ensureProfile(user),
        checkAdmin(user.uid),
      ]);
      callback({
        state: profile.status === 'disabled' ? 'disabled' : 'active',
        user, profile, isAdmin, adminError, created,
      });
    } catch (error) {
      console.error('[auth] session', error);
      callback({ state: 'error', user, error });
    }
  });
}
