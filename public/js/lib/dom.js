/**
 * Mini-utilitaire DOM — remplace tous les `innerHTML` de l'ancienne app.
 *
 * SÉCURITÉ : les enfants de type string sont insérés via createTextNode,
 * donc jamais interprétés comme du HTML. Une donnée utilisateur du type
 * `<img src=x onerror=alert(1)>` s'affiche telle quelle, sans s'exécuter.
 *
 * Exemple :
 *   h('button', { class: 'btn btn--primary', onclick: save }, 'Enregistrer')
 */

const BOOLEAN_PROPS = new Set(['disabled', 'checked', 'hidden', 'required', 'readonly']);

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;

    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (BOOLEAN_PROPS.has(key)) {
      el[key] = Boolean(value);
    } else if (key === 'href' || key === 'src') {
      // Bloque les URL javascript: / data: injectées.
      el.setAttribute(key, safeUrl(value));
    } else {
      el.setAttribute(key, String(value));
    }
  }

  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** N'autorise que http(s), les chemins relatifs et les ancres. */
export function safeUrl(url) {
  const s = String(url).trim();
  if (/^(https?:|\/|\.\/|#)/i.test(s)) return s;
  return '#';
}

/** Remplace le contenu d'un élément. */
export function mount(target, ...children) {
  target.replaceChildren();
  append(target, children);
  return target;
}
