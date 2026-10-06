/**
 * Carte « Installer l'app sur l'écran d'accueil ».
 *
 * Affichée seulement si l'app tourne dans le navigateur (pas déjà installée).
 *  • iPhone / iPad (Safari) : pas d'installation automatique possible →
 *    instructions pas à pas (Partager › Sur l'écran d'accueil › Ajouter).
 *  • Android / Chrome / Edge : bouton « Installer » (beforeinstallprompt).
 * « Plus tard » la masque 7 jours (préférence locale à l'appareil).
 */
import { h } from '../lib/dom.js';
import { icon } from './icons.js';

const KEY = 'installHiddenUntil';
let deferred = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();            // on garde l'invite pour notre bouton
  deferred = e;
  window.dispatchEvent(new Event('app:render'));
});
window.addEventListener('appinstalled', () => { deferred = null; window.dispatchEvent(new Event('app:render')); });

export const isStandalone = () => window.navigator.standalone === true
  || window.matchMedia('(display-mode: standalone)').matches;

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isIOSNonSafari = () => isIOS() && /crios|fxios|edgios|gsa\//i.test(navigator.userAgent);

function hidden() {
  try { return Number(localStorage.getItem(KEY) || 0) > Date.now(); } catch { return false; }
}
function hideFor(days) {
  try { localStorage.setItem(KEY, String(Date.now() + days * 86400000)); } catch { /* indisponible */ }
  window.dispatchEvent(new Event('app:render'));
}

/** @param {{ compact?: boolean, force?: boolean }} opts  compact = écran de connexion */
export function InstallCard({ compact = false, force = false } = {}) {
  if (isStandalone() || (!force && hidden())) return null;

  const step = (n, ...content) => h('li', { class: 'install__step' }, h('span', { class: 'install__n' }, String(n)), h('span', {}, ...content));

  let body;
  if (deferred) {
    body = h('button', {
      class: 'btn btn--primary btn--block', type: 'button',
      onclick: async () => { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; window.dispatchEvent(new Event('app:render')); },
    }, icon('download', 18), 'Installer l’app');
  } else if (isIOS()) {
    body = h('ol', { class: 'install__steps' },
      isIOSNonSafari() ? step('!', 'Ouvre cette page dans ', h('strong', {}, 'Safari'), ' (obligatoire sur iPhone).') : null,
      step(1, 'Touche ', h('span', { class: 'install__key' }, icon('share', 15), 'Partager'), ' dans la barre de Safari.'),
      step(2, 'Fais défiler et choisis ', h('strong', {}, 'Sur l’écran d’accueil'), '.'),
      step(3, 'Touche ', h('strong', {}, 'Ajouter'), ' : AnabolicOS s’ouvre en plein écran, comme une app.'));
  } else {
    body = h('ol', { class: 'install__steps' },
      step(1, 'Ouvre le menu du navigateur (⋮ ou ⋯).'),
      step(2, 'Choisis ', h('strong', {}, 'Installer l’application'), ' ou ', h('strong', {}, 'Ajouter à l’écran d’accueil'), '.'));
  }

  return h('section', { class: `card install${compact ? ' install--compact' : ''}` },
    h('div', { class: 'install__head' },
      h('span', { class: 'install__icon' }, icon('phone', 22)),
      h('div', {},
        h('p', { class: 'install__title' }, 'Installe ', h('span', { class: 'brand' }, 'Anabolic', h('span', { class: 'brand__accent' }, 'OS'))),
        h('p', { class: 'muted small' }, 'Plein écran, ouverture instantanée et pastille de messages non lus.'))),
    body,
    compact ? null : h('button', { class: 'link-btn install__later', type: 'button', onclick: () => hideFor(7) }, 'Plus tard'));
}
