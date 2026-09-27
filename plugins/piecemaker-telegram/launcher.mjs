import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtime = JSON.parse(fs.readFileSync(new URL('./runtime.json', import.meta.url), 'utf8'));
if (typeof runtime.nodePath !== 'string' || !path.isAbsolute(runtime.nodePath)) {
  throw new Error('Runtime Node Telegram introuvable. Réinstallez le plugin Telegram.');
}

if (process.execPath === runtime.nodePath) {
  await import('./server.mjs');
} else {
  const child = spawn(runtime.nodePath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('error', (error) => {
    process.stderr.write(`Telegram : ${error.message}\n`);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  process.on('SIGINT', () => child.kill('SIGINT'));
}
