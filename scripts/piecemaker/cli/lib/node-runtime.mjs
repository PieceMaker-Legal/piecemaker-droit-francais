import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MINIMUM_NODE_MAJOR } from './config.mjs';
import { runCapture } from './exec.mjs';

function majorOf(version) {
  return Number.parseInt(String(version).replace(/^v/, '').split('.')[0], 10);
}

function compareVersions(left, right) {
  const toParts = (value) => String(value).replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = toParts(left);
  const b = toParts(right);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

function nvmCandidates() {
  const nvmRoot = process.env.NVM_DIR || path.join(os.homedir(), '.nvm');
  const versionsDir = path.join(nvmRoot, 'versions', 'node');
  let entries = [];
  try {
    entries = fs.readdirSync(versionsDir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => majorOf(entry) >= MINIMUM_NODE_MAJOR)
    .sort((left, right) => compareVersions(right, left))
    .map((entry) => ({ version: entry, binDir: path.join(versionsDir, entry, 'bin') }))
    .filter((candidate) => fs.existsSync(path.join(candidate.binDir, 'node')));
}

export function resolveNodeRuntime() {
  if (majorOf(process.versions.node) >= MINIMUM_NODE_MAJOR) {
    return {
      version: `v${process.versions.node}`,
      nodePath: process.execPath,
      binDir: path.dirname(process.execPath),
      inherited: true,
    };
  }

  const [best] = nvmCandidates();
  if (!best) {
    throw new Error(`Node ${MINIMUM_NODE_MAJOR}+ est requis et introuvable (Node courant : v${process.versions.node}).`);
  }
  return {
    version: best.version,
    nodePath: path.join(best.binDir, 'node'),
    binDir: best.binDir,
    inherited: false,
  };
}

export function runtimeEnv(runtime, extra = {}) {
  return {
    ...process.env,
    PATH: `${runtime.binDir}${path.delimiter}${process.env.PATH || ''}`,
    ...extra,
  };
}

export function npmPath(runtime) {
  const candidate = path.join(runtime.binDir, 'npm');
  if (fs.existsSync(candidate)) return candidate;
  return 'npm';
}

export function gitAvailable() {
  return runCapture('git', ['--version']).code === 0;
}
