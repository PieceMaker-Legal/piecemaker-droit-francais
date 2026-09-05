import net from 'node:net';

import { delay, runCapture } from './exec.mjs';

function parsePidList(output) {
  return [...new Set(
    String(output || '')
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
  )];
}

export function findListeningPids(port) {
  if (process.platform === 'win32') {
    const powershell = runCapture('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$ErrorActionPreference='SilentlyContinue'; @(Get-NetTCPConnection -State Listen -LocalPort ${port}).OwningProcess`,
    ]);
    return parsePidList(powershell.stdout);
  }

  const lsof = runCapture('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']);
  if (!lsof.error) return parsePidList(lsof.stdout);

  const fuser = runCapture('fuser', ['-n', 'tcp', String(port)]);
  if (!fuser.error) return parsePidList(fuser.stdout);

  const ss = runCapture('ss', ['-H', '-ltnp', 'sport', '=', `:${port}`]);
  if (!ss.error) {
    return [...new Set(
      [...ss.stdout.matchAll(/pid=(\d+)/g)]
        .map((match) => Number.parseInt(match[1], 10))
        .filter((pid) => pid > 0 && pid !== process.pid)
    )];
  }

  return [];
}

export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const settle = (free) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(free);
    };
    socket.setTimeout(700);
    socket.once('connect', () => settle(false));
    socket.once('timeout', () => settle(true));
    socket.once('error', () => settle(true));
  });
}

function signal(pids, signalName) {
  for (const pid of pids) {
    try {
      process.kill(pid, signalName);
    } catch {
      // process already gone or owned by another user
    }
  }
}

export async function freePort(port, { graceMs = 2500, forceMs = 2000 } = {}) {
  const initial = findListeningPids(port);
  if (initial.length === 0 && await isPortFree(port)) {
    return { port, released: true, killed: [] };
  }

  signal(initial, 'SIGTERM');

  const graceDeadline = Date.now() + graceMs;
  while (Date.now() < graceDeadline) {
    await delay(200);
    if (findListeningPids(port).length === 0 && await isPortFree(port)) {
      return { port, released: true, killed: initial };
    }
  }

  const survivors = findListeningPids(port);
  signal(survivors, 'SIGKILL');

  const forceDeadline = Date.now() + forceMs;
  while (Date.now() < forceDeadline) {
    await delay(200);
    if (findListeningPids(port).length === 0 && await isPortFree(port)) {
      return { port, released: true, killed: [...new Set([...initial, ...survivors])] };
    }
  }

  return { port, released: false, killed: [...new Set([...initial, ...survivors])] };
}
