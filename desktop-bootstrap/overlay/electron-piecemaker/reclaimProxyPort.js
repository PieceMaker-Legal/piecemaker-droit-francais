import { execFileSync } from 'node:child_process';

const PROXY_PORT = 4111;
const TERM_GRACE_MS = 2000;
const KILL_GRACE_MS = 3000;

function listenersOnUnix(port) {
  const output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pc'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const listeners = [];
  let pid = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('c') && pid) listeners.push({ pid, command: line.slice(1) });
  }
  return listeners;
}

function listenersOnWindows(port) {
  const script = `Get-NetTCPConnection -LocalPort ${port} -State Listen `
    + '| ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; '
    + 'if ($p) { "$($p.Id) $($p.ProcessName)" } }';
  const output = execFileSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return output
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 2)
    .map(([pid, command]) => ({ pid: Number(pid), command }));
}

function currentListeners() {
  try {
    return process.platform === 'win32' ? listenersOnWindows(PROXY_PORT) : listenersOnUnix(PROXY_PORT);
  } catch {
    return [];
  }
}

function terminate(pid, signal) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' });
    else process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function waitForRelease(graceMs) {
  const clock = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!currentListeners().length) return true;
    Atomics.wait(clock, 0, 0, 100);
  }
  return !currentListeners().length;
}

function reclaimableListeners() {
  return currentListeners().filter(({ pid }) => pid !== process.pid && pid > 1);
}

export function reclaimProxyPort() {
  const reclaimed = [];
  for (const { pid, command } of reclaimableListeners()) {
    if (terminate(pid, 'SIGTERM')) reclaimed.push(`${command}(${pid})`);
  }
  if (!reclaimed.length) return reclaimed;
  if (waitForRelease(TERM_GRACE_MS)) return reclaimed;
  for (const { pid } of reclaimableListeners()) terminate(pid, 'SIGKILL');
  waitForRelease(KILL_GRACE_MS);
  return reclaimed;
}
