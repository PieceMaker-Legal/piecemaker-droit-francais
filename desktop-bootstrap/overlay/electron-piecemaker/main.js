import { app } from 'electron';

import '../electron/main.js';

const OPEN_LOCAL_EXPRESSION = 'window.cloudcliDesktop && window.cloudcliDesktop.openLocal()';

let alreadyOpened = false;

function openLocalOnce(window) {
  if (alreadyOpened) return;
  alreadyOpened = true;
  window.webContents.executeJavaScript(OPEN_LOCAL_EXPRESSION, true).catch(() => {
    alreadyOpened = false;
  });
}

app.on('browser-window-created', (_event, window) => {
  if (alreadyOpened) return;
  window.webContents.once('did-finish-load', () => openLocalOnce(window));
});
