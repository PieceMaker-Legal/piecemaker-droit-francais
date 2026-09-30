// Point d'entrée unique de l'installation des plugins PieceMaker, partagé par
// l'application Electron (desktop-bootstrap), la commande `piecemaker` et
// `npm run plugins`. Contrat et fonctionnement : plugins.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildPlugins, discoverPlugins } from './build.mjs';
import { BUNDLE_MANIFEST, syncPlugins } from './sync.mjs';

export { buildPlugins, discoverPlugins, syncPlugins };

/** Bundle local, hors Electron : `<app>/.piecemaker-plugins` (ignoré par git). */
export const localBundleDir = (appRoot) => path.join(appRoot, '.piecemaker-plugins');

/** Même résolution que productDataRoot() côté serveur et que electron/main.js. */
export function dataRootFor(appRoot) {
  if (process.env.CLOUDCLI_HOME) return process.env.CLOUDCLI_HOME;
  const product = JSON.parse(fs.readFileSync(path.join(appRoot, 'product.config.json'), 'utf8'));
  return path.join(os.homedir(), product.dataDirectoryName);
}

/** Base lue par le serveur lancé depuis le dépôt : DATABASE_PATH (env, puis .env), sinon <données>/auth.db. */
export function databasePathFor(appRoot, dataRoot) {
  let configured = process.env.DATABASE_PATH;
  if (!configured) {
    try {
      configured = fs.readFileSync(path.join(appRoot, '.env'), 'utf8').split(/\r?\n/)
        .map((line) => line.trim()).find((line) => line.startsWith('DATABASE_PATH='))?.slice('DATABASE_PATH='.length);
    } catch {
      configured = undefined;
    }
  }
  if (!configured) return path.join(dataRoot, 'auth.db');
  return path.isAbsolute(configured) ? configured : path.resolve(appRoot, configured);
}

/**
 * Installation hors Electron : compile (si `rebuild` ou bundle absent) puis
 * installe dans le répertoire de données.
 */
export async function installPlugins({ appRoot, rebuild = true, log = () => {}, logger = console }) {
  const bundleDir = localBundleDir(appRoot);
  if (rebuild || !fs.existsSync(path.join(bundleDir, BUNDLE_MANIFEST))) {
    await buildPlugins({ appRoot, outDir: bundleDir, log });
  }
  const dataRoot = dataRootFor(appRoot);
  return syncPlugins({ bundleDir, dataRoot, databasePath: databasePathFor(appRoot, dataRoot), log: logger });
}
