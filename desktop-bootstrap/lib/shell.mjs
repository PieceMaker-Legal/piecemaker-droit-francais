import { spawn, spawnSync } from 'node:child_process';

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} a échoué (code ${code}).`));
    });
  });
}

export function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  return {
    code: result.status ?? 1,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

export function mustCapture(command, args, options = {}) {
  const result = capture(command, args, options);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(' ')} a échoué : ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export function powershell(script) {
  return mustCapture('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command', script,
  ]);
}

export function osascript(script) {
  return capture('osascript', ['-e', script]);
}
