/**
 * Fond animé : étoiles filantes + quelques étoiles qui scintillent.
 *
 * Léger : ~5 traînées + ~18 points, animés en CSS (transform / opacity,
 * accélérés par le GPU). Le JavaScript n'intervient qu'à la fin de chaque
 * passage, pour replacer l'étoile filante ailleurs (trajectoire aléatoire).
 * En pause quand l'app passe en arrière-plan ; rien ne bouge si « Réduire les
 * animations » est activé ; désactivable dans Moi › Liens & réglages.
 */
const KEY = 'fxAmbient';
const SHOOTERS = 5;
const DOTS = 18;

export const ambientEnabled = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
/** Activé volontairement dans Moi → affiché même si « Réduire les animations » est actif. */
const forced = () => { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } };

let el = null;
const rand = (a, b) => a + Math.random() * (b - a);

/** Nouvelle trajectoire : départ en haut / à droite, descente vers le bas-gauche. */
function launch(s, first = false) {
  s.style.top = `${rand(-10, 55).toFixed(1)}%`;
  s.style.left = `${rand(25, 110).toFixed(1)}%`;
  s.style.setProperty('--len', `${Math.round(rand(90, 170))}px`);
  s.style.animationDuration = `${rand(1.1, 1.9).toFixed(2)}s`;
  // Pause aléatoire entre deux passages (le délai ne s'applique qu'au redémarrage).
  s.style.animationDelay = `${rand(first ? 0.5 : 2.5, first ? 9 : 11).toFixed(2)}s`;
  s.style.animationName = 'none';
  void s.offsetWidth;                 // relance l'animation
  s.style.animationName = '';
}

export function initAmbient() {
  if (el || !ambientEnabled()) return;
  el = document.createElement('div');
  el.className = `ambient${forced() ? ' ambient--force' : ''}`;
  el.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < DOTS; i += 1) {
    const d = document.createElement('span');
    d.className = 'ambient__dot';
    d.style.top = `${rand(2, 98).toFixed(1)}%`;
    d.style.left = `${rand(2, 98).toFixed(1)}%`;
    d.style.animationDelay = `${rand(0, 6).toFixed(2)}s`;
    d.style.animationDuration = `${rand(3, 7).toFixed(2)}s`;
    if (Math.random() < 0.3) d.classList.add('ambient__dot--lg');
    el.appendChild(d);
  }
  for (let i = 0; i < SHOOTERS; i += 1) {
    const s = document.createElement('span');
    s.className = 'ambient__star';
    s.addEventListener('animationend', () => launch(s));
    launch(s, true);
    el.appendChild(s);
  }
  document.body.prepend(el);
  document.addEventListener('visibilitychange', onVis);
}

function onVis() {
  el?.classList.toggle('ambient--paused', document.visibilityState !== 'visible');
}

export function setAmbient(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* indisponible */ }
  if (on) { el?.remove(); el = null; initAmbient(); }
  else { el?.remove(); el = null; document.removeEventListener('visibilitychange', onVis); }
}
