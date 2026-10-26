import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER = path.join(ROOT, 'scripts', 'launcher.py');

function piecemakerHome() {
  return process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker');
}

function pythonFromConfig(home) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
    if (typeof config.pythonPath === 'string' && fs.existsSync(config.pythonPath)) return { executable: config.pythonPath, shared: config.pythonRuntime?.kind === 'shared' };
  } catch {}
  return null;
}

const home = piecemakerHome();
const python = pythonFromConfig(home);
const envFile = process.env.LEGIFRANCE_ENV_FILE || path.join(os.homedir(), '.config', 'mcp-legifrance', '.env');
const child = spawn(python?.executable || (process.platform === 'win32' ? 'python' : 'python3'), [LAUNCHER, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PIECEMAKER_HOME: home,
    PIECEMAKER_SHARED_PYTHON: python?.shared ? '1' : '0',
    PYTHONIOENCODING: 'utf-8',
    ...(fs.existsSync(envFile) ? { LEGIFRANCE_ENV_FILE: envFile } : {}),
  },
});
child.on('error', (error) => {
  console.error(`Impossible de démarrer Légifrance MCP : ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
