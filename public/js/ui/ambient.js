/**
 * Fond animé : trois halos de couleur qui dérivent lentement derrière l'app
 * (bordeaux / gris / encre ; violet en mode sombre).
 *
 * Léger : 3 éléments en CSS pur, animés uniquement en transform (accéléré par
 * le GPU, aucun JavaScript par image), dégradés radiaux sans filtre de flou.
 * Mis en pause quand l'app passe en arrière-plan ; figé si « Réduire les
 * animations » est activé ; désactivable dans Moi › Liens & réglages.
 */
const KEY = 'fxAmbient';

export const ambientEnabled = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };

let el = null;

export function initAmbient() {
  if (el || !ambientEnabled()) return;
  el = document.createElement('div');
  el.className = 'ambient';
  el.setAttribute('aria-hidden', 'true');
  for (const k of ['a', 'b', 'c']) {
    const blob = document.createElement('span');
    blob.className = `ambient__blob ambient__blob--${k}`;
    el.appendChild(blob);
  }
  document.body.prepend(el);
  document.addEventListener('visibilitychange', onVis);
}

function onVis() {
  el?.classList.toggle('ambient--paused', document.visibilityState !== 'visible');
}

export function setAmbient(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* indisponible */ }
  if (on) initAmbient();
  else { el?.remove(); el = null; document.removeEventListener('visibilitychange', onVis); }
}
