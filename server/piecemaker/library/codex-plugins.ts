import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { recordScanError, type LibraryScanError } from './scan-errors.js';

const require = createRequire(import.meta.url);
const TOML = require('@iarna/toml') as { parse(value: string): Record<string, unknown> };

export function installedCodexPlugins(userHome: string, projects: string[], errors?: LibraryScanError[]) {
  const installed = new Map<string, { id: string; installPath: string; workspaces: string[] }>();
  for (const workspace of ['', ...new Set(projects)]) {
    const filename = path.join(workspace || userHome, '.codex', 'config.toml');
    if (!fs.existsSync(filename)) continue;
    try {
      const config = TOML.parse(fs.readFileSync(filename, 'utf8'));
      for (const id of Object.keys(config.plugins || {})) {
        if (!/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+$/.test(id)) continue;
        const [name, marketplace] = id.split('@');
        const root = path.join(userHome, '.codex', 'plugins', 'cache', marketplace, name);
        if (!fs.existsSync(root)) continue;
        const version = fs.readdirSync(root, { withFileTypes: true })
          .filter((item) => item.isDirectory() && fs.existsSync(path.join(root, item.name, '.codex-plugin', 'plugin.json')))
          .map((item) => item.name).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
        if (!version) continue;
        const plugin = installed.get(id) || { id, installPath: path.join(root, version), workspaces: [] };
        plugin.workspaces.push(workspace ? fs.realpathSync(workspace) : '');
        installed.set(id, plugin);
      }
    } catch (error) { recordScanError(errors, filename, error); }
  }
  return [...installed.values()];
}
