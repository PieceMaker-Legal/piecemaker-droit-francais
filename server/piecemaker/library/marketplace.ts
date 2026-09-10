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
  const importInstalledCollections = () => {
    const registry = installed();
    const pluginsDirectory = path.join(userHome, '.claude', 'plugins');
    if (!fs.existsSync(pluginsDirectory) || fs.lstatSync(pluginsDirectory).isSymbolicLink()) return;
    const pluginsRoot = fs.realpathSync(pluginsDirectory);
    for (const [id, installs] of Object.entries(registry)) {
      if (store.hasCollection(id)) continue;
      if (!Array.isArray(installs)) continue;
      const install = installs.find((entry) => entry && typeof entry.installPath === 'string') as { installPath: string } | undefined;
      if (!install || !fs.existsSync(install.installPath)) continue;
      const installRoot = fs.realpathSync(install.installPath);
      if (!installRoot.startsWith(`${pluginsRoot}${path.sep}`)) continue;
      let manifest: { name?: string; displayName?: string; description?: string } = {};
      const manifestPath = path.join(installRoot, '.claude-plugin', 'plugin.json');
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
      const imported = [
        ...importLibraryDirectory(store, path.join(installRoot, 'skills'), 'skill', false),
        ...importLibraryDirectory(store, path.join(installRoot, 'agents'), 'agent', false),
      ];
      const commandsDirectory = path.join(installRoot, 'commands');
      if (fs.existsSync(commandsDirectory) && !fs.lstatSync(commandsDirectory).isSymbolicLink()) {
        for (const command of fs.readdirSync(commandsDirectory, { withFileTypes: true })) {
          if (!command.isFile() || !command.name.toLowerCase().endsWith('.md')) continue;
          const source = path.join(commandsDirectory, command.name);
          imported.push({ source, id: store.importFile(source, 'skill', false), linked: false });
        }
      }
      const files: Array<{ path: string; content: Buffer }> = [];
      let totalSize = 0;
      const collect = (directory: string, relative = '') => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '__pycache__' || entry.isSymbolicLink()) continue;
          const relativePath = path.posix.join(relative.split(path.sep).join('/'), entry.name);
          const absolutePath = path.join(directory, entry.name);
          if (entry.isDirectory()) collect(absolutePath, relativePath);
          else if (entry.isFile()) {
            const content = fs.readFileSync(absolutePath);
            totalSize += content.length;
            if (totalSize > 30 * 1024 * 1024 || files.length >= 5000) throw new Error(`Plugin trop volumineux : ${id}`);
            files.push({ path: relativePath, content });
          }
        }
      };
      collect(installRoot);
      store.upsertCollection({
        id,
        name: manifest.displayName || manifest.name || id,
        description: manifest.description || '',
        source: installRoot,
        entries: imported.map((entry) => ({
          entryId: entry.id,
          rootPath: path.relative(installRoot, entry.source).split(path.sep).join('/'),
        })),
        files,
      });
    }
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
  router.get('/plugins', (req, res) => {
    try {
      importInstalledCollections();
      res.json({ plugins: store.listCollections(typeof req.query.workspacePath === 'string' ? req.query.workspacePath : undefined) });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.get('/plugins/:id/files', (req, res) => {
    try { res.json({ files: store.collectionFiles(String(req.params.id)) }); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.get('/plugins/:id/file', (req, res) => {
    try { res.json(store.collectionFile(String(req.params.id), String(req.query.path || ''))); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.put('/plugins/:id/file', (req, res) => {
    try { res.json(store.updateCollectionFile(String(req.params.id), req.body?.path, req.body?.content, req.body?.previousContent)); }
    catch (error) { res.status(409).json({ error: (error as Error).message }); }
  });
  router.put('/plugins/:id/activation', (req, res) => {
    try { res.json(store.setCollectionEnabled(req.body?.workspacePath, String(req.params.id), req.body?.enabled)); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
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
      importInstalledCollections();
      res.json({ ok: true, enabled: false });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  return router;
}
