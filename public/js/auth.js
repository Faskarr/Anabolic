/**
 * Session utilisateur : connexion, profil racine users/{uid}, rôle admin, statut.
 *
 * Expose `onSession(cb)` qui notifie un objet unique :
 *   { state: 'loading' | 'signed-out' | 'active' | 'disabled' | 'error',
 *     user, profile, isAdmin, error }
 */
import { auth, db, googleProvider, authSdk, fs } from './firebase.js';

const { signInWithPopup, signOut: fbSignOut, onAuthStateChanged, browserPopupRedirectResolver } = authSdk;
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
    // Résolveur passé ici (et non à l'initialisation) : l'iframe Google n'est chargée qu'à la connexion.
    await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
  } catch (err) {
    // Fermeture volontaire de la fenêtre : pas une erreur.
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
    throw new Error(AUTH_ERRORS[err.code] || `Connexion impossible (${err.code || err.message}).`);
  }
}

export function signOut() {
  clearLocalSession();
  return fbSignOut(auth);
}

/** Efface tout ce que l'app garde sur l'appareil pour un démarrage rapide. */
export function clearLocalSession() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k === 'lastUid' || k === 'dietCalc' || k.startsWith('session:') || k.startsWith('snap:')) localStorage.removeItem(k);
    }
  } catch { /* stockage indisponible */ }
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
  // Rafraîchit nom/photo Google et la dernière activité (sans bloquer l'UI),
  // au plus une fois toutes les 6 h (une écriture par ouverture, c'était beaucoup).
  const stampKey = `activeStamp:${user.uid}`;
  let fresh = false;
  try { fresh = Date.now() - Number(localStorage.getItem(stampKey) || 0) < 6 * 3600e3; } catch { /* ignoré */ }
  const changed = (user.displayName && user.displayName !== profile.displayName) || (user.photoURL && user.photoURL !== profile.photoURL);
  if (profile.status === 'active' && (!fresh || changed)) {
    try { localStorage.setItem(stampKey, String(Date.now())); } catch { /* ignoré */ }
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

/**
 * Démarrage rapide : la dernière session vérifiée est gardée sur l'appareil.
 * À l'ouverture, l'app s'affiche tout de suite avec elle, pendant que le profil
 * et le rôle admin sont revérifiés en arrière-plan auprès de Firestore (si le
 * compte a été désactivé entre-temps, l'écran change dès la réponse).
 * La sécurité ne dépend pas de ce cache : les règles Firestore décident.
 */
const SESSION_KEY = (uid) => `session:${uid}`;
function readCachedSession(uid) {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY(uid))); } catch { return null; }
}
function writeCachedSession(uid, s) {
  try {
    localStorage.setItem('lastUid', uid);
    localStorage.setItem(SESSION_KEY(uid), JSON.stringify({
      at: Date.now(),
      user: { uid, displayName: s.user?.displayName || '', email: s.user?.email || '', photoURL: s.user?.photoURL || '' },
      isAdmin: Boolean(s.isAdmin),
      profile: {
        status: s.profile?.status || 'active',
        displayName: s.profile?.displayName || '',
        photoURL: s.profile?.photoURL || '',
        friendCode: s.profile?.friendCode || null,
      },
    }));
  } catch { /* stockage indisponible */ }
}

export function onSession(callback) {
  // 1. Démarrage instantané : dernière session connue sur cet appareil, affichée
  //    AVANT que Firebase Auth ait fini de s'initialiser (qui demande du réseau).
  let provisional = null;
  try {
    const uid = localStorage.getItem('lastUid');
    const c = uid && readCachedSession(uid);
    if (c?.user?.uid === uid && c.profile?.status === 'active') provisional = c;
  } catch { /* stockage indisponible */ }
  if (provisional) {
    callback({ state: 'active', user: provisional.user, profile: provisional.profile, isAdmin: provisional.isAdmin, provisional: true });
  } else {
    callback({ state: 'loading' });
  }

  // 2. Confirmation par Firebase Auth, puis revérification du profil.
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      clearLocalSession();
      callback({ state: 'signed-out' });
      return;
    }
    const cached = readCachedSession(user.uid);
    if (cached?.profile?.status === 'active') {
      callback({ state: 'active', user, profile: cached.profile, isAdmin: cached.isAdmin, cached: true });
    }
    try {
      const [{ profile, created }, { isAdmin, adminError }] = await Promise.all([
        ensureProfile(user),
        checkAdmin(user.uid),
      ]);
      // Vérification admin impossible (réseau) : on garde le rôle connu au lieu de le retirer.
      const admin = adminError ? Boolean(cached?.isAdmin) : isAdmin;
      const verified = {
        state: profile.status === 'disabled' ? 'disabled' : 'active',
        user, profile, isAdmin: admin, adminError, created,
      };
      writeCachedSession(user.uid, verified);
      // Déjà affiché depuis le cache et rien n'a changé : pas de nouveau rendu,
      // mais le profil affiché reçoit les champs à jour (code ami…).
      if (cached && verified.state === 'active' && cached.isAdmin === admin) {
        Object.assign(cached.profile, { friendCode: profile.friendCode || null, displayName: profile.displayName || '' });
        return;
      }
      callback(verified);
    } catch (error) {
      console.error('[auth] session', error);
      if (!cached) callback({ state: 'error', user, error });   // hors ligne : on garde la session en cache
    }
  });
}
