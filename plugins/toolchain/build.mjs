// Construction unique des plugins PieceMaker : tout `plugins/piecemaker-*` est
// compilé de la même façon, avec l'esbuild de l'application, d'après le champ
// `piecemakerSources` de son manifest.json. Contrat : voir plugins.md.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { BUNDLE_MANIFEST } from './sync.mjs';

const TOOLCHAIN = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_PREFIX = 'piecemaker-';
export const ENTRY = 'dist/index.js';
export const SERVER_ENTRY = 'launcher.mjs';

const BROWSER = { bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, logLevel: 'warning' };

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Plugins livrés : tout `plugins/piecemaker-*` doté d'un manifest.json. */
export function discoverPlugins(appRoot) {
  const root = path.join(appRoot, 'plugins');
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(PLUGIN_PREFIX))
    .filter((entry) => fs.existsSync(path.join(root, entry.name, 'manifest.json')))
    .map((entry) => {
      const directory = path.join(root, entry.name);
      const manifest = readJson(path.join(directory, 'manifest.json'));
      return { id: entry.name, label: manifest.displayName || entry.name, directory, manifest };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Refuse tout manifeste qui s'écarte du contrat commun, avant de compiler quoi que ce soit. */
export function validatePlugin({ id, directory, manifest }) {
  const errors = [];
  const sources = manifest.piecemakerSources;
  if (manifest.name !== id) errors.push(`name doit valoir "${id}"`);
  if (manifest.entry !== ENTRY) errors.push(`entry doit valoir "${ENTRY}"`);
  if (!sources || typeof sources !== 'object' || typeof sources.index !== 'string') {
    errors.push('piecemakerSources.index (source de l\'onglet) est requis');
  } else {
    for (const [key, source] of Object.entries(sources)) {
      if (!/^[a-z][a-z0-9-]*$/.test(key)) errors.push(`piecemakerSources : clé invalide "${key}"`);
      if (typeof source !== 'string' || !fs.existsSync(path.join(directory, source))) {
        errors.push(`piecemakerSources.${key} : fichier introuvable (${source})`);
      }
    }
    const hasServer = 'server' in sources;
    if (hasServer !== (manifest.server === SERVER_ENTRY)) {
      errors.push(hasServer ? `server doit valoir "${SERVER_ENTRY}"` : 'server déclaré sans piecemakerSources.server');
    }
    const injections = Object.keys(sources).filter((key) => key !== 'index' && key !== 'server').map((key) => `dist/${key}.js`);
    if (JSON.stringify(manifest.piecemakerInjections || []) !== JSON.stringify(injections)) {
      errors.push(`piecemakerInjections doit valoir ${JSON.stringify(injections)}`);
    }
  }
  if (manifest.icon && !fs.existsSync(path.join(directory, manifest.icon))) errors.push(`icône introuvable (${manifest.icon})`);
  if (errors.length) throw new Error(`${id} : ${errors.join(' ; ')}`);
}

async function compilePlugin(esbuild, appRoot, plugin, output) {
  const { directory, manifest } = plugin;
  for (const [key, source] of Object.entries(manifest.piecemakerSources)) {
    const entryPoints = [path.join(directory, source)];
    if (key === 'server') {
      await esbuild.build({
        entryPoints,
        outfile: path.join(output, 'dist', 'server.mjs'),
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node20',
        nodePaths: [path.join(appRoot, 'node_modules')],
        banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
        logLevel: 'warning',
      });
    } else {
      await esbuild.build({ ...BROWSER, entryPoints, outfile: path.join(output, 'dist', `${key}.js`) });
    }
  }
  fs.copyFileSync(path.join(directory, 'manifest.json'), path.join(output, 'manifest.json'));
  if (manifest.icon) fs.copyFileSync(path.join(directory, manifest.icon), path.join(output, manifest.icon));
  if (manifest.server) fs.copyFileSync(path.join(TOOLCHAIN, 'launcher.mjs'), path.join(output, SERVER_ENTRY));
}

function listFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? listFiles(path.join(directory, entry.name), relative) : [relative];
  }).sort();
}

function fingerprint(directory) {
  const hash = crypto.createHash('sha256');
  for (const file of listFiles(directory)) hash.update(file).update('\0').update(fs.readFileSync(path.join(directory, file))).update('\0');
  return hash.digest('hex');
}

function locate(command) {
  const lookup = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], { encoding: 'utf8', windowsHide: true });
  const found = lookup.status === 0 ? lookup.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) : '';
  return found && path.isAbsolute(found) ? found : null;
}

/**
 * Environnement d'exécution des serveurs de plugins, figé à la construction :
 * le Node courant (celui qui a installé les modules natifs de l'application),
 * la racine de l'application et les CLI des fournisseurs IA.
 */
function serverRuntime(appRoot) {
  const codexLauncher = path.join(appRoot, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  return {
    nodePath: process.execPath,
    applicationRoot: appRoot,
    claudePath: locate('claude'),
    codexPath: locate('codex'),
    codexLauncher: fs.existsSync(codexLauncher) ? codexLauncher : null,
    vibePath: locate('vibe'),
  };
}

/**
 * Compile tous les plugins dans `outDir` : un dossier prêt à installer par
 * plugin, bundle.json (empreintes + runtime) et sync.mjs. Tout échec est
 * bloquant : un bundle n'est jamais produit avec un plugin en moins.
 */
export async function buildPlugins({ appRoot, outDir, log = () => {} }) {
  const plugins = discoverPlugins(appRoot);
  if (!plugins.length) throw new Error(`Aucun plugin trouvé sous ${path.join(appRoot, 'plugins')}.`);
  for (const plugin of plugins) validatePlugin(plugin);

  const require = createRequire(path.join(appRoot, 'package.json'));
  let esbuild;
  try {
    esbuild = require('esbuild');
  } catch {
    throw new Error(`esbuild introuvable dans ${appRoot} — installez les dépendances de l'application (npm install).`);
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-plugins-'));
  try {
    const bundle = { runtime: serverRuntime(appRoot), plugins: {} };
    for (const plugin of plugins) {
      const output = path.join(staging, plugin.id);
      fs.mkdirSync(path.join(output, 'dist'), { recursive: true });
      try {
        await compilePlugin(esbuild, appRoot, plugin, output);
      } catch (error) {
        throw new Error(`Plugin ${plugin.label} : compilation échouée (${error.message}).`);
      }
      bundle.plugins[plugin.id] = { fingerprint: fingerprint(output), server: Boolean(plugin.manifest.server) };
      log(plugin);
    }
    fs.copyFileSync(path.join(TOOLCHAIN, 'sync.mjs'), path.join(staging, 'sync.mjs'));
    fs.writeFileSync(path.join(staging, BUNDLE_MANIFEST), `${JSON.stringify(bundle, null, 2)}\n`);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(outDir), { recursive: true });
    fs.cpSync(staging, outDir, { recursive: true });
    return plugins;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
