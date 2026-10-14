import { app, autoUpdater, BrowserWindow, dialog } from 'electron';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadProductConfig } from '../shared/product-config.mjs';
import { UNINSTALL_ARGUMENT } from '../electron/uninstallPlan.js';
import { DesktopWindowManager } from '../electron/desktopWindow.js';
import { LocalServerController } from '../electron/localServer.js';
import { installWindowsTitleBar } from './windowsTitleBar.js';
import { installWindowsUpdater } from './windowsUpdater.js';

installWindowsTitleBar({ app, DesktopWindowManager });

process.env.ELECTRON_FORCE_OWN_SERVER = '1';

const OPEN_LOCAL_EXPRESSION = 'window.cloudcliDesktop && window.cloudcliDesktop.openLocal()';

let alreadyOpened = false;

function openLocalOnce(window) {
  if (alreadyOpened) return;
  alreadyOpened = true;
  window.webContents.executeJavaScript(OPEN_LOCAL_EXPRESSION, true).catch(() => {
    alreadyOpened = false;
  });
}

function adoptWindow(window) {
  if (alreadyOpened) return;
  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', () => openLocalOnce(window));
    return;
  }
  openLocalOnce(window);
}

app.on('browser-window-created', (_event, window) => adoptWindow(window));

async function startApplication() {
  if (process.platform === 'win32') {
    await app.whenReady();
    await installWindowsUpdater({ app, dialog });
    autoUpdater.once('before-quit-for-update', () => {
      const getSettings = LocalServerController.prototype.getSettings;
      const shutdownOwnedServer = LocalServerController.prototype.shutdownOwnedServer;
      LocalServerController.prototype.getSettings = function () {
        return { ...getSettings.call(this), keepLocalServerRunning: false };
      };
      LocalServerController.prototype.shutdownOwnedServer = async function () {
        const pid = this.ownedServerProcess?.pid;
        if (pid) {
          await new Promise((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], resolve));
        }
        return shutdownOwnedServer.call(this);
      };
    });
  }
  // Avant electron/main.js : le serveur local lit les plugins (et lance leurs
  // sous-processus) une seule fois, à son démarrage. Le bundle et son sync.mjs
  // sont produits par plugins/toolchain (voir docs/plugins.md).
  try {
    const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const bundleDir = path.join(appRoot, 'piecemaker-plugins');
    const { syncPlugins } = await import(pathToFileURL(path.join(bundleDir, 'sync.mjs')).href);
    const dataRoot = process.env.CLOUDCLI_HOME || path.join(os.homedir(), loadProductConfig().dataDirectoryName);
    syncPlugins({ bundleDir, dataRoot, databasePath: process.env.DATABASE_PATH || path.join(dataRoot, 'auth.db') });
  } catch (error) {
    console.error(`[PieceMaker] Installation des plugins impossible : ${error.message}`);
  }

  await import('../electron/main.js');

  for (const window of BrowserWindow.getAllWindows()) adoptWindow(window);
}

if (process.argv.includes(UNINSTALL_ARGUMENT)) {
  const { runUninstallFromCommandLine } = await import('../electron/piecemakerUninstall.js');
  await runUninstallFromCommandLine({ app, dialog });
} else {
  void startApplication().catch((error) => {
    console.error('[PieceMaker] Startup failed:', error);
    app.quit();
  });
}
