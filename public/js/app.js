/**
 * Point d'entrée de l'app utilisateur.
 * Choisit l'écran selon l'état de session ; aucune logique métier ici.
 */
import { mount, h } from './lib/dom.js';
import { onSession } from './auth.js';
import { LoginView } from './views/login.js';
import { DisabledView } from './views/disabled.js';
import { FoundationView } from './views/foundation.js';

const root = document.getElementById('app');

function LoadingView() {
  return h('main', { class: 'screen', 'aria-busy': 'true' },
    h('div', { class: 'center-stack', style: { alignItems: 'center' } },
      h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Chargement' })));
}

function ErrorView(error) {
  return h('main', { class: 'screen' },
    h('div', { class: 'center-stack' },
      h('div', { class: 'card' },
        h('h1', { class: 'card__title' }, 'Impossible de charger ton compte'),
        h('p', { class: 'card__text' }, error?.code || error?.message || 'Erreur inconnue'),
        h('button', {
          class: 'btn btn--ink btn--block', style: { marginTop: '16px' },
          type: 'button', onclick: () => location.reload(),
        }, 'Réessayer'))));
}

onSession((session) => {
  switch (session.state) {
    case 'loading':    mount(root, LoadingView()); break;
    case 'signed-out': mount(root, LoginView()); break;
    case 'disabled':   mount(root, DisabledView()); break;
    case 'error':      mount(root, ErrorView(session.error)); break;
    case 'active':     mount(root, FoundationView(session)); break;
  }
});

// Service worker : cache de l'app pour un démarrage rapide et hors ligne.
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[sw]', err));
}
