import fs from 'node:fs';
import path from 'node:path';

import type { createLibraryStore } from './store.js';

export function importLibraryDirectory(store: ReturnType<typeof createLibraryStore>, directory: string, kind: 'skill' | 'agent', followLinks = true) {
  if (!fs.existsSync(directory)) return [];
  if (!followLinks && fs.lstatSync(directory).isSymbolicLink()) return [];
  const imported: Array<{ source: string; id: string; linked: boolean }> = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const source = path.join(directory, item.name);
    const file = kind === 'skill' ? path.join(source, 'SKILL.md') : source;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || (kind === 'agent' && !file.endsWith('.md'))) continue;
    if (!followLinks && (item.isSymbolicLink() || fs.lstatSync(file).isSymbolicLink())) continue;
    const id = store.importFile(file, kind);
    if (store.document(id).content !== fs.readFileSync(file, 'utf8')) throw new Error(`Import non vérifié : ${source}`);
    imported.push({ source, id, linked: item.isSymbolicLink() });
  }
  return imported;
}
