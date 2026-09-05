#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BIN_DIR } from './lib/config.mjs';
import { ok, banner, detail, warn, blank } from './lib/ui.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const COMMAND_NAME = 'piecemaker';

function shimTargets() {
  const targets = [path.join(BIN_DIR, COMMAND_NAME)];
  const nodeBinDir = path.dirname(process.execPath);
  if (fs.existsSync(nodeBinDir)) targets.push(path.join(nodeBinDir, COMMAND_NAME));
  return targets;
}

function installShim() {
  const source = fs.readFileSync(path.join(here, 'piecemaker.sh'), 'utf8');
  const installed = [];

  for (const target of shimTargets()) {
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

function ensurePathEntry() {
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

function main() {
  banner('Installation de la commande piecemaker');

  const shims = installShim();
  for (const shim of shims) ok(`commande installée : ${shim}`);

  const pathFiles = ensurePathEntry();
  for (const file of pathFiles) detail(`PATH complété dans ${file}`);

  blank();
  detail(`${COMMAND_NAME} installe, met à jour et lance toute la plateforme`);
  blank();
}

main();
