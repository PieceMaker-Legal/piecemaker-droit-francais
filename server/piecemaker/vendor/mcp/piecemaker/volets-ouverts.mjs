import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LABELS = {
  files: 'Fichiers',
  git: 'Suivi des modifications',
  browser: 'Navigateur',
  'plugin:piecemaker-dossier': 'Dossier',
  'plugin:piecemaker-tabular-review': 'Analyse tabulaire',
  'plugin:piecemaker-library': 'Bibliothèque',
  'plugin:piecemaker-tampon': 'Bordereau',
  'plugin:piecemaker-timesheet': 'Timesheet',
};

const VIEWS = { chronology: 'chronologie', general: 'vue générale' };

export const openPanelsFile = (home = process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker')) => path.join(home, 'volets-ouverts.json');

const relative = (file, project) => (file.startsWith(`${project}/`) ? file.slice(project.length + 1) : file);

function readEntry(file, cwd) {
  let store;
  try {
    store = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const project = Object.keys(store).filter((key) => cwd === key || cwd.startsWith(`${key}/`)).sort((a, b) => b.length - a.length)[0];
  return project ? { project, entry: store[project] } : null;
}

function panelLabel(tab, focus, project) {
  const label = LABELS[tab] ?? (tab.startsWith('plugin:') ? tab.slice('plugin:'.length) : tab);
  const details = [focus?.view && (VIEWS[focus.view] ?? focus.view), focus?.file && `fichier : ${relative(focus.file, project)}`].filter(Boolean);
  return details.length ? `${label} (${details.join(', ')})` : label;
}

export function describeOpenPanels(cwd = process.cwd(), file = openPanelsFile()) {
  const found = readEntry(file, cwd);
  const panels = Array.isArray(found?.entry?.panels) ? found.entry.panels : [];
  const document = typeof found?.entry?.document === 'string' ? found.entry.document : null;
  if (!found || (!panels.length && !document)) return 'Aucun volet ouvert à côté du chat.';
  const { project, entry } = found;
  const focus = entry.focus ?? {};
  const last = entry.last?.kind === 'document' ? `document ${relative(entry.last.path, project)}`
    : entry.last?.kind === 'panel' ? panelLabel(entry.last.tab, focus[entry.last.tab], project) : 'aucun';
  return [
    `Volets ouverts, dans l’ordre d’ouverture : ${panels.length ? panels.map((tab) => panelLabel(tab, focus[tab], project)).join(' ; ') : 'aucun'}.`,
    `Document affiché : ${document ? relative(document, project) : 'aucun'}.`,
    `Dernier ouvert, celui que l’avocat regarde : ${last}.`,
  ].join('\n');
}
