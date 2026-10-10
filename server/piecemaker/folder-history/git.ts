import { spawn } from 'node:child_process';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { hasExcludeBlock, isSensitivePath, withExcludeBlock } from './exclude.js';
import type { Identity } from './identity.js';
import { initialMessage, type CommitMessage } from './message.js';

type GitResult = { code: number; stdout: string; stderr: string };

const identityEnv = (identity: Identity) => ({
  GIT_AUTHOR_NAME: identity.name,
  GIT_AUTHOR_EMAIL: identity.email,
  GIT_COMMITTER_NAME: identity.name,
  GIT_COMMITTER_EMAIL: identity.email,
});

const INHERITED_REPOSITORY_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'];

const CONFIG = [
  '-c', 'commit.gpgsign=false',
  '-c', 'core.quotepath=false',
  '-c', 'core.untrackedCache=true',
  '-c', 'core.preloadIndex=true',
];

const LOW_PRIORITY = 10;

export function runGit(cwd: string, args: string[], identity?: Identity): Promise<GitResult> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(identity ? identityEnv(identity) : {}) };
    for (const name of INHERITED_REPOSITORY_VARIABLES) delete env[name];
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const child = spawn('git', [...CONFIG, ...args], { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) {
      try {
        os.setPriority(child.pid, LOW_PRIORITY);
      } catch {}
    }
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => resolve({ code: -1, stdout: '', stderr: String(error) }));
    child.on('close', (code) => resolve({
      code: code ?? -1,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

const excludeFile = (cwd: string) => path.join(cwd, '.git', 'info', 'exclude');

const readText = (file: string) => readFile(file, 'utf8').catch(() => '');

const exists = (file: string) => access(file).then(() => true, () => false);

async function samePath(left: string, right: string): Promise<boolean> {
  try {
    return path.resolve(await realpath(left)) === path.resolve(await realpath(right));
  } catch {
    return false;
  }
}

export async function hasPieceMakerExclude(cwd: string): Promise<boolean> {
  return hasExcludeBlock(await readText(excludeFile(cwd)));
}

async function writeExclude(cwd: string): Promise<void> {
  const file = excludeFile(cwd);
  const current = await readText(file);
  const next = withExcludeBlock(current);
  if (next === current) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, next, 'utf8');
}

let userIdentity: Promise<Identity> | undefined;

async function readGlobalConfig(key: string): Promise<string> {
  const result = await runGit(os.homedir(), ['config', '--global', '--get', key]);
  return result.code === 0 ? result.stdout.trim() : '';
}

function resolveUserIdentity(): Promise<Identity> {
  userIdentity ??= (async () => {
    const { username } = os.userInfo();
    return {
      name: (await readGlobalConfig('user.name')) || username,
      email: (await readGlobalConfig('user.email')) || `${username}@localhost`,
    };
  })();
  return userIdentity;
}

export async function commitAll(cwd: string, compose: (stagedChanges: string) => CommitMessage, author?: Identity): Promise<boolean> {
  if (await exists(path.join(cwd, '.git', 'index.lock'))) return false;
  if ((await runGit(cwd, ['add', '-A'])).code !== 0) return false;
  const staged = await runGit(cwd, ['diff', '--cached', '--name-status']);
  if (staged.code !== 0 || !staged.stdout.trim()) return false;
  const message = compose(staged.stdout);
  const args = ['commit', '--no-verify', '--quiet', '-m', message.subject];
  if (message.body) args.push('-m', message.body);
  return (await runGit(cwd, args, author ?? (await resolveUserIdentity()))).code === 0;
}

// Dépôt vide (« Initialiser » de l'onglet Suivi des modifications) : ni commit ni fichier indexé, rien à préserver.
async function isEmptyRepo(cwd: string): Promise<boolean> {
  if ((await runGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code === 0) return false;
  const indexed = await runGit(cwd, ['ls-files']);
  return indexed.code === 0 && !indexed.stdout.trim();
}

export async function ensureRepo(cwd: string): Promise<boolean> {
  const topLevel = await runGit(cwd, ['rev-parse', '--show-toplevel']);
  if (topLevel.code === -1) return false;
  if (topLevel.code === 0) {
    if (!(await samePath(topLevel.stdout.trim(), cwd))) return false;
    if (!(await hasPieceMakerExclude(cwd)) && !(await isEmptyRepo(cwd))) return false;
  } else if ((await runGit(cwd, ['init', '--quiet'])).code !== 0) {
    return false;
  }
  await writeExclude(cwd);
  const tracked = await runGit(cwd, ['ls-files', '-z']);
  if (tracked.code !== 0) return false;
  if (tracked.stdout.split('\0').some((file) => file && isSensitivePath(file))) {
    console.warn(`[PieceMaker] Historique du dossier désactivé : un fichier sensible y est déjà suivi par Git (${cwd}).`);
    return false;
  }
  if ((await runGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code !== 0) {
    await commitAll(cwd, () => initialMessage());
  }
  return true;
}
