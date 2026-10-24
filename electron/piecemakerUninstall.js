import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadProductConfig } from '../shared/product-config.mjs';
import { macUninstallScript, packagedApplicationRoot, removalPlan } from './uninstallPlan.js';

function electronPaths(app) {
  return ['userData', 'sessionData', 'logs', 'crashDumps'].map((name) => {
    try {
      return app.getPath(name);
    } catch {
      return null;
    }
  });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function runUninstallFromCommandLine({ app, dialog }) {
  await app.whenReady();
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'PieceMaker',
    message: 'Désinstaller PieceMaker ?',
    detail: process.platform === 'win32'
      ? 'Le programme de désinstallation Windows retire l’application. Les données, les modèles et les composants externes sont conservés.'
      : 'L’application, ses composants, son certificat local et ses données seront retirés. Votre base de comptes (auth.db), votre Bibliothèque, votre historique Mistral, vos dossiers juridiques, les modèles et le trousseau de signature partagés sont conservés.',
    buttons: ['Désinstaller', 'Annuler'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) {
    app.quit();
    return;
  }
  await scheduleUninstall(app);
}

export function registerPiecemakerUninstall({ ipcMain, app }) {
  ipcMain.handle('piecemaker-desktop:uninstall', async () => scheduleUninstall(app));
}

function scheduleUninstall(app) {
  if (!app.isPackaged) {
    throw new Error('La désinstallation ne s’applique qu’à l’application installée.');
  }
  if (process.platform === 'win32') {
    const directory = path.dirname(app.getPath('exe'));
    const name = fs.readdirSync(directory).find((entry) => /^Uninstall.*\.exe$/i.test(entry));
    if (!name) throw new Error('Programme de désinstallation NSIS introuvable. Réinstallez PieceMaker avec l’installateur Windows.');
    return new Promise((resolve, reject) => {
      const child = spawn(path.join(directory, name), [], { detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        setImmediate(() => app.quit());
        resolve({ scheduled: true });
      });
    });
  }
  const appRoot = packagedApplicationRoot(app.getAppPath());
  if (!appRoot) {
    throw new Error('Dossier de l’application introuvable.');
  }
  const home = os.homedir();
  const dataHome = process.env.PIECEMAKER_HOME || path.join(home, '.piecemaker');
  const product = loadProductConfig();
  const plan = removalPlan(appRoot, home, process.env, process.platform, {
    config: readJson(path.join(dataHome, 'config.json')),
    productDataRoot: process.env.CLOUDCLI_HOME || path.join(home, product.dataDirectoryName),
    appId: product.appId,
    electronPaths: electronPaths(app),
  });
  const helper = path.join(os.tmpdir(), `piecemaker-uninstall-${process.pid}.sh`);
  fs.writeFileSync(helper, macUninstallScript(plan), { encoding: 'utf8', mode: 0o755 });
  spawn('/bin/sh', [helper, String(process.pid)], {
    detached: true,
    stdio: 'ignore',
  }).unref();
  setImmediate(() => app.quit());
  return { scheduled: true };
}
