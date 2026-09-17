import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { APP, LOG_DIR, PIECEMAKER_HOME, PORTS } from './config.mjs';
import { waitUntil } from './exec.mjs';
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

function readLogTail(file, maxLines = 40) {
  try {
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split(/\n/);
    return lines.slice(-maxLines).join('\n');
  } catch {
    return '';
  }
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

  fs.writeFileSync(APP_PID_FILE, String(child.pid), 'utf8');

  const death = new Promise((resolve) => {
    child.once('error', () => resolve('died'));
    child.once('exit', () => resolve('died'));
  });

  await Promise.race([
    waitUntil(appServerReachable, { timeoutMs: 120_000 }),
    death,
  ]);
  const serverUp = await appServerReachable();
  if (!serverUp) {
    child.unref();
    return { started: true, pid: child.pid, serverUp: false, clientUp: false, logTail: readLogTail(APP_LOG) };
  }

  const clientUp = await waitUntil(appClientReachable, { timeoutMs: 120_000 });
  child.unref();
  return { started: true, pid: child.pid, serverUp: true, clientUp, logTail: clientUp ? '' : readLogTail(APP_LOG) };
}
