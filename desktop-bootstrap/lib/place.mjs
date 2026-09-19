import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { capture, mustCapture, powershell } from './shell.mjs';
import { ui } from './ui.mjs';
import { IS_MAC, PRODUCT_NAME, installTargetCandidates } from './paths.mjs';

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function isWritable(directory) {
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.access(directory, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function pickTarget() {
  for (const candidate of installTargetCandidates()) {
    if (await isWritable(candidate)) return candidate;
  }
  throw new Error("Aucun dossier d'installation accessible en écriture.");
}

async function placeOnMac(builtApp) {
  const target = await pickTarget();
  const destination = path.join(target, `${PRODUCT_NAME}.app`);
  await fs.rm(destination, { recursive: true, force: true });
  mustCapture('ditto', [builtApp, destination]);
  capture('xattr', ['-dr', 'com.apple.quarantine', destination]);
  return destination;
}

async function placeOnWindows(builtDir) {
  const target = await pickTarget();
  const destination = path.join(target, PRODUCT_NAME);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.cp(builtDir, destination, { recursive: true });
  return destination;
}

export async function installApplication(builtArtifact) {
  ui.step("Installation de l'application…");
  const destination = IS_MAC ? await placeOnMac(builtArtifact) : await placeOnWindows(builtArtifact);
  ui.ok(`Application installée : ${destination}`);
  return destination;
}

export function createShortcuts(installedPath) {
  if (IS_MAC) return;

  const executable = path.join(installedPath, `${PRODUCT_NAME}.exe`);
  const startMenu = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', `${PRODUCT_NAME}.lnk`,
  );
  const desktop = path.join(os.homedir(), 'Desktop', `${PRODUCT_NAME}.lnk`);

  powershell([
    '$ErrorActionPreference = "Stop"',
    '$shell = New-Object -ComObject WScript.Shell',
    ...[startMenu, desktop].map((linkPath) => [
      `$link = $shell.CreateShortcut(${quote(linkPath)})`,
      `$link.TargetPath = ${quote(executable)}`,
      `$link.WorkingDirectory = ${quote(installedPath)}`,
      `$link.Description = ${quote(`${PRODUCT_NAME} — plateforme IA pour juristes`)}`,
      '$link.Save()',
    ].join('; ')),
  ].join('; '));

  ui.ok('Raccourcis créés (menu Démarrer et Bureau).');
}

export function launchApplication(installedPath) {
  if (IS_MAC) {
    capture('open', ['-a', installedPath]);
    return;
  }
  capture('cmd.exe', ['/c', 'start', '', path.join(installedPath, `${PRODUCT_NAME}.exe`)]);
}
