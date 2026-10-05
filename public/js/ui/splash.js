/**
 * Animation d'ouverture.
 *
 *  • Lancement à froid : le logo (déjà animé par le CSS en ligne d'index.html)
 *    reste au moins MIN_MS, puis s'efface dès que la session est connue.
 *  • Retour dans l'app après AWAY_MS d'absence : l'animation est rejouée et
 *    l'app revient sur l'accueil (comme une réouverture).
 */
const MIN_MS = 1500;
const OUT_MS = 500;
const AWAY_MS = 30 * 60 * 1000;

const el = () => document.getElementById('splash');
let shownAt = performance.now();
let hiddenAt = null;

/** Masque le splash en respectant la durée minimale de l'animation. */
export function hideSplash() {
  const s = el();
  if (!s || s.classList.contains('splash--out')) return;
  const wait = Math.max(0, MIN_MS - (performance.now() - shownAt));
  setTimeout(() => s.classList.add('splash--out'), wait);
}

/** Rejoue l'animation (retour après une longue absence). */
export function replaySplash(onShown) {
  const s = el();
  if (!s) return;
  // Redémarre les animations CSS en recréant les nœuds animés.
  s.querySelectorAll('.splash__logo, .splash__line span').forEach((n) => n.replaceWith(n.cloneNode(true)));
  s.classList.remove('splash--out');
  shownAt = performance.now();
  onShown?.();
  hideSplash();
}

/** Active la relecture au retour dans l'app. */
export function watchResume(onResume) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) replaySplash(onResume);
    hiddenAt = null;
  });
}

export const SPLASH_OUT_MS = OUT_MS;
