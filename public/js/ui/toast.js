import { h } from '../lib/dom.js';

let host;

/**
 * Notification éphémère non bloquante (remplace alert()).
 * @param {string} message
 * @param {{ type?: 'info' | 'error', duration?: number }} [opts]
 */
export function toast(message, { type = 'info', duration = 3500 } = {}) {
  if (!host) {
    host = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  const el = h('div', { class: `toast${type === 'error' ? ' toast--error' : ''}` }, message);
  host.appendChild(el);
  setTimeout(() => el.remove(), duration);
}
