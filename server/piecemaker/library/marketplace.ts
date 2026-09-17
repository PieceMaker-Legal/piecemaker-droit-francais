import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

import express from 'express';

import type { createLibraryStore } from './store.js';
import { importLibraryDirectory } from './migrate.js';
import { scanAndPersistLibraryClaudeAgents, scanAndPersistLibraryProviderSkills } from './provider-skills.js';

type MarketplaceKind = 'connector' | 'skill' | 'plugin' | 'agent';

function marketplaceManifest(userHome: string, marketplaceName: string) {
  const root = path.join(userHome, '.claude', 'plugins', 'marketplaces', marketplaceName);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
    return { root, plugins: Array.isArray(manifest.plugins) ? manifest.plugins : [] };
  } catch {
    return { root, plugins: [] };
  }
}

function marketplacePackageKinds(userHome: string, marketplaceName: string, plugin: { id: string; name: string; description?: string }, registry: Record<string, unknown>) {
  const kinds = new Set<MarketplaceKind>(['plugin']);
  const pluginName = plugin.id.split('@')[0];
  const marketplace = marketplaceManifest(userHome, marketplaceName);
  const entry = marketplace.plugins.find((candidate: { name?: string }) => candidate?.name === pluginName);
  const installs = Array.isArray(registry[plugin.id]) ? registry[plugin.id] as Array<{ installPath?: string }> : [];
  const installedRoot = installs.find((install) => typeof install?.installPath === 'string')?.installPath;
  const sourceRoot = typeof entry?.source === 'string' && entry.source.startsWith('.')
    ? path.resolve(marketplace.root, entry.source)
    : undefined;
  const root = installedRoot || sourceRoot;
  if (root && fs.existsSync(root)) {
    if (fs.existsSync(path.join(root, '.mcp.json'))) kinds.add('connector');
    if (fs.existsSync(path.join(root, 'skills')) || fs.existsSync(path.join(root, 'commands'))) kinds.add('skill');
    if (fs.existsSync(path.join(root, 'agents'))) kinds.add('agent');
  }
  if (Array.isArray(entry?.skills) && entry.skills.length) kinds.add('skill');
  const searchable = `${plugin.name} ${plugin.description || ''}`.toLowerCase();
  if (/\bmcp\b|\bconnect(?:or|eur|s|ed|ion)?\b|\bintegration\b/.test(searchable)) kinds.add('connector');
  if (/\bskills?\b|\btoolkit\b|\bworkflow\b/.test(searchable)) kinds.add('skill');
  if (/\bagents?\b/.test(searchable)) kinds.add('agent');
  return [...kinds];
}

function disableNativeClaudePlugin(userHome: string, id: string) {
  const settingsFilename = path.join(userHome, '.claude/settings.json');
  const settings = fs.existsSync(settingsFilename)
    ? JSON.parse(fs.readFileSync(settingsFilename, 'utf8'))
    : {};
  const enabledPlugins = settings.enabledPlugins && typeof settings.enabledPlugins === 'object' && !Array.isArray(settings.enabledPlugins)
    ? settings.enabledPlugins
    : {};
  if (enabledPlugins[id] === false) return;
  settings.enabledPlugins = { ...enabledPlugins, [id]: false };
  fs.mkdirSync(path.dirname(settingsFilename), { recursive: true, mode: 0o700 });
  const temporary = `${settingsFilename}.library.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, settingsFilename);
}

export function scanInstalledLibraryCollections(store: ReturnType<typeof createLibraryStore>, userHome: string) {
  const filename = path.join(userHome, '.claude/plugins/installed_plugins.json');
  const registry = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')).plugins || {} : {};
  const pluginsDirectory = path.join(userHome, '.claude', 'plugins');
  if (!fs.existsSync(pluginsDirectory) || fs.lstatSync(pluginsDirectory).isSymbolicLink()) return;
  const pluginsRoot = fs.realpathSync(pluginsDirectory);
  for (const [id, installs] of Object.entries(registry)) {
    if (!Array.isArray(installs)) continue;
    const install = installs.find((entry) => entry && typeof entry.installPath === 'string') as { installPath: string } | undefined;
    if (!install || !fs.existsSync(install.installPath)) continue;
    const installRoot = fs.realpathSync(install.installPath);
    if (!installRoot.startsWith(`${pluginsRoot}${path.sep}`)) continue;
    if (store.hasCollection(id)) continue;
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
    const fallbackEntryName = imported.length ? store.document(imported[0].id).name : null;
    store.upsertCollection({
      id,
      name: manifest.displayName || manifest.name || fallbackEntryName || 'Plugin sans nom',
      description: manifest.description || '',
      source: installRoot,
      entries: imported.map((entry) => ({
        entryId: entry.id,
        rootPath: path.relative(installRoot, entry.source).split(path.sep).join('/'),
      })),
      files: [],
    });
  }
}

function readInstalledClaudePlugins(userHome: string) {
  const filename = path.join(userHome, '.claude/plugins/installed_plugins.json');
  if (!fs.existsSync(filename)) return {};
  const config = JSON.parse(fs.readFileSync(filename, 'utf8'));
  return config.plugins && typeof config.plugins === 'object' && !Array.isArray(config.plugins)
    ? config.plugins as Record<string, unknown>
    : {};
}

function synchronizeInstalledPluginActivation(
  store: ReturnType<typeof createLibraryStore>,
  userHome: string,
  workspacePath: string,
) {
  const settingsFilename = path.join(userHome, '.claude/settings.json');
  if (!fs.existsSync(settingsFilename)) return store.listCollections(workspacePath);
  const settings = JSON.parse(fs.readFileSync(settingsFilename, 'utf8'));
  const enabledPlugins = settings.enabledPlugins && typeof settings.enabledPlugins === 'object' && !Array.isArray(settings.enabledPlugins)
    ? settings.enabledPlugins as Record<string, unknown>
    : {};
  const installedPlugins = readInstalledClaudePlugins(userHome);
  const collections = store.listCollections(workspacePath);

  for (const id of Object.keys(installedPlugins)) {
    const collection = collections.find((entry) => entry.id === id);
    const enabled = enabledPlugins[id];
    if (!collection || collection.componentCount === 0 || typeof enabled !== 'boolean' || collection.enabled === enabled) continue;
    store.setCollectionEnabled(workspacePath, id, enabled);
  }

  return store.listCollections(workspacePath);
}

export function createLibraryMarketplaceRouter(store: ReturnType<typeof createLibraryStore>, applicationRoot: string, userHome: string) {
  const require = createRequire(import.meta.url);
  const { listMarketplaceConnectors, registerOfficialMarketplace } = require(path.join(applicationRoot, 'server/piecemaker/vendor/websocket-server/admin-routes.cjs'));
  const router = express.Router();
  const run = (command: string, args: string[], timeout = 60000) => {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return { ok: result.status === 0, output: `${result.stdout || ''}${result.stderr || ''}`, status: result.status };
  };
  const scope = (value: unknown) => {
    if (value === 'piecemaker') return { name: 'mcp-legifrance', slug: 'PieceMaker-Legal/mcp-legifrance' };
    if (value === 'legal') return { name: 'claude-for-legal', slug: 'anthropics/claude-for-legal' };
    if (value === 'official') return { name: 'claude-plugins-official', slug: 'anthropics/claude-plugins-official' };
    throw new Error('Marketplace inconnue.');
  };
  const installed = () => {
    const filename = path.join(userHome, '.claude/plugins/installed_plugins.json');
    return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')).plugins || {} : {};
  };
  const importInstalledCollections = () => scanInstalledLibraryCollections(store, userHome);
  router.get('/plugin/marketplace', (req, res) => {
    try {
      const marketplace = scope(req.query.scope);
      const kind = req.query.kind;
      if (!['connector', 'skill', 'plugin', 'agent'].includes(String(kind))) throw new Error('Type de catalogue inconnu.');
      const catalog = listMarketplaceConnectors(run, { marketplaceName: marketplace.name });
      const registry = installed();
      const plugins = catalog.plugins
        .map((plugin: { id: string; name: string; description?: string }) => ({
          ...plugin,
          name: plugin.id === 'piecemaker@mcp-legifrance' ? 'MCP Légifrance' : plugin.name,
          installed: Boolean(registry[plugin.id]),
          kinds: marketplacePackageKinds(userHome, marketplace.name, plugin, registry),
        }))
        .filter((plugin: { kinds: MarketplaceKind[] }) => plugin.kinds.includes(kind as MarketplaceKind));
      res.json({ ...catalog, kind, plugins });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.get('/plugins', (req, res) => {
    try {
      const workspacePath = typeof req.query.workspacePath === 'string' ? req.query.workspacePath : undefined;
      res.json({ plugins: store.listCollections(workspacePath) });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.post('/plugins/sync', async (req, res) => {
    try {
      const workspacePath = typeof req.body?.workspacePath === 'string' ? req.body.workspacePath : undefined;
      await scanAndPersistLibraryProviderSkills(store, workspacePath);
      scanAndPersistLibraryClaudeAgents(store, workspacePath, userHome);
      scanInstalledLibraryCollections(store, userHome);
      res.json({
        ok: true,
        plugins: workspacePath
          ? synchronizeInstalledPluginActivation(store, userHome, workspacePath)
          : store.listCollections(),
      });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.post('/plugins/scan', (_req, res) => {
    try { importInstalledCollections(); res.json({ ok: true }); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
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
      disableNativeClaudePlugin(userHome, id);
      let result;
      try { result = run('claude', ['plugin', 'install', id, '--scope', 'user']); }
      finally { disableNativeClaudePlugin(userHome, id); }
      if (!result.ok) throw new Error(result.output || 'Installation impossible.');
      importInstalledCollections();
      res.json({ ok: true, enabled: false });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  return router;
}
