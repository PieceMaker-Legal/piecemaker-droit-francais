import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { APP, LOG_DIR, PIECEMAKER_HOME, PORTS } from './config.mjs';
import { waitUntil } from './exec.mjs';
import { npmPath, runtimeEnv } from './node-runtime.mjs';
import { freePort } from './ports.mjs';

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

function anonymizerPort() {
  try {
    const port = Number.parseInt(JSON.parse(fs.readFileSync(path.join(PIECEMAKER_HOME, 'config.json'), 'utf8')).mikePiiPort, 10);
    if (Number.isInteger(port) && port > 0) return port;
  } catch {
  }
  return PORTS.anonymizer;
}

function stopPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  if (process.platform === 'win32') {
    try { process.kill(pid, 'SIGTERM'); return true; } catch { return false; }
  }
  try { process.kill(-pid, 'SIGTERM'); return true; } catch {
    try { process.kill(pid, 'SIGTERM'); return true; } catch { return false; }
  }
}

export async function stopApplication() {
  const killed = [];
  const occupied = [];
  try {
    const pid = Number.parseInt(fs.readFileSync(APP_PID_FILE, 'utf8'), 10);
    if (stopPid(pid)) killed.push(pid);
  } catch {
  }

  for (const port of [PORTS.appClient, PORTS.appServer, anonymizerPort()]) {
    const result = await freePort(port);
    killed.push(...result.killed);
    if (!result.released) occupied.push(port);
  }

  try { fs.rmSync(APP_PID_FILE, { force: true }); } catch { }
  return { killed: [...new Set(killed)], occupied };
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
