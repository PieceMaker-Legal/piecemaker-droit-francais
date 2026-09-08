import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

import express from 'express';

import type { createLibraryStore } from './store.js';
import { importLibraryDirectory } from './migrate.js';

export function createLibraryMarketplaceRouter(store: ReturnType<typeof createLibraryStore>, applicationRoot: string, userHome: string) {
  const require = createRequire(import.meta.url);
  const { listMarketplaceConnectors, registerOfficialMarketplace } = require(path.join(applicationRoot, 'server/piecemaker/vendor/websocket-server/admin-routes.cjs'));
  const router = express.Router();
  const run = (command: string, args: string[], timeout = 60000) => {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return { ok: result.status === 0, output: `${result.stdout || ''}${result.stderr || ''}`, status: result.status };
  };
  const scope = (value: unknown) => {
    if (value === 'legal') return { name: 'claude-for-legal', slug: 'anthropics/claude-for-legal' };
    if (value === 'official') return { name: 'claude-plugins-official', slug: 'anthropics/claude-plugins-official' };
    throw new Error('Marketplace inconnue.');
  };
  const installed = () => {
    const filename = path.join(userHome, '.claude/plugins/installed_plugins.json');
    return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')).plugins || {} : {};
  };
  const disable = (id: string) => {
    const filename = path.join(userHome, '.claude/settings.json');
    const settings = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {};
    settings.enabledPlugins = { ...settings.enabledPlugins, [id]: false };
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const temporary = `${filename}.library.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, filename);
  };
  router.get('/plugin/marketplace', (req, res) => {
    try {
      const marketplace = scope(req.query.scope);
      const catalog = listMarketplaceConnectors(run, { marketplaceName: marketplace.name });
      const registry = installed();
      res.json({ ...catalog, plugins: catalog.plugins.map((plugin: { id: string }) => ({ ...plugin, installed: Boolean(registry[plugin.id]) })) });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.post('/plugin/marketplace/register', (req, res) => {
    try { res.json(registerOfficialMarketplace(run, scope(req.body?.scope))); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.post('/plugin/marketplace/acquire', (req, res) => {
    try {
      const marketplace = scope(req.body?.scope);
      const id = req.body?.id;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+$/.test(id) || !id.endsWith(`@${marketplace.name}`)) throw new Error('Connecteur invalide.');
      if (installed()[id]) throw new Error('Connecteur déjà installé. Son activation se règle par dossier.');
      const catalog = listMarketplaceConnectors(run, { marketplaceName: marketplace.name });
      if (!catalog.plugins.some((plugin: { id: string }) => plugin.id === id)) throw new Error('Connecteur absent du catalogue.');
      disable(id);
      let result;
      try { result = run('claude', ['plugin', 'install', id, '--scope', 'user']); }
      finally { disable(id); }
      if (!result.ok) throw new Error(result.output || 'Installation impossible.');
      for (const entry of installed()[id] || []) {
        if (entry.installPath) {
          importLibraryDirectory(store, path.join(entry.installPath, 'skills'), 'skill');
          importLibraryDirectory(store, path.join(entry.installPath, 'agents'), 'agent');
        }
      }
      res.json({ ok: true, enabled: false });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  return router;
}
