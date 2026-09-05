#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BIN_DIR, INSTALLER } from './lib/config.mjs';
import { ok, banner, detail, warn, blank } from './lib/ui.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const COMMAND_NAME = 'piecemaker';
const INSTALLER_COMMAND_NAME = 'piecemaker-installer';

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

function renameInstallerCommand() {
  const manifestPath = path.join(INSTALLER.directory, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    return { renamed: false, reason: 'socle absent' };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entry = manifest.bin?.[COMMAND_NAME] || manifest.bin?.[INSTALLER_COMMAND_NAME] || 'installer/bin/piecemaker.mjs';

  manifest.bin = { [INSTALLER_COMMAND_NAME]: entry };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const nodeBinDir = path.dirname(process.execPath);
  const linkPath = path.join(nodeBinDir, INSTALLER_COMMAND_NAME);
  const targetPath = path.join(INSTALLER.directory, entry);

  try {
    fs.rmSync(linkPath, { force: true });
    fs.symlinkSync(targetPath, linkPath);
    fs.chmodSync(targetPath, 0o755);
  } catch (error) {
    return { renamed: true, linked: false, reason: error.message };
  }

  return { renamed: true, linked: true, linkPath };
}

function main() {
  banner('Installation de la commande piecemaker');

  const shims = installShim();
  for (const shim of shims) ok(`commande installée : ${shim}`);

  const pathFiles = ensurePathEntry();
  for (const file of pathFiles) detail(`PATH complété dans ${file}`);

  const installerCommand = renameInstallerCommand();
  if (installerCommand.renamed && installerCommand.linked) {
    ok(`socle renommé : ${INSTALLER_COMMAND_NAME} → ${installerCommand.linkPath}`);
  } else if (installerCommand.renamed) {
    warn(`socle renommé dans package.json mais lien non créé : ${installerCommand.reason}`);
  } else {
    warn(`socle non renommé : ${installerCommand.reason}`);
  }

  blank();
  detail(`${COMMAND_NAME}             installe, met à jour et lance toute la plateforme`);
  detail(`${INSTALLER_COMMAND_NAME}   menu du socle technique (proxy PII, MCP, GLiNER)`);
  blank();
}

main();
