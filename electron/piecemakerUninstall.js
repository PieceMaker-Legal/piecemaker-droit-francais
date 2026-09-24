import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { macUninstallScript, packagedApplicationRoot, removalPlan, windowsUninstallScript } from './uninstallPlan.js';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function registerPiecemakerUninstall({ ipcMain, app }) {
  ipcMain.handle('piecemaker-desktop:uninstall', async () => {
    if (!app.isPackaged) {
      throw new Error('La désinstallation ne s’applique qu’à l’application installée.');
    }
    const appRoot = packagedApplicationRoot(app.getAppPath());
    if (!appRoot) {
      throw new Error('Dossier de l’application introuvable.');
    }
    const home = os.homedir();
    const dataHome = process.env.PIECEMAKER_HOME || path.join(home, '.piecemaker');
    const plan = removalPlan(appRoot, home, process.env, process.platform, {
      config: readJson(path.join(dataHome, 'config.json')),
      mineru: readJson(path.join(home, 'mineru.json')),
    });
    const helper = path.join(os.tmpdir(), `piecemaker-uninstall-${process.pid}${process.platform === 'win32' ? '.ps1' : '.sh'}`);
    if (process.platform === 'win32') {
      fs.writeFileSync(helper, windowsUninstallScript(plan), 'utf8');
      spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper, '-ProcessId', String(process.pid)], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } else {
      fs.writeFileSync(helper, macUninstallScript(plan), { encoding: 'utf8', mode: 0o755 });
      spawn('/bin/sh', [helper, String(process.pid)], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    }
    setImmediate(() => app.quit());
    return { scheduled: true };
  });
}
