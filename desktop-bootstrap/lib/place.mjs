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

const LOCKED_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const REMOVE_OPTIONS = { recursive: true, force: true, maxRetries: 5 };

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function moveAside(destination, previous, attempts, delayMs) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(destination, previous);
      return;
    } catch (error) {
      if (!LOCKED_CODES.has(error.code)) throw error;
      if (attempt >= attempts) {
        throw new Error(`${destination} est encore utilisé (${error.code}) : fermez ${PRODUCT_NAME} puis relancez l'installation. L'application en place n'a pas été modifiée.`);
      }
      await wait(delayMs);
    }
  }
}

export async function replaceDirectory(source, destination, copy, { attempts = 20, delayMs = 500 } = {}) {
  const previous = path.join(path.dirname(destination), `.${path.basename(destination)}.previous`);
  await fs.rm(previous, REMOVE_OPTIONS);
  const hadPrevious = await exists(destination);
  if (hadPrevious) await moveAside(destination, previous, attempts, delayMs);
  try {
    await copy(source, destination);
  } catch (error) {
    await fs.rm(destination, REMOVE_OPTIONS);
    if (hadPrevious) await fs.rename(previous, destination);
    throw error;
  }
  try {
    await fs.rm(previous, REMOVE_OPTIONS);
  } catch {
    ui.warn(`Ancienne version conservée dans ${previous} : elle sera retirée à la prochaine installation.`);
  }
}

export function stopProcessesScript(directory) {
  const running = `@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith(${quote(`${directory}\\`)}, [StringComparison]::OrdinalIgnoreCase) })`;
  return [
    `function Running { ${running} }`,
    '$found = Running',
    'foreach ($process in $found) { try { $null = (Get-Process -Id $process.ProcessId -ErrorAction Stop).CloseMainWindow() } catch {} }',
    '$deadline = (Get-Date).AddSeconds(15)',
    'while ((Running).Count -gt 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }',
    'foreach ($process in Running) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }',
    '$found.Count',
  ].join('; ');
}

function closeRunningCopies(destination) {
  try {
    const stopped = Number.parseInt(powershell(stopProcessesScript(destination)), 10) || 0;
    if (stopped > 0) ui.detail(`${PRODUCT_NAME} était ouvert : ${stopped} processus fermé(s) avant le remplacement.`);
  } catch (error) {
    ui.warn(`Fermeture automatique de ${PRODUCT_NAME} impossible (${error.message}).`);
  }
}

async function placeOnMac(builtApp) {
  const target = await pickTarget();
  const destination = path.join(target, `${PRODUCT_NAME}.app`);
  await replaceDirectory(builtApp, destination, async (from, to) => mustCapture('ditto', [from, to]));
  capture('xattr', ['-dr', 'com.apple.quarantine', destination]);
  return destination;
}

async function placeOnWindows(builtDir) {
  const target = await pickTarget();
  const destination = path.join(target, PRODUCT_NAME);
  closeRunningCopies(destination);
  await replaceDirectory(builtDir, destination, (from, to) => fs.cp(from, to, { recursive: true }));
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
