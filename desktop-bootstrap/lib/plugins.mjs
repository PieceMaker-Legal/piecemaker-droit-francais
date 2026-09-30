import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './shell.mjs';
import { ui } from './ui.mjs';

// Découverts sur disque (tout `plugins/piecemaker-*` doté d'un install.mjs)
// plutôt que listés en dur : la liste codée ici avait oublié Tabular Review.
async function bundledPlugins(sourceDir) {
  const root = path.join(sourceDir, 'plugins');
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const plugins = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('piecemaker-')) continue;
    const installer = path.join(root, entry.name, 'install.mjs');
    if (!(await fs.access(installer).then(() => true, () => false))) continue;
    const manifest = await fs.readFile(path.join(root, entry.name, 'manifest.json'), 'utf8')
      .then(JSON.parse, () => ({}));
    plugins.push({ name: entry.name, label: manifest.displayName || entry.name, installer });
  }
  return plugins.sort((left, right) => left.name.localeCompare(right.name));
}

export async function installPieceMakerPlugins(sourceDir) {
  ui.step('Plugins PieceMaker');
  const plugins = await bundledPlugins(sourceDir);
  if (!plugins.length) ui.warn(`Aucun plugin trouvé sous ${path.join(sourceDir, 'plugins')}`);
  for (const { label, installer } of plugins) {
    try {
      await run(process.execPath, [installer, sourceDir], { cwd: sourceDir });
      ui.ok(`Plugin ${label} installé`);
    } catch (error) {
      ui.warn(`${label} — installation échouée : ${error.message}`);
    }
  }
}
