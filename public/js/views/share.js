/**
 * Partage : export (un profil OU sauvegarde complète) et import (code ou fichier).
 *
 * Améliorations vs l'ancienne app :
 *  • on choisit QUEL profil exporter (plus seulement le profil actif) ;
 *  • sauvegarde complète = tous les profils + poids + carnet + compteur ;
 *  • export en fichier .json en plus du copier/partager ;
 *  • l'import montre d'abord ce que contient le code, avec « Poids » et
 *    « Compteur » décochés par défaut (corrige l'écrasement du poids).
 */
import { h } from '../lib/dom.js';
import { buildExport, parseImport } from '../lib/schema.js';
import { state, profileData, activeProfileId } from '../store.js';
import { applyImport } from '../data/importer.js';
import { PageHeader, SectionTitle, IconButton } from '../ui/layout.js';
import { toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';

const CAT_LABEL = { workout: 'Programme', diet: 'Diet', protocol: 'Protocole' };

// État local de l'écran (survit aux re-rendus déclenchés par le store).
const ui = { mode: 'profile', cat: 'workout', pid: null, importText: '', parsed: null, pick: {}, error: null };

// ── Export ──────────────────────────────────────────────────────────────

function exportText() {
  if (ui.mode === 'all') {
    const all = {};
    for (const cat of ['workout', 'diet', 'protocol']) {
      all[cat] = state.profiles[cat].list.map((p) => ({ name: p.name, data: profileData(cat, p.id) }));
    }
    return buildExport({ all, weights: state.weights, counterBase: state.counterBase, exlogs: state.exlogs });
  }
  const pid = ui.pid || activeProfileId(ui.cat);
  const prof = state.profiles[ui.cat].list.find((p) => p.id === pid);
  if (!prof) return null;
  return buildExport({ profiles: [{ cat: ui.cat, name: prof.name, data: profileData(ui.cat, pid) }] });
}

function fileName() {
  const date = new Date().toISOString().slice(0, 10);
  if (ui.mode === 'all') return `anabolicos-sauvegarde-${date}.json`;
  const prof = state.profiles[ui.cat].list.find((p) => p.id === (ui.pid || activeProfileId(ui.cat)));
  const slug = (prof?.name || ui.cat).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `anabolicos-${slug || ui.cat}.json`;
}

async function doCopy() {
  const text = exportText();
  if (!text) return toast('Aucun profil à exporter.', { type: 'error' });
  try {
    await navigator.clipboard.writeText(text);
    toast('Code copié');
  } catch {
    toast('Copie impossible — utilise « Fichier ».', { type: 'error' });
  }
}

async function doShare() {
  const text = exportText();
  if (!text) return toast('Aucun profil à exporter.', { type: 'error' });
  const file = new File([text], fileName(), { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'AnabolicOS' });
    else if (navigator.share) await navigator.share({ title: 'AnabolicOS', text });
    else return doDownload();
  } catch (err) {
    if (err?.name !== 'AbortError') toast('Partage impossible.', { type: 'error' });
  }
}

function doDownload() {
  const text = exportText();
  if (!text) return toast('Aucun profil à exporter.', { type: 'error' });
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: fileName() });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rerender() { window.dispatchEvent(new Event('app:render')); }

function ExportCard() {
  const modeTabs = h('div', { class: 'segmented segmented--fill' },
    [['profile', 'Un profil'], ['all', 'Sauvegarde complète']].map(([m, l]) => h('button', {
      class: `segment${ui.mode === m ? ' segment--on' : ''}`, type: 'button',
      onclick: () => { ui.mode = m; rerender(); },
    }, l)));

  let picker = null;
  if (ui.mode === 'profile') {
    const list = state.profiles[ui.cat].list;
    if (!list.some((p) => p.id === ui.pid)) ui.pid = activeProfileId(ui.cat);
    picker = h('div', {},
      h('div', { class: 'chips chips--wrap' }, Object.entries(CAT_LABEL).map(([c, l]) => h('button', {
        class: `chip${ui.cat === c ? ' chip--on' : ''}`, type: 'button',
        onclick: () => { ui.cat = c; ui.pid = null; rerender(); },
      }, l))),
      list.length
        ? h('div', { class: 'chips chips--wrap', style: { marginTop: '8px' } }, list.map((p) => h('button', {
          class: `chip chip--outline${ui.pid === p.id ? ' chip--on' : ''}`, type: 'button',
          onclick: () => { ui.pid = p.id; rerender(); },
        }, p.name)))
        : h('p', { class: 'muted', style: { marginTop: '8px' } }, 'Aucun profil dans cette catégorie.'));
  } else {
    const n = ['workout', 'diet', 'protocol'].reduce((a, c) => a + state.profiles[c].list.length, 0);
    picker = h('p', { class: 'muted' },
      `${n} profil(s), ${state.weights.length} pesée(s), carnet de charges et compteur. Idéal pour garder une copie de tes données.`);
  }

  return h('section', { class: 'card' },
    h('p', { class: 'eyebrow' }, 'Exporter'),
    modeTabs,
    picker,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn--ink', type: 'button', onclick: doShare }, icon('share', 18), 'Partager'),
      h('button', { class: 'btn btn--ghost', type: 'button', onclick: doCopy }, icon('copy', 18), 'Copier'),
      h('button', { class: 'btn btn--ghost', type: 'button', onclick: doDownload }, icon('download', 18), 'Fichier')));
}

// ── Import ──────────────────────────────────────────────────────────────

function analyse(text) {
  ui.importText = text;
  ui.error = null;
  ui.parsed = null;
  try {
    ui.parsed = parseImport(text);
    const b = ui.parsed.bundle;
    ui.pick = {
      workout: Boolean(b.workout), diet: Boolean(b.diet), protocol: Boolean(b.protocol),
      all: Boolean(b.all),
      exlogs: Boolean(b.exlogs && Object.keys(b.exlogs).length),
      weights: false,   // décoché par défaut : on n'importe pas le poids d'un autre par erreur
      counter: false,
    };
  } catch (err) {
    ui.error = err.message;
  }
  rerender();
}

function ImportCard() {
  const area = h('textarea', {
    class: 'input input--code', rows: 5, placeholder: 'Colle ici un code AnabolicOS…',
    'aria-label': 'Code à importer', spellcheck: 'false', autocapitalize: 'off', id: 'imp-text',
    oninput: () => { ui.importText = area.value; },
  });
  area.value = ui.importText;

  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json,.txt', class: 'sr-only', id: 'imp-file',
    onchange: async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      if (f.size > 1_000_000) { ui.error = 'Fichier trop volumineux.'; rerender(); return; }
      analyse(await f.text());
    },
  });

  const children = [
    h('p', { class: 'eyebrow' }, 'Importer'),
    area,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn--ink', type: 'button', onclick: () => analyse(area.value) }, 'Analyser le code'),
      h('label', { class: 'btn btn--ghost', for: 'imp-file' }, icon('file', 18), 'Fichier'),
      fileInput),
  ];

  if (ui.error) children.push(h('p', { class: 'form-error' }, ui.error));

  if (ui.parsed) {
    const b = ui.parsed.bundle;
    const options = [
      b.workout && ['workout', `Programme${b.name ? ` « ${b.name} »` : ''} · ${b.workout.sessions.length} séance(s)`],
      b.diet && ['diet', `Diet · ${b.diet.meals.length} repas`],
      b.protocol && ['protocol', `Protocole · ${b.protocol.days.length} jour(s)`],
      b.all && ['all', `Tous les profils de la sauvegarde`],
      b.exlogs && Object.keys(b.exlogs).length && ['exlogs', `Carnet de charges (fusion)`],
      b.weights?.length && ['weights', `Poids · ${b.weights.length} pesée(s) — ajoutées sans écraser les tiennes`],
      b.counterBase != null && ['counter', `Compteur de séances → ${b.counterBase} (remplace le tien)`],
    ].filter(Boolean);

    children.push(h('div', { class: 'import-pick' },
      h('p', { class: 'muted' }, 'Contenu détecté — choisis ce que tu importes :'),
      options.map(([key, label]) => {
        const cb = h('input', { type: 'checkbox', checked: ui.pick[key], onchange: () => { ui.pick[key] = cb.checked; } });
        return h('label', { class: 'checkbox' }, cb, h('span', {}, label));
      }),
      h('p', { class: 'hint' }, 'Les programmes, diets et protocoles importés sont ajoutés comme nouveaux profils : rien n’est écrasé.'),
      h('button', {
        class: 'btn btn--primary btn--block', type: 'button',
        onclick: () => {
          const done = applyImport(b, ui.pick);
          if (!done.length) return toast('Rien de sélectionné.', { type: 'error' });
          toast(`Importé : ${done.join(', ')}`);
          Object.assign(ui, { importText: '', parsed: null, error: null });
          rerender();
        },
      }, 'Importer la sélection')));
  }
  return h('section', { class: 'card' }, children);
}

export function ShareView() {
  return [
    PageHeader({
      eyebrow: 'Import / Export', title: 'Partage',
      trailing: IconButton('back', 'Retour', () => { location.hash = '#/me'; }, 'icon-btn--soft'),
    }),
    ExportCard(),
    ImportCard(),
    SectionTitle('Compatibilité'),
    h('p', { class: 'hint' }, "Les codes de l'ancienne version d'AnabolicOS (v3) s'importent directement."),
  ];
}
