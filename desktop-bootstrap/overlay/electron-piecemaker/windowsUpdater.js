import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';

export function createWindowsUpdateAction({ app, dialog, updater }) {
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.installDirectory = path.dirname(app.getPath('exe'));
  updater.on('error', (error) => console.error('[PieceMaker update]', error));
  let pending = null;

  async function update() {
    const result = await updater.checkForUpdates();
    if (!result?.downloadPromise) {
      return { success: true, output: 'PieceMaker est déjà à jour.', message: 'Aucune mise à jour disponible.' };
    }
    await result.downloadPromise;
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Mise à jour PieceMaker',
      message: `La version ${result.updateInfo.version} est téléchargée.`,
      detail: 'Enregistrez vos documents avant de redémarrer pour installer la mise à jour.',
      buttons: ['Redémarrer et installer', 'Plus tard'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) setTimeout(() => updater.quitAndInstall(false, true), 1000);
    return {
      success: true,
      output: response === 0
        ? 'Mise à jour téléchargée. Redémarrage et installation dans quelques secondes.'
        : 'Mise à jour téléchargée. Cliquez de nouveau sur Mettre à jour lorsque vous serez prêt à redémarrer.',
      message: 'Téléchargement terminé.',
    };
  }

  return () => {
    pending ??= update().finally(() => { pending = null; });
    return pending;
  };
}

export async function installWindowsUpdater({ app, dialog, platform = process.platform }) {
  if (platform !== 'win32' || !app.isPackaged) return;
  const { default: electronUpdater } = await import('electron-updater');
  const update = createWindowsUpdateAction({ app, dialog, updater: electronUpdater.autoUpdater });
  const endpoint = `/${randomUUID()}`;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== endpoint) {
      response.writeHead(404).end();
      return;
    }
    try {
      const result = await update();
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: false, error: error.message }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  server.unref();
  process.env.PIECEMAKER_DESKTOP_UPDATE_URL = `http://127.0.0.1:${server.address().port}${endpoint}`;
  app.once('quit', () => server.close());
}
