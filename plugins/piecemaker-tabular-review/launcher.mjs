import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtime = JSON.parse(fs.readFileSync(new URL('./runtime.json', import.meta.url), 'utf8'));
if (typeof runtime.nodePath !== 'string' || !path.isAbsolute(runtime.nodePath)) {
  throw new Error('Runtime Node Tabular Review introuvable. Réinstallez le plugin Tabular Review.');
}

const server = fileURLToPath(new URL('./dist/server.mjs', import.meta.url));
if (process.execPath === runtime.nodePath) {
  await import('./dist/server.mjs');
} else {
  const child = spawn(runtime.nodePath, [server], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('error', (error) => {
    process.stderr.write(`Tabular Review : ${error.message}\n`);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  process.on('SIGINT', () => child.kill('SIGINT'));
}
