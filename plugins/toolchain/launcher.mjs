// Lanceur commun des serveurs de plugins PieceMaker, copié tel quel par
// plugins/toolchain à côté de dist/server.mjs. L'hôte lance `node launcher.mjs`
// avec le `node` du PATH ; on relance le serveur avec le Node qui a construit
// l'application (runtime.json), pour que les modules natifs (better-sqlite3)
// aient la bonne ABI.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtime = JSON.parse(fs.readFileSync(new URL('./runtime.json', import.meta.url), 'utf8'));
if (typeof runtime.nodePath !== 'string' || !path.isAbsolute(runtime.nodePath)) {
  throw new Error('Runtime Node du plugin introuvable : relancez l\'installation de PieceMaker.');
}

const plugin = path.basename(path.dirname(fileURLToPath(import.meta.url)));
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
    process.stderr.write(`${plugin} : ${error.message}\n`);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  process.on('SIGINT', () => child.kill('SIGINT'));
}
