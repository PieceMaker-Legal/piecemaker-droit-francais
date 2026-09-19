import path from 'node:path';
import { spawn } from 'node:child_process';

import { APP_URL, PIECEMAKER_HOME } from './config.mjs';
import { macChromiumBrowser, windowsChromiumBrowser } from './pwa.mjs';
import { stopApplication } from './services.mjs';

const DELEGATED_LAUNCH_MS = 3000;

export function pwaProfileDirectory() {
  return path.join(PIECEMAKER_HOME, 'pwa-profile');
}

export function browserExecutable() {
  if (process.platform === 'darwin') {
    const bundle = macChromiumBrowser();
    return bundle ? path.join(bundle, 'Contents', 'MacOS', path.basename(bundle, '.app')) : null;
  }
  if (process.platform === 'win32') return windowsChromiumBrowser();
  return null;
}

function waitForWindow(executable, profileDirectory) {
  return new Promise((resolve) => {
    const child = spawn(executable, [`--app=${APP_URL}`, `--user-data-dir=${profileDirectory}`], {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', (error) => resolve({ opened: false, error }));
    child.once('exit', () => resolve({ opened: true }));
  });
}

export async function runApplicationWindow() {
  const executable = browserExecutable();
  if (!executable) return { supervised: false, reason: 'navigateur Chromium introuvable' };

  const openedAt = Date.now();
  const window = await waitForWindow(executable, pwaProfileDirectory());
  if (!window.opened) return { supervised: false, reason: window.error.message };
  if (Date.now() - openedAt < DELEGATED_LAUNCH_MS) {
    return { supervised: false, reason: 'fenêtre rattachée à un navigateur déjà ouvert' };
  }

  const stopped = await stopApplication();
  return { supervised: true, stopped };
}
