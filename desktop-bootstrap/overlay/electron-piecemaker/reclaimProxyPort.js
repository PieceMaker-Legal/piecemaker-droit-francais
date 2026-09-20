import { execFileSync } from 'node:child_process';

const PROXY_PORT = 4111;
const RECLAIMABLE_PROCESSES = new Set(['node', 'PieceMaker', 'Electron', 'PieceMake']);

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

function terminate(pid) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

export function reclaimProxyPort() {
  const reclaimed = [];
  for (const { pid, command } of currentListeners()) {
    if (pid === process.pid) continue;
    if (!RECLAIMABLE_PROCESSES.has(command)) continue;
    if (terminate(pid)) reclaimed.push(`${command}(${pid})`);
  }
  if (reclaimed.length) {
    const clock = new Int32Array(new SharedArrayBuffer(4));
    const deadline = Date.now() + 5000;
    while (currentListeners().length && Date.now() < deadline) {
      Atomics.wait(clock, 0, 0, 200);
    }
  }
  return reclaimed;
}
