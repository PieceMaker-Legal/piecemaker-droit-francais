import path from 'node:path';
import { buildPlugins } from '../../plugins/toolchain/build.mjs';
import { ui } from './ui.mjs';

// Dossier du paquet Electron où la chaîne commune (plugins/toolchain, voir
// plugins.md) dépose le bundle ; l'overlay l'installe à chaque démarrage.
export const BUNDLE_DIR = 'piecemaker-plugins';

export async function embedBundledPlugins(sourceDir, stageDir) {
  ui.step('Compilation des plugins PieceMaker…');
  const plugins = await buildPlugins({
    appRoot: sourceDir,
    outDir: path.join(stageDir, BUNDLE_DIR),
    log: (plugin) => ui.detail(`Plugin ${plugin.label} embarqué.`),
  });
  ui.ok(`${plugins.length} plugins PieceMaker embarqués dans l'application.`);
}
