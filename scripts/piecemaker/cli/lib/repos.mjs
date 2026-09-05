import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { PIECEMAKER_HOME } from './config.mjs';
import { runCapture, runStreaming } from './exec.mjs';
import { npmPath, runtimeEnv } from './node-runtime.mjs';

const STAMP_DIR = path.join(PIECEMAKER_HOME, 'install-stamps');

function isGitRepository(directory) {
  return fs.existsSync(path.join(directory, '.git'));
}

function git(directory, args) {
  return runCapture('git', ['-C', directory, ...args]);
}

function currentBranch(directory) {
  const result = git(directory, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return result.code === 0 ? result.stdout.trim() : null;
}

function hasLocalChanges(directory) {
  const result = git(directory, ['status', '--porcelain']);
  return result.code === 0 && result.stdout.trim().length > 0;
}

function dependencyFingerprint(directory) {
  const lockFile = path.join(directory, 'package-lock.json');
  const manifest = path.join(directory, 'package.json');
  const source = fs.existsSync(lockFile) ? lockFile : manifest;
  if (!fs.existsSync(source)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
}

function stampPath(repo) {
  return path.join(STAMP_DIR, `${repo.key}.json`);
}

function readStamp(repo) {
  try {
    return JSON.parse(fs.readFileSync(stampPath(repo), 'utf8'));
  } catch {
    return {};
  }
}

function writeStamp(repo, data) {
  fs.mkdirSync(STAMP_DIR, { recursive: true });
  fs.writeFileSync(stampPath(repo), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function ensureRepository(repo, runtime, report) {
  if (!isGitRepository(repo.directory)) {
    report.step(`${repo.label} — clonage`);
    fs.mkdirSync(path.dirname(repo.directory), { recursive: true });
    await runStreaming('git', ['clone', '--branch', repo.branch, repo.remote, repo.directory], {
      env: runtimeEnv(runtime),
    });
    return { cloned: true, updated: true };
  }

  const fetched = git(repo.directory, ['fetch', '--quiet', 'origin', repo.branch]);
  if (fetched.code !== 0) {
    report.warn(`${repo.label} — dépôt distant injoignable, version locale conservée`);
    return { cloned: false, updated: false, offline: true };
  }

  const branch = currentBranch(repo.directory);
  const behind = git(repo.directory, ['rev-list', '--count', `HEAD..origin/${repo.branch}`]);
  const behindCount = Number.parseInt(behind.stdout.trim(), 10) || 0;

  if (behindCount === 0) {
    return { cloned: false, updated: false };
  }

  if (branch !== repo.branch) {
    report.warn(`${repo.label} — branche ${branch} active, ${behindCount} commit(s) non appliqués sur ${repo.branch}`);
    return { cloned: false, updated: false, diverged: true };
  }

  if (hasLocalChanges(repo.directory)) {
    report.warn(`${repo.label} — modifications locales, ${behindCount} commit(s) non appliqués`);
    return { cloned: false, updated: false, dirty: true };
  }

  report.step(`${repo.label} — mise à jour (${behindCount} commit(s))`);
  const merged = git(repo.directory, ['merge', '--ff-only', `origin/${repo.branch}`]);
  if (merged.code !== 0) {
    report.warn(`${repo.label} — mise à jour impossible en avance rapide`);
    return { cloned: false, updated: false, diverged: true };
  }
  return { cloned: false, updated: true };
}

export async function ensureDependencies(repo, runtime, report, { force = false } = {}) {
  if (!fs.existsSync(path.join(repo.directory, 'package.json'))) {
    return { installed: false };
  }

  const fingerprint = dependencyFingerprint(repo.directory);
  const stamp = readStamp(repo);
  const modulesPresent = fs.existsSync(path.join(repo.directory, 'node_modules'));
  const upToDate = modulesPresent && stamp.dependencies === fingerprint && stamp.node === runtime.version;

  if (upToDate && !force) {
    return { installed: false };
  }

  report.step(`${repo.label} — installation des dépendances`);
  const useCleanInstall = fs.existsSync(path.join(repo.directory, 'package-lock.json')) && !modulesPresent;
  await runStreaming(npmPath(runtime), [useCleanInstall ? 'ci' : 'install', '--no-audit', '--no-fund'], {
    cwd: repo.directory,
    env: runtimeEnv(runtime),
  });

  writeStamp(repo, {
    ...readStamp(repo),
    dependencies: dependencyFingerprint(repo.directory),
    node: runtime.version,
    updatedAt: new Date().toISOString(),
  });
  return { installed: true };
}

export function rebuildNativeModules(repo, runtime, report, moduleNames) {
  const present = moduleNames.filter((name) => fs.existsSync(path.join(repo.directory, 'node_modules', name)));
  if (present.length === 0) return;

  const stamp = readStamp(repo);
  if (stamp.nativeNode === runtime.version) return;

  report.step(`${repo.label} — recompilation des modules natifs`);
  runCapture(npmPath(runtime), ['rebuild', ...present], {
    cwd: repo.directory,
    env: runtimeEnv(runtime),
  });
  writeStamp(repo, { ...stamp, nativeNode: runtime.version });
}
