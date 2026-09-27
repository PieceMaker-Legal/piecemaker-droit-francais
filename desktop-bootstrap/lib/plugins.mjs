import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './shell.mjs';
import { ui } from './ui.mjs';

const PLUGINS = [
  ['piecemaker-timesheet', 'Timesheet'],
  ['piecemaker-tampon', 'Bordereau'],
  ['piecemaker-dossier', 'Dossier'],
  ['piecemaker-library', 'Bibliothèque'],
  ['piecemaker-telegram', 'Telegram'],
];

export async function installPieceMakerPlugins(sourceDir) {
  ui.step('Plugins PieceMaker');
  for (const [name, label] of PLUGINS) {
    const installer = path.join(sourceDir, 'plugins', name, 'install.mjs');
    try {
      await fs.access(installer);
      await run(process.execPath, [installer, sourceDir], { cwd: sourceDir });
      ui.ok(`Plugin ${label} installé`);
    } catch (error) {
      ui.warn(`${label} — installation échouée : ${error.message}`);
    }
  }
}
