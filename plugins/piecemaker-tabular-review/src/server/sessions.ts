import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import type { Provider } from '../shared.js';
import { PIECEMAKER_HOME, PLUGIN_HOME, UserError } from './paths.js';

type Runtime = {
  nodePath?: string;
  claudePath?: string | null;
  codexPath?: string | null;
  codexLauncher?: string | null;
};

export type SessionRequest = {
  provider: Provider;
  model: string;
  mode: 'inline' | 'path';
  system: string;
  user: string;
  readableDirectory: string;
  environment: NodeJS.ProcessEnv;
  signal: AbortSignal;
};

const INLINE_TIMEOUT_MS = 10 * 60_000;
const PATH_TIMEOUT_MS = 25 * 60_000;
const MAX_OUTPUT = 5 * 1024 * 1024;
const PATH_TOOLS = 'Read,Grep,Glob';

let runtimeCache: Runtime | null = null;

function runtime(): Runtime {
  if (runtimeCache) return runtimeCache;
  try {
    runtimeCache = JSON.parse(fs.readFileSync(new URL('../runtime.json', import.meta.url), 'utf8')) as Runtime;
  } catch {
    runtimeCache = {};
  }
  return runtimeCache;
}

export function assertModel(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w.:/[\]-]{1,120}$/.test(value)) throw new UserError('Modèle IA invalide.');
  return value;
}

export function assertProvider(value: unknown): Provider {
  if (value !== 'claude' && value !== 'codex') throw new UserError('Fournisseur IA non pris en charge.');
  return value;
}

export function assertProxyOrigin(value: unknown): string {
  let url: URL;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new UserError('Proxy d’anonymisation indisponible : lancement refusé.');
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port) {
    throw new UserError('Proxy d’anonymisation invalide : lancement refusé.');
  }
  return `http://127.0.0.1:${url.port}`;
}

export function probeProxy(origin: string): Promise<void> {
  const port = Number(new URL(origin).port);
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const fail = () => {
      socket.destroy();
      reject(new UserError('Le proxy d’anonymisation ne répond pas : lancement refusé. Relancez PieceMaker.'));
    };
    socket.setTimeout(1500, fail);
    socket.once('error', fail);
    socket.once('connect', () => {
      socket.end();
      resolve();
    });
  });
}

export function proxyEnvironment(origin: string): NodeJS.ProcessEnv {
  const certificates = path.join(PIECEMAKER_HOME, 'certs');
  const authority = path.join(certificates, 'piecemaker-ca.crt');
  const trustBundle = path.join(certificates, 'piecemaker-trust-bundle.pem');
  if (!fs.existsSync(authority) || !fs.existsSync(trustBundle)) {
    throw new UserError('Autorité de certification locale absente : l’anonymisation ne peut pas filtrer ces sessions.');
  }
  return {
    HTTPS_PROXY: origin,
    https_proxy: origin,
    NO_PROXY: 'localhost,127.0.0.1,::1',
    NODE_USE_ENV_PROXY: '1',
    NODE_EXTRA_CA_CERTS: authority,
    SSL_CERT_FILE: trustBundle,
    CODEX_CA_CERTIFICATE: authority,
    REQUESTS_CA_BUNDLE: trustBundle,
  };
}

export function sessionEnvironment(origin: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, ...proxyEnvironment(origin) };
  for (const key of ['HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) delete environment[key];
  return environment;
}

function workDirectory(): string {
  const directory = path.join(PLUGIN_HOME, 'work');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

type Command = { command: string; args: string[]; outputFile?: string };

function claudeCommand(request: SessionRequest): Command {
  const tools = request.mode === 'path' ? PATH_TOOLS : '';
  return {
    command: runtime().claudePath || 'claude',
    args: [
      '-p',
      '--no-session-persistence',
      '--model', request.model,
      '--output-format', 'text',
      '--system-prompt', request.system,
      '--strict-mcp-config',
      '--permission-mode', 'dontAsk',
      '--tools', tools,
      ...(request.mode === 'path' ? ['--allowedTools', PATH_TOOLS, '--add-dir', request.readableDirectory] : []),
    ],
  };
}

function codexCommand(request: SessionRequest, directory: string): Command {
  const outputFile = path.join(directory, `codex-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  const args = ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '-C', directory, '-m', request.model, '-o', outputFile, '-'];
  const { nodePath, codexLauncher, codexPath } = runtime();
  if (nodePath && codexLauncher && fs.existsSync(codexLauncher)) return { command: nodePath, args: [codexLauncher, ...args], outputFile };
  return { command: codexPath || 'codex', args, outputFile };
}

export function runSession(request: SessionRequest): Promise<string> {
  const directory = workDirectory();
  const { command, args, outputFile } = request.provider === 'claude' ? claudeCommand(request) : codexCommand(request, directory);
  const input = request.provider === 'claude' ? request.user : `${request.system}\n\n---\n\n${request.user}`;
  return new Promise((resolve, reject) => {
    if (request.signal.aborted) {
      reject(new Error('Annulée.'));
      return;
    }
    const child = spawn(command, args, {
      cwd: directory,
      env: request.environment,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error: Error | null, output = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
      if (outputFile) fs.rmSync(outputFile, { force: true });
      if (error) reject(error);
      else resolve(output);
    };
    const abort = () => {
      child.kill('SIGTERM');
      finish(new Error('Annulée.'));
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error('Délai dépassé pour cette session IA.'));
    }, request.mode === 'path' ? PATH_TIMEOUT_MS : INLINE_TIMEOUT_MS);
    request.signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    });
    child.on('error', (error) => finish(new Error(`Impossible de lancer ${request.provider} : ${error.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(`Session ${request.provider} terminée en erreur (code ${code}) : ${(stderr || stdout).trim().slice(-600)}`));
        return;
      }
      let output = stdout;
      if (outputFile && fs.existsSync(outputFile)) output = fs.readFileSync(outputFile, 'utf8');
      finish(null, output);
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}
