import fs from 'node:fs/promises';
import path from 'node:path';
import { createUpdateStore } from './store.mjs';
import { createUiHandler } from './delivery.mjs';

export async function installUiUpdates({ app, session, LocalServerController, applicationRoot, log = console.warn }) {
  if (!app.isPackaged || !['darwin', 'win32'].includes(process.platform) || process.env.PIECEMAKER_UI_UPDATES === '0') return;
  const config = JSON.parse(await fs.readFile(path.join(applicationRoot, 'electron-piecemaker/ui-update-runtime.json'), 'utf8'));
  if (!config.publicKey) {
    log('[PieceMaker UI] Aucune clé publique configurée, interface embarquée conservée.');
    return;
  }
  let origin = null;
  let store;
  let interval;
  let trialTimer;
  let rollingBack = false;
  let trialContents;
  const browserSession = session.defaultSession;
  const forward = (request) => browserSession.fetch(request, { bypassCustomProtocolHandlers: true });
  const check = () => store.check().catch((error) => log(`[PieceMaker UI] Vérification reportée : ${error.message}`));
  const handler = createUiHandler({
    getOrigin: () => origin,
    getFiles: () => store?.files,
    embeddedDirectory: path.join(applicationRoot, 'dist'),
    forward,
  });
  browserSession.protocol.handle('http', async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      log(`[PieceMaker UI] Lecture impossible : ${error.message}`);
      return forward(request);
    }
  });

  async function rollback() {
    if (!store?.trial || rollingBack) return;
    rollingBack = true;
    clearTimeout(trialTimer);
    try {
      await store.rollback();
      log('[PieceMaker UI] Retour automatique à la dernière interface valide.');
      if (trialContents && !trialContents.isDestroyed()) trialContents.reloadIgnoringCache();
    } catch (error) {
      log(`[PieceMaker UI] Restauration impossible : ${error.message}`);
    } finally {
      rollingBack = false;
    }
  }

  const observeContents = (_event, contents) => {
    const belongsToApp = () => {
      try { return new URL(contents.getURL()).origin === origin; } catch { return false; }
    };
    contents.on('did-start-navigation', (_navigation, url, _inPlace, isMainFrame) => {
      if (!store?.trial || !isMainFrame || new URL(url).origin !== origin) return;
      trialContents = contents;
      if (trialTimer) return;
      trialTimer = setTimeout(() => { void rollback(); }, 45000);
      trialTimer.unref();
    });
    contents.on('did-finish-load', async () => {
      if (!store?.trial || !belongsToApp()) return;
      try {
        const rendered = await contents.executeJavaScript(`new Promise(resolve => {
          let attempts = 0;
          const timer = setInterval(() => {
            if (document.getElementById('root')?.childElementCount > 0) { clearInterval(timer); resolve(true); }
            else if (++attempts >= 100) { clearInterval(timer); resolve(false); }
          }, 200);
        })`);
        if (!rendered) return rollback();
        if (!contents.isDestroyed() && belongsToApp()) {
          await store.confirm();
          clearTimeout(trialTimer);
        }
      } catch {
        await rollback();
      }
    });
    contents.on('did-fail-load', (_failure, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3 && belongsToApp()) void rollback();
    });
    contents.on('render-process-gone', () => {
      if (belongsToApp()) void rollback();
    });
  };
  app.on('web-contents-created', observeContents);

  const resolveLocalServerUrl = LocalServerController.prototype.resolveLocalServerUrl;
  LocalServerController.prototype.resolveLocalServerUrl = async function () {
    const url = await resolveLocalServerUrl.call(this);
    if (process.env.ELECTRON_DEV_URL || origin) return url;
    try {
      store = await createUpdateStore({ directory: path.join(this.dataRoot, 'ui-updates', config.runtime), config, log });
      origin = new URL(url).origin;
      await browserSession.clearStorageData({ origin, storages: ['serviceworkers', 'cachestorage'] });
      void check();
      interval = setInterval(check, 30 * 60 * 1000);
      interval.unref();
    } catch (error) {
      origin = null;
      log(`[PieceMaker UI] Interface embarquée conservée : ${error.message}`);
    }
    return url;
  };
  app.once('quit', () => {
    clearInterval(interval);
    clearTimeout(trialTimer);
    app.off('web-contents-created', observeContents);
    browserSession.protocol.unhandle('http');
  });
}
