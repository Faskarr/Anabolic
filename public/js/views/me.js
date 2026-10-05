/**
 * Moi : compte, poids, partage, (contact et admin arrivent aux phases 4 et 5).
 */
import { h } from '../lib/dom.js';
import { frNum } from '../lib/dates.js';
import { state } from '../store.js';
import { signOut } from '../auth.js';
import { PageHeader } from '../ui/layout.js';
import { confirmSheet } from '../ui/sheet.js';
import { icon } from '../ui/icons.js';
import { weightStats } from './weight.js';

export const APP_VERSION = '0.6.0';

function Row({ href, onclick, iconName, label, value, badge, danger }) {
  const inner = [
    h('span', { class: 'menu-row__icon' }, icon(iconName, 20)),
    h('span', { class: 'menu-row__label' }, label),
    value ? h('span', { class: 'menu-row__value' }, value) : null,
    badge ? h('span', { class: 'count-badge', 'aria-label': `${badge} non lu${badge > 1 ? 's' : ''}` }, String(badge)) : null,
    href ? h('span', { class: 'menu-row__chevron' }, icon('chevron', 18)) : null,
  ];
  return href
    ? h('a', { class: 'menu-row', href }, inner)
    : h('button', { class: `menu-row${danger ? ' menu-row--danger' : ''}`, type: 'button', onclick }, inner);
}

export function MeView(session) {
  const { user, isAdmin } = session;
  const s = weightStats();

  return [
    PageHeader({ eyebrow: 'Compte', title: 'Moi' }),
    h('section', { class: 'card profile-card' },
      user.photoURL
        ? h('img', { class: 'avatar avatar--lg', src: user.photoURL, alt: '', referrerpolicy: 'no-referrer' })
        : h('div', { class: 'avatar avatar--lg', 'aria-hidden': 'true' }, (user.displayName || '?').charAt(0).toUpperCase()),
      h('div', {},
        h('p', { class: 'profile-card__name' }, user.displayName || 'Athlète', isAdmin ? h('span', { class: 'badge badge--inline' }, 'Admin') : null),
        h('p', { class: 'muted' }, user.email))),
    h('nav', { class: 'menu card card--flush', 'aria-label': 'Sections' },
      Row({ href: '#/me/weight', iconName: 'scale', label: 'Poids', value: s ? `${frNum(s.last.kg)} kg` : null }),
      Row({ href: '#/me/share', iconName: 'share', label: 'Import / Export' }),
      Row({ href: '#/me/check', iconName: 'shield', label: 'Diagnostic' })),
    isAdmin ? h('nav', { class: 'menu card card--flush', 'aria-label': 'Administration' },
      Row({
        href: '#/admin', iconName: 'shield', label: 'Espace admin',
        value: state.adminUsers ? `${state.adminUsers.length} utilisateur${state.adminUsers.length > 1 ? 's' : ''}` : null,
      })) : null,
    h('nav', { class: 'menu card card--flush' },
      Row({
        iconName: 'logout', label: 'Se déconnecter', danger: true,
        onclick: async () => {
          if (await confirmSheet({ title: 'Se déconnecter ?', confirmLabel: 'Se déconnecter', danger: false })) signOut();
        },
      })),
    h('p', { class: 'hint center' }, `AnabolicOS ${APP_VERSION}${state.error ? ' · erreur de synchro' : ''}`),
  ];
}
