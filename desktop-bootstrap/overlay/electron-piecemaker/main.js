import { app, autoUpdater, BrowserWindow, dialog, powerSaveBlocker } from 'electron';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadProductConfig } from '../shared/product-config.mjs';
import { UNINSTALL_ARGUMENT } from '../electron/uninstallPlan.js';
import { DesktopWindowManager } from '../electron/desktopWindow.js';
import { LocalServerController } from '../electron/localServer.js';
import { installDesktopKeepAwake } from './keepAwake.js';
import { installWindowsTitleBar } from './windowsTitleBar.js';
import { installWindowsUpdater } from './windowsUpdater.js';
import { initializeCompactRuntime, portablePluginRuntime } from './compact-runtime.mjs';
import { addEmbeddedGit } from './embedded-git.js';

installWindowsTitleBar({ app, DesktopWindowManager });

process.env.ELECTRON_FORCE_OWN_SERVER = '1';
addEmbeddedGit();

const OPEN_LOCAL_EXPRESSION = 'window.cloudcliDesktop && window.cloudcliDesktop.openLocal()';

let alreadyOpened = false;

function openLocalOnce(window) {
  if (window.piecemakerPreparingRuntime) return;
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
  } else {
    await app.whenReady();
  }
  await installDesktopKeepAwake({ app, powerSaveBlocker });
  const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const holdOpen = () => {};
  app.on('window-all-closed', holdOpen);
  const runtime = await initializeCompactRuntime({
    app,
    LocalServerController,
    applicationRoot: appRoot,
    createProgress: () => {
      const window = new BrowserWindow({ width: 440, height: 150, resizable: false, closable: false, autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true } });
      window.piecemakerPreparingRuntime = true;
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><title>PieceMaker</title><body style="font:16px system-ui;padding:20px">Préparation de PieceMaker…<p>Les composants nécessaires sont téléchargés une seule fois.</p><progress></progress></body>')}`);
      return window;
    },
  });
  // Avant electron/main.js : le serveur local lit les plugins (et lance leurs
  // sous-processus) une seule fois, à son démarrage. Le bundle et son sync.mjs
  // sont produits par plugins/toolchain (voir docs/plugins.md).
  try {
    const bundleDir = path.join(runtime.applicationRoot, 'piecemaker-plugins');
    const { syncPlugins } = await import(pathToFileURL(path.join(bundleDir, 'sync.mjs')).href);
    const dataRoot = process.env.CLOUDCLI_HOME || path.join(os.homedir(), loadProductConfig().dataDirectoryName);
    const result = syncPlugins({
      bundleDir,
      dataRoot,
      databasePath: process.env.DATABASE_PATH || path.join(dataRoot, 'auth.db'),
      runtime: app.isPackaged ? portablePluginRuntime(runtime) : {},
    });
    if (result?.failed?.length) {
      await dialog.showMessageBox({ type: 'warning', title: 'Plugins PieceMaker', message: `Plugins indisponibles : ${result.failed.join(', ')}` });
    }
  } catch (error) {
    console.error(`[PieceMaker] Installation des plugins impossible : ${error.message}`);
  }

  await import('../electron/main.js');
  app.off('window-all-closed', holdOpen);

  for (const window of BrowserWindow.getAllWindows()) adoptWindow(window);
}

if (process.argv.includes(UNINSTALL_ARGUMENT)) {
  const { runUninstallFromCommandLine } = await import('../electron/piecemakerUninstall.js');
  await runUninstallFromCommandLine({ app, dialog });
} else {
  void startApplication().catch((error) => {
    console.error('[PieceMaker] Startup failed:', error);
    dialog.showErrorBox?.('Démarrage de PieceMaker impossible', error.message);
    app.quit();
  });
}
