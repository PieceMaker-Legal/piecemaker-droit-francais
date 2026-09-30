import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { importLibraryDirectory } from './migrate.js';
import { recordScanError, type LibraryScanError } from './scan-errors.js';
import type { createLibraryStore } from './store.js';

const require = createRequire(import.meta.url);
const TOML = require('@iarna/toml') as { parse(value: string): Record<string, unknown> };

function importTomlAgents(store: ReturnType<typeof createLibraryStore>, directory: string, errors?: LibraryScanError[]) {
  if (!fs.existsSync(directory) || fs.lstatSync(directory).isSymbolicLink()) return [];
  const imported: string[] = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!item.isFile() || !item.name.toLowerCase().endsWith('.toml')) continue;
    const source = path.join(directory, item.name);
    if (fs.lstatSync(source).isSymbolicLink()) continue;
    try {
      const parsed = TOML.parse(fs.readFileSync(source, 'utf8'));
      const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : path.basename(item.name, '.toml');
      const description = typeof parsed.description === 'string' ? parsed.description : '';
      const body = typeof parsed.developer_instructions === 'string' ? parsed.developer_instructions : '';
      const id = store.importContent(source, 'agent', `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
      if (id) imported.push(id);
    } catch (error) { recordScanError(errors, source, error); }
  }
  return imported;
}

export function scanAndPersistLibraryProviderAgents(store: ReturnType<typeof createLibraryStore>, userHome: string, errors?: LibraryScanError[]) {
  const markdownDirectories = [
    path.join(userHome, '.claude', 'agents'),
    path.join(userHome, '.cursor', 'agents'),
    path.join(userHome, '.config', 'opencode', 'agent'),
    path.join(userHome, '.config', 'opencode', 'agents'),
    path.join(userHome, '.grok', 'agents'),
  ];
  for (const directory of markdownDirectories) {
    try { importLibraryDirectory(store, directory, 'agent', false, errors); }
    catch (error) { recordScanError(errors, directory, error); }
  }
  const codexAgents = path.join(userHome, '.codex', 'agents');
  try { importTomlAgents(store, codexAgents, errors); }
  catch (error) { recordScanError(errors, codexAgents, error); }
}

export function scanAndPersistLibraryClaudeAgents(
  store: ReturnType<typeof createLibraryStore>,
  _workspacePath: string | undefined,
  userHome: string,
) {
  scanAndPersistLibraryProviderAgents(store, userHome);
}
