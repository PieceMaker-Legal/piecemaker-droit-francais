import { spawn, spawnSync } from 'node:child_process';

export function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error || null,
  };
}

export function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return runCapture(probe, [command]).code === 0;
}

export function runStreaming(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.quiet ? 'ignore' : 'inherit',
      windowsHide: true,
      ...options,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} a échoué (code ${code})`));
    });
  });
}

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitUntil(probe, { timeoutMs = 60_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() >= deadline) return false;
    await delay(intervalMs);
  }
}
