import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { APP, INSTALLER, LOG_DIR, PIECEMAKER_HOME, PORTS } from './config.mjs';
import { runCapture, waitUntil } from './exec.mjs';
import { npmPath, runtimeEnv } from './node-runtime.mjs';

export const APP_LOG = path.join(LOG_DIR, 'application.log');
export const APP_PID_FILE = path.join(PIECEMAKER_HOME, 'application.pid');

function httpReachable(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(true);
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

export function appServerReachable() {
  return httpReachable(`http://127.0.0.1:${PORTS.appServer}/api/auth/status`);
}

export function appClientReachable() {
  return httpReachable(`http://127.0.0.1:${PORTS.appClient}/`);
}

export function startInstallerStack(runtime, report) {
  const entry = path.join(INSTALLER.directory, 'installer', 'bin', 'piecemaker.mjs');
  if (!fs.existsSync(entry)) {
    report.warn('Socle PieceMaker Installer introuvable — administration non démarrée');
    return { started: false };
  }

  report.step('Socle — démarrage de l administration');
  const result = runCapture(runtime.nodePath, [entry, 'start'], {
    cwd: INSTALLER.directory,
    env: runtimeEnv(runtime, { PIECEMAKER_NON_INTERACTIVE: '1' }),
    timeout: 120_000,
  });

  if (result.code !== 0) {
    report.warn(`Socle — démarrage incomplet${result.stderr ? ` : ${result.stderr.trim().split('\n').pop()}` : ''}`);
    return { started: false, output: result.stdout };
  }
  return { started: true, output: result.stdout };
}

export async function startApplication(runtime, report) {
  const alreadyRunning = await appClientReachable() && await appServerReachable();
  if (alreadyRunning) {
    return { started: false, alreadyRunning: true };
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(APP_LOG, `\n[${new Date().toISOString()}] Démarrage de l application\n`, 'utf8');
  const logHandle = fs.openSync(APP_LOG, 'a');

  report.step('Application — démarrage du serveur et du client');
  let child;
  try {
    child = spawn(npmPath(runtime), ['run', 'dev'], {
      cwd: APP.directory,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', logHandle, logHandle],
      env: runtimeEnv(runtime, {
        SERVER_PORT: String(PORTS.appServer),
        PORT: String(PORTS.appServer),
        VITE_PORT: String(PORTS.appClient),
        BROWSER: 'none',
      }),
    });
  } finally {
    fs.closeSync(logHandle);
  }

  child.unref();
  fs.writeFileSync(APP_PID_FILE, String(child.pid), 'utf8');

  const serverUp = await waitUntil(appServerReachable, { timeoutMs: 120_000 });
  const clientUp = await waitUntil(appClientReachable, { timeoutMs: 120_000 });

  return { started: true, pid: child.pid, serverUp, clientUp };
}
