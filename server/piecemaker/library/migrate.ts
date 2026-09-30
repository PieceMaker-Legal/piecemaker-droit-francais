import fs from 'node:fs';
import path from 'node:path';

import { recordScanError, type LibraryScanError } from './scan-errors.js';
import type { createLibraryStore } from './store.js';

export function importLibraryDirectory(store: ReturnType<typeof createLibraryStore>, directory: string, kind: 'skill' | 'agent', followLinks = true, errors?: LibraryScanError[]) {
  if (!fs.existsSync(directory)) return [];
  if (!followLinks && fs.lstatSync(directory).isSymbolicLink()) return [];
  const imported: Array<{ source: string; id: string; linked: boolean }> = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const source = path.join(directory, item.name);
    try {
      const file = kind === 'skill' ? path.join(source, 'SKILL.md') : source;
      if (!fs.existsSync(file) || !fs.statSync(file).isFile() || (kind === 'agent' && !file.endsWith('.md'))) continue;
      if (!followLinks && (item.isSymbolicLink() || fs.lstatSync(file).isSymbolicLink())) continue;
      const id = store.importFile(file, kind);
      if (id) imported.push({ source, id, linked: item.isSymbolicLink() });
    } catch (error) { recordScanError(errors, source, error); }
  }
  return imported;
}

export function migratePersonalLibrary(store: ReturnType<typeof createLibraryStore>, userHome: string, applicationRoot: string, errors?: LibraryScanError[]) {
  const imported = [];
  for (const folder of ['assistant-workflows', 'tabular-review-workflows']) {
    imported.push(...importLibraryDirectory(store, path.join(applicationRoot, 'server/piecemaker/vendor/mike-defaults-fr', folder), 'skill', true, errors));
  }
  for (const [directory, kind] of [
    [path.join(userHome, '.claude', 'skills'), 'skill'],
    [path.join(userHome, '.codex', 'skills'), 'skill'],
    [path.join(userHome, '.agents', 'skills'), 'skill'],
    [path.join(userHome, '.cursor', 'skills'), 'skill'],
    [path.join(userHome, '.config', 'opencode', 'skills'), 'skill'],
    [path.join(userHome, '.grok', 'skills'), 'skill'],
    [path.join(userHome, '.claude', 'agents'), 'agent'],
    [path.join(userHome, '.cursor', 'agents'), 'agent'],
    [path.join(userHome, '.grok', 'agents'), 'agent'],
    [path.join(userHome, '.config', 'opencode', 'agents'), 'agent'],
    [path.join(userHome, '.config', 'opencode', 'agent'), 'agent'],
    [path.join(userHome, '.piecemaker', 'library', 'skills'), 'skill'],
    [path.join(userHome, '.piecemaker', 'library', 'agents'), 'agent'],
  ] as const) imported.push(...importLibraryDirectory(store, directory, kind, true, errors));
  return imported;
}
