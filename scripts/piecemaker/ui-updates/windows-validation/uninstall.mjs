import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadProductConfig } from '../shared/product-config.mjs';

function scheduleUninstall(app) {
  if (!app.isPackaged || loadProductConfig().appId !== 'legal.piecemaker.validation') throw new Error('Désinstallation réservée à PieceMaker Validation.');
  const directory = path.dirname(app.getPath('exe'));
  const name = fs.readdirSync(directory).find((entry) => /^Uninstall.*\.exe$/i.test(entry));
  if (!name) throw new Error('Programme de désinstallation Windows introuvable.');
  spawn(path.join(directory, name), ['/S'], { detached: true, stdio: 'ignore' }).unref();
  setImmediate(() => app.quit());
  return { scheduled: true };
}

export function registerPiecemakerUninstall({ ipcMain, app }) {
  ipcMain.handle('piecemaker-desktop:uninstall', async () => scheduleUninstall(app));
}

export async function runUninstallFromCommandLine({ app, dialog }) {
  await app.whenReady();
  const { response } = await dialog.showMessageBox({
    type: 'warning', title: 'PieceMaker Validation', message: 'Désinstaller PieceMaker Validation ?',
    detail: 'Le programme de désinstallation Windows retire cette application. Vos données et les composants partagés sont conservés.',
    buttons: ['Désinstaller', 'Annuler'], defaultId: 1, cancelId: 1,
  });
  if (response === 0) scheduleUninstall(app); else app.quit();
}
