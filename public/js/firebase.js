/**
 * Initialisation Firebase — point d'entrée UNIQUE vers le SDK.
 * Les autres modules importent `auth` et `db` d'ici, jamais du CDN directement,
 * pour garantir une seule version du SDK dans toute l'app.
 *
 * Note : cette configuration n'est pas secrète (elle identifie le projet).
 * La sécurité des données repose sur firestore.rules.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, setPersistence,
  indexedDBLocalPersistence, browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// Ré-export des SDK : les autres modules importent d'ici (une seule version).
export * as authSdk from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
export * as fs from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBje3KcOzf7aeFzL-kvca5D2lv7WDgtIlM',
  authDomain: 'anabolic-adc6a.firebaseapp.com',
  projectId: 'anabolic-adc6a',
  storageBucket: 'anabolic-adc6a.firebasestorage.app',
  messagingSenderId: '297929048136',
  appId: '1:297929048136:web:0bba6528cf6525c07bd87d',
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
auth.languageCode = 'fr';

// IndexedDB : persistance fiable en PWA iOS (écran d'accueil).
try {
  await setPersistence(auth, indexedDBLocalPersistence);
} catch {
  await setPersistence(auth, browserLocalPersistence).catch(() => {});
}

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

/**
 * Cache Firestore persistant (IndexedDB) :
 *  • ouverture quasi instantanée (données servies depuis le cache),
 *  • écritures hors ligne mises en file puis synchronisées au retour du réseau.
 * Repli sur le cache mémoire si IndexedDB est indisponible (navigation privée).
 */
function createDb() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (err) {
    console.warn('[firebase] cache persistant indisponible, repli mémoire', err);
    return initializeFirestore(app, {});
  }
}
export const db = createDb();
