/**
 * Fond animé « écran fissuré » — très léger :
 *  • un seul SVG fixe derrière l'app, généré une fois (graine fixe : le même
 *    motif à chaque ouverture), redessiné seulement si l'écran change de taille ;
 *  • les fissures se « propagent » une fois à l'ouverture (stroke-dashoffset),
 *    puis restent quasi invisibles derrière les cartes ;
 *  • aucune animation si « Réduire les animations » est activé sur l'iPhone ;
 *  • désactivable dans Moi › Liens & réglages (préférence locale).
 */
const NS = 'http://www.w3.org/2000/svg';
const KEY = 'fxCracks';

export const cracksEnabled = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fissure : ligne brisée qui part d'un point d'impact, avec ramifications. */
function crack(rand, x, y, angle, len, depth, out) {
  const pts = [[x, y]];
  let a = angle;
  let cx = x; let cy = y;
  const steps = 5 + Math.floor(rand() * 5);
  for (let i = 0; i < steps; i += 1) {
    a += (rand() - 0.5) * 0.7;
    const seg = (len / steps) * (0.6 + rand() * 0.8);
    cx += Math.cos(a) * seg;
    cy += Math.sin(a) * seg;
    pts.push([cx, cy]);
    if (depth < 2 && rand() < 0.28) {
      crack(rand, cx, cy, a + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.6), len * 0.45, depth + 1, out);
    }
  }
  out.push({ d: `M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}`, w: depth ? 0.6 : 1.1 });
}

/** Anneau d'impact : arcs brisés autour du point. */
function ring(rand, x, y, r, out) {
  let a = rand() * Math.PI * 2;
  const end = a + Math.PI * 2;
  while (a < end) {
    const span = 0.25 + rand() * 0.5;
    const p = (t) => [x + Math.cos(t) * r * (0.92 + rand() * 0.16), y + Math.sin(t) * r * (0.92 + rand() * 0.16)];
    const [x1, y1] = p(a); const [x2, y2] = p(a + span / 2); const [x3, y3] = p(a + span);
    out.push({ d: `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}L${x3.toFixed(1)} ${y3.toFixed(1)}`, w: 0.7 });
    a += span + 0.15 + rand() * 0.5;
  }
}

function build(svg, animate) {
  const w = window.innerWidth;
  const hgt = window.innerHeight;
  const rand = rng(20261006);
  const paths = [];
  // Deux impacts : haut-droite (principal) et bas-gauche (discret).
  const impacts = [[w * 0.82, hgt * 0.16, 1], [w * 0.12, hgt * 0.78, 0.6]];
  for (const [x, y, k] of impacts) {
    const n = Math.round(9 * k) + 2;
    for (let i = 0; i < n; i += 1) {
      const angle = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.5;
      crack(rand, x, y, angle, Math.max(w, hgt) * (0.25 + rand() * 0.45) * k, 0, paths);
    }
    ring(rand, x, y, 26 * k + 8, paths);
    ring(rand, x, y, 70 * k + 10, paths);
  }

  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.replaceChildren();
  paths.forEach((p, i) => {
    const el = document.createElementNS(NS, 'path');
    el.setAttribute('d', p.d);
    el.setAttribute('stroke-width', String(p.w));
    svg.appendChild(el);
    if (animate) {
      const len = Math.ceil(el.getTotalLength());
      el.style.strokeDasharray = `${len}`;
      el.style.strokeDashoffset = `${len}`;
      el.style.animationDelay = `${Math.round((i % 14) * 45)}ms`;
      el.classList.add('cracks__draw');
    }
  });
}

let svg = null;
let timer = null;

export function initCracks() {
  if (svg || !cracksEnabled()) return;
  svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'cracks');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'none');
  document.body.prepend(svg);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  build(svg, !reduce);
  window.addEventListener('resize', onResize);
}

function onResize() {
  clearTimeout(timer);
  timer = setTimeout(() => svg && build(svg, false), 250);
}

export function setCracks(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* indisponible */ }
  if (on) initCracks();
  else { svg?.remove(); svg = null; window.removeEventListener('resize', onResize); }
}
