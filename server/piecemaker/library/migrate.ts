import fs from 'node:fs';
import path from 'node:path';

import type { createLibraryStore } from './store.js';

export function importLibraryDirectory(store: ReturnType<typeof createLibraryStore>, directory: string, kind: 'skill' | 'agent') {
  if (!fs.existsSync(directory)) return [];
  const imported: Array<{ source: string; id: string; linked: boolean }> = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const source = path.join(directory, item.name);
    const file = kind === 'skill' ? path.join(source, 'SKILL.md') : source;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || (kind === 'agent' && !file.endsWith('.md'))) continue;
    const id = store.importFile(file, kind);
    if (store.document(id).content !== fs.readFileSync(file, 'utf8')) throw new Error(`Import non vérifié : ${source}`);
    imported.push({ source, id, linked: item.isSymbolicLink() });
  }
  return imported;
}

export function migratePersonalLibrary(store: ReturnType<typeof createLibraryStore>, userHome: string, applicationRoot: string, withdraw = false) {
  const imported = [];
  for (const folder of ['assistant-workflows', 'tabular-review-workflows']) {
    imported.push(...importLibraryDirectory(store, path.join(applicationRoot, 'server/piecemaker/vendor/mike-defaults-fr', folder), 'skill'));
  }
  for (const [directory, kind] of [
    [path.join(userHome, '.claude', 'skills'), 'skill'],
    [path.join(userHome, '.codex', 'skills'), 'skill'],
    [path.join(userHome, '.agents', 'skills'), 'skill'],
    [path.join(userHome, '.claude', 'agents'), 'agent'],
    [path.join(userHome, '.piecemaker', 'library', 'skills'), 'skill'],
    [path.join(userHome, '.piecemaker', 'library', 'agents'), 'agent'],
  ] as const) imported.push(...importLibraryDirectory(store, directory, kind));
  if (withdraw) {
    const candidates = imported.filter((entry) => ['.claude', '.codex', '.agents'].some((provider) => entry.source.startsWith(path.join(userHome, provider) + path.sep)));
    const backup = path.join(store.directory, `migration-${Date.now()}`);
    fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(candidates, null, 2), { mode: 0o600 });
    for (const entry of candidates.sort((a, b) => Number(b.linked) - Number(a.linked))) {
      const destination = path.join(backup, path.relative(userHome, entry.source));
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.renameSync(entry.source, destination);
    }
    fs.writeFileSync(path.join(store.directory, 'centralized.json'), JSON.stringify({ migratedAt: new Date().toISOString(), count: candidates.length }), { mode: 0o600 });
  }
  return imported;
}
