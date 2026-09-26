import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

export type ShellEnvironmentState =
  | { status: 'inherited' }
  | { status: 'resolved'; shell: string }
  | { status: 'failed'; shell: string; reason: string };

const RESOLUTION_TIMEOUT_MS = 10_000;

const RESOLUTION_VARIABLES: Record<string, string> = {
  ELECTRON_RUN_AS_NODE: '1',
  ELECTRON_NO_ATTACH_CONSOLE: '1',
  PIECEMAKER_RESOLVING_ENVIRONMENT: '1',
  DISABLE_AUTO_UPDATE: 'true',
  ZSH_TMUX_AUTOSTARTED: 'true',
  ZSH_TMUX_AUTOSTART: 'false',
};

const SHELL_SESSION_VARIABLES = new Set(['_', 'PWD', 'OLDPWD', 'SHLVL', ...Object.keys(RESOLUTION_VARIABLES)]);

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function userShell(environment: NodeJS.ProcessEnv): string {
  return environment.SHELL || os.userInfo().shell || '/bin/zsh';
}

export function extractMarkedEnvironment(output: string, mark: string): Record<string, string> | null {
  const start = output.indexOf(mark);
  const end = output.lastIndexOf(mark);
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(output.slice(start + mark.length, end));
  } catch {
    return null;
  }
}

export function adoptShellEnvironment(target: NodeJS.ProcessEnv, shellEnvironment: Record<string, string>) {
  for (const [key, value] of Object.entries(shellEnvironment)) {
    if (key === 'PATH' || SHELL_SESSION_VARIABLES.has(key) || target[key] !== undefined) continue;
    target[key] = value;
  }
  const entries = [...(shellEnvironment.PATH ?? '').split(path.delimiter), ...(target.PATH ?? '').split(path.delimiter)];
  target.PATH = [...new Set(entries.filter(Boolean))].join(path.delimiter);
}

function readShellEnvironment(shell: string): Promise<Record<string, string>> {
  const mark = randomUUID().replace(/-/g, '').slice(0, 12);
  const printEnvironment = `${quoteForShell(process.execPath)} -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
  return new Promise((resolve, reject) => {
    const child = spawn(shell, ['-i', '-l', '-c', printEnvironment], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...RESOLUTION_VARIABLES },
    });
    let output = '';
    let errorOutput = '';
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      reject(new Error(`le shell ${shell} n'a pas répondu en ${RESOLUTION_TIMEOUT_MS / 1000} s`));
    }, RESOLUTION_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { errorOutput += chunk.toString(); });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`impossible de lancer ${shell} : ${error.message}`));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      const environment = extractMarkedEnvironment(output, mark);
      if (environment) {
        resolve(environment);
        return;
      }
      const detail = errorOutput.trim().split('\n').slice(-3).join(' ').slice(0, 300);
      reject(new Error(`le shell ${shell} s'est arrêté (code ${code}) sans fournir son environnement${detail ? ` : ${detail}` : ''}`));
    });
  });
}

export async function resolveDesktopShellEnvironment(): Promise<ShellEnvironmentState> {
  if (process.platform === 'win32' || process.env.ELECTRON_RUN_AS_NODE !== '1') return { status: 'inherited' };
  const shell = userShell(process.env);
  try {
    adoptShellEnvironment(process.env, await readShellEnvironment(shell));
    return { status: 'resolved', shell };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[piecemaker] environnement du shell non résolu, PATH de base conservé : ${reason}`);
    return { status: 'failed', shell, reason };
  }
}

export function createShellEnvironmentRouter(state: ShellEnvironmentState) {
  const router = express.Router();
  router.get('/shell-environment', (_request, response) => {
    response.json(state);
  });
  return router;
}
