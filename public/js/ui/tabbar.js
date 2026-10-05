/**
 * Barre d'onglets inférieure (5 grandes zones tactiles, safe-area iPhone).
 * `badges` : { [route]: nombre } — ex. messages non lus sur « Moi ».
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

export function TabBar(current, badges = {}) {
  let top = current.split('/')[0];
  if (top === 'admin') top = 'me';
  return h('nav', { class: 'tabbar', 'aria-label': 'Navigation principale' },
    TABS.map((t) => {
      const n = badges[t.route] || 0;
      return h('a', {
        class: `tab${t.route === top ? ' tab--on' : ''}`,
        href: `#/${t.route}`,
        'aria-current': t.route === top ? 'page' : null,
        'aria-label': n ? `${t.label}, ${n} non lu${n > 1 ? 's' : ''}` : null,
      },
      h('span', { class: 'tab__icon' }, icon(t.icon, 24), n ? h('span', { class: 'tab__badge' }, n > 9 ? '9+' : String(n)) : null),
      h('span', { class: 'tab__label' }, t.label));
    }));
}
