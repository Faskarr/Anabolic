/**
 * Barre d'onglets inférieure (5 grandes zones tactiles, safe-area iPhone).
 */
import { h } from '../lib/dom.js';
import { icon } from './icons.js';

export const TABS = [
  { route: 'home',     label: 'Accueil',      icon: 'home' },
  { route: 'training', label: 'Entraînement', icon: 'dumbbell' },
  { route: 'diet',     label: 'Diet',         icon: 'leaf' },
  { route: 'protocol', label: 'Protocole',    icon: 'pill' },
  { route: 'me',       label: 'Moi',          icon: 'user' },
];

export function TabBar(current) {
  const top = current.split('/')[0];
  return h('nav', { class: 'tabbar', 'aria-label': 'Navigation principale' },
    TABS.map((t) => h('a', {
      class: `tab${t.route === top ? ' tab--on' : ''}`,
      href: `#/${t.route}`,
      'aria-current': t.route === top ? 'page' : null,
    }, icon(t.icon, 24), h('span', { class: 'tab__label' }, t.label))));
}
