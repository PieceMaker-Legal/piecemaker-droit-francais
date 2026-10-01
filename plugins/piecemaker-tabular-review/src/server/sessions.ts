import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
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
  const environment: NodeJS.ProcessEnv = { USER: os.userInfo().username, ...process.env, ...proxyEnvironment(origin) };
  for (const key of ['HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) delete environment[key];
  return environment;
}

function workDirectory(): string {
  const directory = path.join(PLUGIN_HOME, 'work');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

type Command = { command: string; args: string[]; outputFile?: string };

export type Conversation = {
  send(text: string): Promise<string>;
  close(): void;
};

function turnTimeout(request: SessionRequest): number {
  return request.mode === 'path' ? PATH_TIMEOUT_MS : INLINE_TIMEOUT_MS;
}

function spawnCommand(command: string, args: string[], request: SessionRequest, directory: string) {
  return spawn(command, args, {
    cwd: directory,
    env: request.environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
  });
}

function claudeCommand(request: SessionRequest): Command {
  const tools = request.mode === 'path' ? PATH_TOOLS : '';
  return {
    command: runtime().claudePath || 'claude',
    args: [
      '-p',
      '--no-session-persistence',
      '--model', request.model,
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
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

type Pending = {
  resolve(output: string): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

function claudeConversation(request: SessionRequest): Conversation {
  const { command, args } = claudeCommand(request);
  let child: ReturnType<typeof spawnCommand> | null = null;
  let pending: Pending | null = null;
  let failure: Error | null = request.signal.aborted ? new Error('Annulée.') : null;
  let buffer = '';
  let stderr = '';

  const settle = (error: Error | null, output = '') => {
    const current = pending;
    if (!current) return;
    pending = null;
    clearTimeout(current.timer);
    if (error) current.reject(error);
    else current.resolve(output);
  };
  const fail = (error: Error) => {
    failure ??= error;
    settle(failure);
    request.signal.removeEventListener('abort', abort);
    child?.kill('SIGTERM');
  };
  const abort = () => fail(new Error('Annulée.'));
  const handle = (line: string) => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event.type !== 'result') return;
    if (event.is_error === true || event.subtype !== 'success') settle(new Error(`Session claude en erreur : ${String(event.result ?? event.subtype ?? '').trim().slice(0, 600)}`));
    else settle(null, typeof event.result === 'string' ? event.result : '');
  };
  const start = () => {
    const worker = spawnCommand(command, args, request, workDirectory());
    child = worker;
    request.signal.addEventListener('abort', abort, { once: true });
    worker.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) handle(line);
      }
      if (buffer.length > MAX_OUTPUT) buffer = '';
    });
    worker.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    });
    worker.on('error', (error) => fail(new Error(`Impossible de lancer claude : ${error.message}`)));
    worker.on('close', (code) => {
      request.signal.removeEventListener('abort', abort);
      failure ??= new Error(`Session claude terminée${code ? ` en erreur (code ${code})` : ''} : ${stderr.trim().slice(-600) || 'aucune réponse'}`);
      settle(failure);
    });
    worker.stdin.on('error', () => undefined);
    return worker;
  };

  return {
    send(text) {
      if (failure) return Promise.reject(failure);
      if (pending) return Promise.reject(new Error('Un message est déjà en attente de réponse dans cette session.'));
      const worker = child ?? start();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error('Délai dépassé pour cette session IA.')), turnTimeout(request));
        pending = { resolve, reject, timer };
        worker.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`);
      });
    },
    close() {
      failure ??= new Error('Session fermée.');
      settle(failure);
      request.signal.removeEventListener('abort', abort);
      if (!child || child.exitCode !== null) return;
      const worker = child;
      worker.stdin.end();
      setTimeout(() => {
        if (worker.exitCode === null) worker.kill('SIGTERM');
      }, 5000).unref();
    },
  };
}

function runCodexTurn(request: SessionRequest, input: string): Promise<string> {
  const directory = workDirectory();
  const { command, args, outputFile } = codexCommand(request, directory);
  return new Promise((resolve, reject) => {
    if (request.signal.aborted) {
      reject(new Error('Annulée.'));
      return;
    }
    const child = spawnCommand(command, args, request, directory);
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
    }, turnTimeout(request));
    request.signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    });
    child.on('error', (error) => finish(new Error(`Impossible de lancer codex : ${error.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        finish(new Error(`Session codex terminée en erreur (code ${code}) : ${(stderr || stdout).trim().slice(-600)}`));
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

export function codexTranscript(system: string, turns: { user: string; assistant?: string }[]): string {
  const parts = [system, '---', turns[0]?.user ?? ''];
  for (let index = 1; index < turns.length; index += 1) {
    parts.push(`=== Ta réponse ===\n${turns[index - 1].assistant ?? ''}`, `=== Nouveau message ===\n${turns[index].user}`);
  }
  if (turns.length > 1) parts.push('Réponds uniquement au dernier message, en tenant compte de toute la conversation ci-dessus.');
  return parts.join('\n\n');
}

function codexConversation(request: SessionRequest): Conversation {
  const turns: { user: string; assistant?: string }[] = [];
  let closed = false;
  return {
    async send(text) {
      if (closed) throw new Error('Session fermée.');
      turns.push({ user: text });
      const output = await runCodexTurn(request, codexTranscript(request.system, turns));
      turns[turns.length - 1].assistant = output;
      return output;
    },
    close() {
      closed = true;
    },
  };
}

export function openSession(request: SessionRequest): Conversation {
  return request.provider === 'claude' ? claudeConversation(request) : codexConversation(request);
}
