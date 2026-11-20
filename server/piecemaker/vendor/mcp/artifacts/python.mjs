import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

/**
 * Interpréteur Python de PieceMaker, celui du pipeline de conversion : même résolution que
 * `pythonExecutable` de `server/piecemaker/knowledge/pipeline.ts` (environnement commun de
 * `~/.piecemaker/config.json`, puis PYTHON_PATH, puis `~/.piecemaker/venv`). Aucun autre
 * interpréteur n'est installé pour les scripts des templates.
 */
export function piecemakerPython({ env = process.env, platform = process.platform, home = env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker') } = {}) {
  let config = null;
  try { config = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')); } catch {}
  const configured = typeof config?.pythonPath === 'string' && fs.existsSync(config.pythonPath) ? config.pythonPath : null;
  if (config?.pythonRuntime?.kind === 'shared') {
    if (!configured) throw Object.assign(new Error('the shared PieceMaker Python environment is missing: reinstall the components of this version.'), { code: 'failed_precondition' });
    return configured;
  }
  if (env.PYTHON_PATH) return env.PYTHON_PATH;
  if (configured) return configured;
  const candidate = platform === 'win32' ? path.join(home, 'venv', 'Scripts', 'python.exe') : path.join(home, 'venv', 'bin', 'python');
  if (fs.existsSync(candidate)) return candidate;
  return platform === 'win32' ? 'python' : 'python3';
}

const RUN_TIMEOUT_MS = 10 * 60 * 1000;

export function runPython(script, args, { cwd, env = {}, python = piecemakerPython(), timeout = RUN_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile(python, [script, ...args], { cwd, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...env } }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr || (error && !stdout ? error.message : '')), python });
    });
  });
}
