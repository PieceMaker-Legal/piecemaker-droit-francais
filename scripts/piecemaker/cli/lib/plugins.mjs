import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { APP } from './config.mjs';

// Délègue à la chaîne commune du dépôt cible (plugins/toolchain, voir
// docs/plugins.md) — la même que celle de l'application Electron.
async function toolchain() {
  const entry = path.join(APP.directory, 'plugins', 'toolchain', 'index.mjs');
  if (!fs.existsSync(entry)) throw new Error(`chaîne des plugins absente (${entry})`);
  return import(pathToFileURL(entry).href);
}

/**
 * `rebuild` : recompile depuis les sources (installation complète). Sinon,
 * réinstalle seulement depuis le dernier bundle (réparation au lancement).
 * Renvoie vrai si un plugin a été posé ou retiré.
 */
export async function installPlugins(report, { rebuild }) {
  try {
    const { installPlugins: install } = await toolchain();
    const result = await install({
      appRoot: APP.directory,
      rebuild,
      log: (plugin) => report.detail(`${plugin.label} compilé`),
      logger: { log() {}, error: (message) => report.warn(message) },
    });
    for (const id of result.installed) report.ok(`Plugin ${id} — installé`);
    for (const id of result.removed) report.ok(`Plugin ${id} — retiré`);
    if (!result.installed.length && !result.removed.length && !result.failed.length) report.ok('Plugins PieceMaker — à jour');
    return result.installed.length > 0 || result.removed.length > 0;
  } catch (error) {
    report.warn(`Plugins PieceMaker — ${error.message}`);
    return false;
  }
}
