import { app, BrowserWindow } from 'electron';

import { brandChrome } from './brandChrome.js';
import { reclaimProxyPort } from './reclaimProxyPort.js';
import { removeTitlebar } from './removeTitlebar.js';

reclaimProxyPort();
removeTitlebar();

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
  brandChrome(window);
  if (alreadyOpened) return;
  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', () => openLocalOnce(window));
    return;
  }
  openLocalOnce(window);
}

app.on('browser-window-created', (_event, window) => adoptWindow(window));

await import('../electron/main.js');

for (const window of BrowserWindow.getAllWindows()) adoptWindow(window);
