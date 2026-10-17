import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import express from 'express';

import { providerSkillsService } from '@/modules/providers/index.js';

import type { createLibraryStore } from './store.js';
import { runClaudeCommand } from './claude-cli.js';
import { normalizeProviderConnector, setWorkspaceClaudePlugin, workspaceClaudePlugins } from './connector-installation.js';
import { importLibraryDirectory } from './migrate.js';
import { scanAndPersistLibraryProviderAgents } from './provider-agents.js';
import { scanAndPersistLibraryProviderConnectors } from './provider-connectors.js';
import { scanAndPersistLibraryProjectSkills, scanAndPersistLibraryProviderSkills, type ProviderSkillsReader } from './provider-skills.js';
import { recordScanError, type LibraryScanError } from './scan-errors.js';
import { applyWorkspaceSkillVisibility } from './skill-visibility.js';

type MarketplaceKind = 'connector' | 'skill' | 'plugin' | 'agent';

const GITHUB_SHORTHAND = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:@[A-Za-z0-9._/-]+)?$/;
const PLUGIN_ID = /^[a-zA-Z0-9_-]+@[a-zA-Z0-9_.-]+$/;

export const KNOWN_MARKETPLACES: Record<string, { name: string; slug: string }> = {
  piecemaker: { name: 'mcp-legifrance', slug: 'PieceMaker-Legal/mcp-legifrance' },
  legal: { name: 'claude-for-legal', slug: 'anthropics/claude-for-legal' },
  official: { name: 'claude-plugins-official', slug: 'anthropics/claude-plugins-official' },
  mike: { name: 'mike-workflows', slug: 'Open-Legal-Products/mike-workflows' },
};

export function parseMarketplaceSource(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Lien de marketplace manquant.');
  const source = raw.trim();
  if (/\s/.test(source) || source.startsWith('-')) throw new Error('Lien de marketplace invalide.');
  if (GITHUB_SHORTHAND.test(source)) return source;
  let url: URL;
  try { url = new URL(source); } catch { throw new Error('Lien de marketplace invalide.'); }
  if (url.protocol !== 'https:') throw new Error('Le lien doit être en HTTPS.');
  if (url.username || url.password) throw new Error('Lien de marketplace invalide.');
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname;
  const isGit = pathname.endsWith('.git')
    || host === 'github.com'
    || host.endsWith('.github.com')
    || host.includes('gitlab')
    || host.includes('bitbucket');
  const isManifest = pathname.endsWith('marketplace.json');
  if (!isGit && !isManifest) {
    throw new Error('Collez un dépôt GitHub (owner/repo), une URL git HTTPS ou un marketplace.json.');
  }
  return source;
}

function resolveMarketplace(
  value: unknown,
  listed: Array<{ name: string; repo: string | null; source: string | null }>,
) {
  const key = typeof value === 'string' ? value : '';
  if (KNOWN_MARKETPLACES[key]) return KNOWN_MARKETPLACES[key];
  const found = listed.find((entry) => entry.name === key);
  if (found) return { name: found.name, slug: found.repo || found.source || found.name };
  throw new Error('Marketplace inconnue.');
}

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
  if (marketplaceName === 'mcp-legifrance') kinds.add('connector');
  return [...kinds];
}

function userClaudePlugins(userHome: string) {
  const settingsFilename = path.join(userHome, '.claude/settings.json');
  if (!fs.existsSync(settingsFilename)) return {};
  const enabledPlugins = JSON.parse(fs.readFileSync(settingsFilename, 'utf8')).enabledPlugins;
  return enabledPlugins && typeof enabledPlugins === 'object' && !Array.isArray(enabledPlugins)
    ? enabledPlugins as Record<string, unknown>
    : {};
}

function setNativeClaudePlugin(userHome: string, id: string, enabled: boolean) {
  const settingsFilename = path.join(userHome, '.claude/settings.json');
  const settings = fs.existsSync(settingsFilename)
    ? JSON.parse(fs.readFileSync(settingsFilename, 'utf8'))
    : {};
  const enabledPlugins = settings.enabledPlugins && typeof settings.enabledPlugins === 'object' && !Array.isArray(settings.enabledPlugins)
    ? settings.enabledPlugins
    : {};
  if (enabledPlugins[id] === enabled) return;
  settings.enabledPlugins = { ...enabledPlugins, [id]: enabled };
  fs.mkdirSync(path.dirname(settingsFilename), { recursive: true, mode: 0o700 });
  const temporary = `${settingsFilename}.library.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, settingsFilename);
}

export function scanInstalledLibraryCollections(store: ReturnType<typeof createLibraryStore>, userHome: string, errors?: LibraryScanError[]) {
  const filename = path.join(userHome, '.claude/plugins/installed_plugins.json');
  let registry: Record<string, unknown> = {};
  try { if (fs.existsSync(filename)) registry = JSON.parse(fs.readFileSync(filename, 'utf8')).plugins || {}; }
  catch (error) { recordScanError(errors, filename, error); return; }
  const pluginsDirectory = path.join(userHome, '.claude', 'plugins');
  if (!fs.existsSync(pluginsDirectory) || fs.lstatSync(pluginsDirectory).isSymbolicLink()) return;
  const pluginsRoot = fs.realpathSync(pluginsDirectory);
  for (const [id, installs] of Object.entries(registry)) {
    let scanSource = id;
    try {
      if (!Array.isArray(installs)) continue;
      const install = installs.find((entry) => entry && typeof entry.installPath === 'string') as { installPath: string } | undefined;
      if (!install || !fs.existsSync(install.installPath)) continue;
      scanSource = install.installPath;
      const installRoot = fs.realpathSync(install.installPath);
      if (!installRoot.startsWith(`${pluginsRoot}${path.sep}`)) continue;
      let manifest: { name?: string; displayName?: string; description?: string } = {};
      const manifestPath = path.join(installRoot, '.claude-plugin', 'plugin.json');
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
      const imported: Array<{ source: string; id: string; linked: boolean; rootPath?: string }> = [
        ...importLibraryDirectory(store, path.join(installRoot, 'skills'), 'skill', false, errors),
        ...importLibraryDirectory(store, path.join(installRoot, 'agents'), 'agent', false, errors),
      ];
      const commandsDirectory = path.join(installRoot, 'commands');
      if (fs.existsSync(commandsDirectory) && !fs.lstatSync(commandsDirectory).isSymbolicLink()) {
        for (const command of fs.readdirSync(commandsDirectory, { withFileTypes: true })) {
          if (!command.isFile() || !command.name.toLowerCase().endsWith('.md')) continue;
          const source = path.join(commandsDirectory, command.name);
          try {
            const entryId = store.importFile(source, 'skill', false);
            if (entryId) imported.push({ source, id: entryId, linked: false });
          } catch (error) { recordScanError(errors, source, error); }
        }
      }
      const mcpPath = path.join(installRoot, '.mcp.json');
      if (fs.existsSync(mcpPath) && !fs.lstatSync(mcpPath).isSymbolicLink()) {
        try {
          const parsed = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
          const servers = parsed?.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)
            ? parsed.mcpServers as Record<string, unknown>
            : {};
          for (const [name, raw] of Object.entries(servers)) {
            const config = normalizeProviderConnector(raw);
            if (!config) continue;
            const source = `${mcpPath}#${name}`;
            const connectorId = store.importConnector({
              name,
              description: config.url || config.command || name,
              config,
              source,
              namespace: id,
            });
            if (connectorId) imported.push({ source, id: connectorId, linked: false, rootPath: `mcp/${name}.json` });
          }
        } catch (error) { recordScanError(errors, mcpPath, error); }
      }
      const fallbackEntryName = imported.length ? store.document(imported[0].id).name : null;
      store.upsertCollection({
        id,
        name: manifest.displayName || manifest.name || fallbackEntryName || 'Plugin sans nom',
        description: manifest.description || '',
        source: installRoot,
        entries: imported.map((entry) => ({
          entryId: entry.id,
          rootPath: entry.rootPath || path.relative(installRoot, entry.source).split(path.sep).join('/'),
        })),
        files: [],
      });
    } catch (error) { recordScanError(errors, scanSource, error); }
  }
}

export async function scanLibrarySources(store: ReturnType<typeof createLibraryStore>, userHome: string, listProjectPaths: () => string[], reader: ProviderSkillsReader) {
  const errors: LibraryScanError[] = [];
  try { await scanAndPersistLibraryProviderSkills(store, undefined, reader, userHome, errors); }
  catch (error) { recordScanError(errors, 'skills', error); }
  try { await scanAndPersistLibraryProjectSkills(store, listProjectPaths(), reader, errors); }
  catch (error) { recordScanError(errors, 'projets', error); }
  try { scanAndPersistLibraryProviderAgents(store, userHome, errors); }
  catch (error) { recordScanError(errors, 'agents', error); }
  try { scanAndPersistLibraryProviderConnectors(store, userHome, errors); }
  catch (error) { recordScanError(errors, 'connecteurs', error); }
  try { scanInstalledLibraryCollections(store, userHome, errors); }
  catch (error) { recordScanError(errors, 'plugins', error); }
  return errors;
}

export function createLibraryMarketplaceRouter(store: ReturnType<typeof createLibraryStore>, applicationRoot: string, userHome: string, listProjectPaths: () => string[] = () => [], reader: ProviderSkillsReader = providerSkillsService, runCommand?: (command: string, args: string[], timeout?: number) => { ok: boolean; output: string; status: number | null }) {
  const require = createRequire(import.meta.url);
  const { listMarketplaceConnectors, listRegisteredMarketplaces, registerOfficialMarketplace } = require(path.join(applicationRoot, 'server/piecemaker/vendor/websocket-server/admin-routes.cjs'));
  const router = express.Router();
  const run = runCommand ?? runClaudeCommand;
  const listed = () => listRegisteredMarketplaces(run);
  const scope = (value: unknown) => resolveMarketplace(value, listed());
  const installed = () => {
    const filename = path.join(userHome, '.claude/plugins/installed_plugins.json');
    return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')).plugins || {} : {};
  };
  const importInstalledCollections = () => scanInstalledLibraryCollections(store, userHome);
  const describeCollections = (workspacePath?: string) => {
    const collections = store.listCollections(workspacePath);
    const registry = installed();
    const everywhere = userClaudePlugins(userHome);
    const here = workspacePath ? workspaceClaudePlugins(fs.realpathSync(workspacePath)) : {};
    return collections.map((collection) => {
      const native = Boolean(registry[collection.id]);
      if (!native) return { ...collection, native, global: false };
      const global = everywhere[collection.id] === true;
      const local = here[collection.id];
      return { ...collection, native, global, partial: false, enabled: Boolean(workspacePath) && (typeof local === 'boolean' ? local : global) };
    });
  };
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
      res.json({ plugins: describeCollections(workspacePath) });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.post('/plugins/sync', async (req, res) => {
    try {
      const workspacePath = typeof req.body?.workspacePath === 'string' ? req.body.workspacePath : undefined;
      const errors = await scanLibrarySources(store, userHome, listProjectPaths, reader);
      if (workspacePath) {
        store.reconcileWorkspace(workspacePath);
        applyWorkspaceSkillVisibility(store, workspacePath);
      }
      res.json({ ok: true, plugins: describeCollections(workspacePath), scan: { errors } });
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
    try {
      const id = String(req.params.id);
      const workspacePath = req.body?.workspacePath;
      const enabled = req.body?.enabled;
      if (typeof workspacePath !== 'string') throw new Error('Dossier absolu requis.');
      if (typeof enabled !== 'boolean') throw new Error('Activation booléenne requise.');
      const collection = store.listCollections(workspacePath).find((entry) => entry.id === id);
      const native = Boolean(installed()[id]);
      if (!collection || (!native && !collection.componentCount)) throw new Error('Plugin introuvable.');
      if (collection.componentCount) store.setCollectionEnabled(workspacePath, id, enabled, { skipClaude: native });
      if (native) setWorkspaceClaudePlugin(fs.realpathSync(workspacePath), id, enabled ? true : userClaudePlugins(userHome)[id] === true ? false : null);
      applyWorkspaceSkillVisibility(store, workspacePath);
      res.json(describeCollections(workspacePath).find((entry) => entry.id === id));
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.put('/plugins/:id/global', (req, res) => {
    try {
      const id = String(req.params.id);
      if (typeof req.body?.enabled !== 'boolean') throw new Error('Activation booléenne requise.');
      if (!installed()[id]) throw new Error('Plugin absent de Claude Code.');
      setNativeClaudePlugin(userHome, id, req.body.enabled);
      res.json({ ok: true, global: req.body.enabled });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.post('/plugin/marketplace/register', (req, res) => {
    try {
      if (req.body?.source) {
        res.json(registerOfficialMarketplace(run, { name: null, slug: parseMarketplaceSource(req.body.source) }));
        return;
      }
      res.json(registerOfficialMarketplace(run, scope(req.body?.scope)));
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  router.post('/plugin/marketplace/acquire', (req, res) => {
    try {
      const marketplace = scope(req.body?.scope);
      const id = req.body?.id;
      if (typeof id !== 'string' || !PLUGIN_ID.test(id) || !id.endsWith(`@${marketplace.name}`)) throw new Error('Élément invalide.');
      if (installed()[id]) throw new Error('Déjà installé. Son activation se règle par dossier.');
      const catalog = listMarketplaceConnectors(run, { marketplaceName: marketplace.name });
      if (!catalog.plugins.some((plugin: { id: string }) => plugin.id === id)) throw new Error('Élément absent du catalogue.');
      setNativeClaudePlugin(userHome, id, false);
      let result;
      try { result = run('claude', ['plugin', 'install', id, '--scope', 'user']); }
      finally { setNativeClaudePlugin(userHome, id, false); }
      if (!result.ok) throw new Error(result.output || 'Installation impossible.');
      importInstalledCollections();
      res.json({ ok: true, enabled: false });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  return router;
}
