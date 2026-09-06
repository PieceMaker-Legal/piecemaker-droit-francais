#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BIN_DIR } from './lib/config.mjs';
import { ok, banner, detail, warn, blank } from './lib/ui.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const COMMAND_NAME = 'piecemaker';
const isWindows = process.platform === 'win32';

function posixShimTargets() {
  const targets = [path.join(BIN_DIR, COMMAND_NAME)];
  const nodeBinDir = path.dirname(process.execPath);
  if (fs.existsSync(nodeBinDir)) targets.push(path.join(nodeBinDir, COMMAND_NAME));
  return targets;
}

function installPosixShim() {
  const source = fs.readFileSync(path.join(here, 'piecemaker.sh'), 'utf8');
  const installed = [];

  for (const target of posixShimTargets()) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.rmSync(target, { force: true });
      fs.writeFileSync(target, source, 'utf8');
      fs.chmodSync(target, 0o755);
      installed.push(target);
    } catch (error) {
      warn(`${target} non installé : ${error.message}`);
    }
  }
  return installed;
}

function windowsShimDirs() {
  const dirs = [BIN_DIR];
  const nodeBinDir = path.dirname(process.execPath);
  if (fs.existsSync(nodeBinDir)) dirs.push(nodeBinDir);
  return dirs;
}

function installWindowsShim() {
  const script = fs.readFileSync(path.join(here, 'piecemaker.ps1'), 'utf8');
  const launcher = '@echo off\r\n'
    + `powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0${COMMAND_NAME}.ps1" %*\r\n`;
  const installed = [];

  for (const dir of windowsShimDirs()) {
    const scriptTarget = path.join(dir, `${COMMAND_NAME}.ps1`);
    const launcherTarget = path.join(dir, `${COMMAND_NAME}.cmd`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(scriptTarget, script, 'utf8');
      fs.writeFileSync(launcherTarget, launcher, 'utf8');
      installed.push(launcherTarget);
    } catch (error) {
      warn(`${launcherTarget} non installé : ${error.message}`);
    }
  }
  return installed;
}

function ensurePosixPathEntry() {
  const shellFiles = ['.zshrc', '.bashrc', '.profile']
    .map((name) => path.join(os.homedir(), name))
    .filter((file) => fs.existsSync(file));

  const line = `export PATH="${BIN_DIR}:$PATH"`;
  const changed = [];

  for (const file of shellFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes(BIN_DIR)) continue;
    fs.appendFileSync(file, `\n# PieceMaker\n${line}\n`, 'utf8');
    changed.push(file);
  }
  return changed;
}

function readWindowsUserPath() {
  let output = '';
  try {
    output = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], { encoding: 'utf8' });
  } catch {
    return '';
  }
  const match = output.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/);
  return match ? match[1].trim() : '';
}

function ensureWindowsPathEntry() {
  const currentUserPath = readWindowsUserPath();
  if (currentUserPath.split(';').some((entry) => entry.trim().toLowerCase() === BIN_DIR.toLowerCase())) {
    return false;
  }

  const nextPath = currentUserPath ? `${currentUserPath};${BIN_DIR}` : BIN_DIR;
  execFileSync('setx', ['PATH', nextPath]);
  return true;
}

function main() {
  banner('Installation de la commande piecemaker');

  const shims = isWindows ? installWindowsShim() : installPosixShim();
  for (const shim of shims) ok(`commande installée : ${shim}`);

  if (isWindows) {
    try {
      if (ensureWindowsPathEntry()) detail(`PATH complété (redémarrez le terminal pour le prendre en compte)`);
    } catch (error) {
      warn(`PATH non complété automatiquement : ${error.message}`);
    }
  } else {
    const pathFiles = ensurePosixPathEntry();
    for (const file of pathFiles) detail(`PATH complété dans ${file}`);
  }

  blank();
  detail(`${COMMAND_NAME} installe, met à jour et lance toute la plateforme`);
  blank();
}

main();
