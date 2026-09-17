import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { importLibraryDirectory } from './migrate.js';
import type { createLibraryStore } from './store.js';

const require = createRequire(import.meta.url);
const TOML = require('@iarna/toml') as { parse(value: string): Record<string, unknown> };

function importTomlAgents(store: ReturnType<typeof createLibraryStore>, directory: string) {
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
      imported.push(store.importContent(source, 'agent', `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`));
    } catch {}
  }
  return imported;
}

export function scanAndPersistLibraryProviderAgents(store: ReturnType<typeof createLibraryStore>, userHome: string) {
  const markdownDirectories = [
    path.join(userHome, '.claude', 'agents'),
    path.join(userHome, '.cursor', 'agents'),
    path.join(userHome, '.config', 'opencode', 'agent'),
    path.join(userHome, '.config', 'opencode', 'agents'),
    path.join(userHome, '.grok', 'agents'),
  ];
  for (const directory of markdownDirectories) {
    try { importLibraryDirectory(store, directory, 'agent', false); } catch {}
  }
  try { importTomlAgents(store, path.join(userHome, '.codex', 'agents')); } catch {}
}

export function scanAndPersistLibraryClaudeAgents(
  store: ReturnType<typeof createLibraryStore>,
  _workspacePath: string | undefined,
  userHome: string,
) {
  scanAndPersistLibraryProviderAgents(store, userHome);
}
