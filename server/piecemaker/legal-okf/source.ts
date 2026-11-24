import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Clone local du dépôt Legal-OKF (guidelines et templates du cabinet), rangé dans le brain de l'agent central. */
export const DEFAULT_REPOSITORY = 'https://github.com/PieceMaker-Legal/Legal-OKF.git';
export const LIBRARY_FOLDER = 'Library';
const GIT_TIMEOUT_MS = 120000;

export type GitResult = { code: number; stdout: string; stderr: string };
export type Git = (args: string[], cwd: string) => Promise<GitResult>;

export const runGit: Git = (args, cwd) => new Promise((resolve) => {
  execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
    resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout).trim(), stderr: String(stderr || error?.message || '').trim() });
  });
});

type SourceOptions = { home: string; brainRoot: () => string; git?: Git; env?: NodeJS.ProcessEnv };

export function openSource({ home, brainRoot, git = runGit, env = process.env }: SourceOptions) {
  const configFile = path.join(home, 'legal-okf.json');
  const clone = () => path.join(brainRoot(), LIBRARY_FOLDER);
  /** Le bundle est `okf/` du dépôt ; un dossier sans `okf/` est lui-même le bundle. */
  const bundle = () => fs.existsSync(path.join(clone(), 'okf', 'index.md')) ? path.join(clone(), 'okf') : clone();

  function config() {
    let stored: Record<string, unknown> = {};
    try { stored = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { stored = {}; }
    return {
      repository: env.PIECEMAKER_LEGAL_OKF_REPO || (typeof stored.repository === 'string' ? stored.repository : DEFAULT_REPOSITORY),
      branch: env.PIECEMAKER_LEGAL_OKF_BRANCH || (typeof stored.branch === 'string' ? stored.branch : 'main'),
      last_sync: typeof stored.last_sync === 'string' ? stored.last_sync : null,
    };
  }

  const present = () => fs.existsSync(path.join(bundle(), 'index.md'));

  /** Clone au premier appel, puis `pull --ff-only` : une guideline modifiée localement n'est jamais écrasée. */
  async function sync() {
    const { repository, branch } = config();
    const target = clone();
    const result = fs.existsSync(path.join(target, '.git'))
      ? await git(['pull', '--ff-only', 'origin', branch], target)
      : fs.existsSync(target) && fs.readdirSync(target).length
        ? { code: 1, stdout: '', stderr: `${target} existe et n'est pas un clone git : déplacez-le ou videz-le.` }
        : (fs.mkdirSync(path.dirname(target), { recursive: true }), await git(['clone', '--branch', branch, repository, target], path.dirname(target)));
    if (result.code !== 0) throw Object.assign(new Error(`Legal-OKF : ${result.stderr || 'échec de git'}`), { code: 502 });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(configFile, `${JSON.stringify({ ...config(), last_sync: new Date().toISOString() }, null, 2)}\n`);
    return { path: target, message: result.stdout };
  }

  return { config, clone, bundle, present, sync };
}
