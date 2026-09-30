import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { APP } from './config.mjs';
import { runInherited } from './exec.mjs';
import { runtimeEnv } from './node-runtime.mjs';

const INSTALL_TIMEOUT = 2 * 60_000;
const PLUGIN_PREFIX = 'piecemaker-';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Plugins livrés avec PieceMaker : tout `plugins/piecemaker-*` qui porte un
 * `install.mjs`. Découverts sur disque plutôt que listés en dur, pour qu'un
 * nouveau plugin ne puisse pas être oublié par l'installateur.
 */
export function bundledPlugins(applicationRoot = APP.directory) {
  const root = path.join(applicationRoot, 'plugins');
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(PLUGIN_PREFIX))
    .filter((entry) => fs.existsSync(path.join(root, entry.name, 'install.mjs')))
    .map((entry) => {
      const manifest = readJson(path.join(root, entry.name, 'manifest.json')) || {};
      return {
        id: entry.name,
        label: `Plugin ${manifest.displayName || entry.name}`,
        version: manifest.version || null,
        installer: path.join(root, entry.name, 'install.mjs'),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Même résolution que les `install.mjs` et que `productDataRoot()` côté serveur. */
export function pluginsDataRoot(applicationRoot = APP.directory) {
  if (process.env.CLOUDCLI_HOME) return process.env.CLOUDCLI_HOME;
  const product = readJson(path.join(applicationRoot, 'product.config.json')) || {};
  return path.join(os.homedir(), product.dataDirectoryName || '.claude-code-ui');
}

/**
 * Plugins absents, désactivés ou d'une autre version que la source : ce sont
 * ceux qui n'apparaîtraient pas (ou pas à jour) dans l'application.
 */
export function pluginsToRepair(applicationRoot = APP.directory) {
  const dataRoot = pluginsDataRoot(applicationRoot);
  const config = readJson(path.join(dataRoot, 'plugins.json')) || {};
  return bundledPlugins(applicationRoot).filter((plugin) => {
    const installed = readJson(path.join(dataRoot, 'plugins', plugin.id, 'manifest.json'));
    if (!installed) return true;
    if (config[plugin.id]?.enabled === false) return false;
    return installed.version !== plugin.version;
  });
}

export async function installPlugins(runtime, report, plugins = bundledPlugins()) {
  if (!plugins.length) {
    report.warn('Plugins PieceMaker — aucune source trouvée sous plugins/');
    return;
  }

  for (const plugin of plugins) {
    report.step(`${plugin.label} — installation`);
    const result = await runInherited(runtime.nodePath, [plugin.installer, APP.directory], {
      cwd: APP.directory,
      env: runtimeEnv(runtime),
      timeout: INSTALL_TIMEOUT,
    });

    if (result.timedOut) report.warn(`${plugin.label} — délai dépassé`);
    else if (result.error) report.warn(`${plugin.label} — échec de démarrage : ${result.error.message}`);
    else if (result.code !== 0) report.warn(`${plugin.label} — échec (code ${result.code})`);
    else report.ok(`${plugin.label} — installé`);
  }
}
