import fs from 'node:fs/promises';
import path from 'node:path';
import { capture, mustCapture, osascript } from './shell.mjs';
import { ui } from './ui.mjs';
import { IS_MAC, PRODUCT_NAME, installTargetCandidates } from './paths.mjs';

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

async function placeOnMac(builtApp) {
  const target = await pickTarget();
  const destination = path.join(target, `${PRODUCT_NAME}.app`);
  await replaceDirectory(builtApp, destination, async (from, to) => mustCapture('ditto', [from, to]));
  capture('xattr', ['-dr', 'com.apple.quarantine', destination]);
  return destination;
}

const MAC_PROCESS_PATTERN = `/${PRODUCT_NAME}.app/Contents/`;
const WINDOWS_IMAGE = `${PRODUCT_NAME}.exe`;
const QUIT_TIMEOUT_MS = 20_000;

function applicationIsRunning() {
  if (IS_MAC) {
    const result = capture('pgrep', ['-f', MAC_PROCESS_PATTERN]);
    return result.code === 0 && result.stdout.split(/\s+/).some(pid => Number(pid) > 0 && Number(pid) !== process.pid);
  }
  const listing = capture('tasklist', ['/FI', `IMAGENAME eq ${WINDOWS_IMAGE}`, '/NH']);
  return listing.stdout.toLowerCase().includes(WINDOWS_IMAGE.toLowerCase());
}

async function waitUntilStopped(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!applicationIsRunning()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return !applicationIsRunning();
}

/** Ferme l'application (et son serveur local) avant de la remplacer. */
export async function quitRunningApplication() {
  if (!applicationIsRunning()) return;
  ui.step(`Fermeture de ${PRODUCT_NAME} (déjà ouvert)…`);
  if (IS_MAC) osascript(`tell application "${PRODUCT_NAME}" to quit`);
  else capture('taskkill', ['/IM', WINDOWS_IMAGE, '/T']);
  if (await waitUntilStopped(QUIT_TIMEOUT_MS)) {
    ui.ok(`${PRODUCT_NAME} fermé.`);
    return;
  }
  if (IS_MAC) capture('pkill', ['-9', '-f', MAC_PROCESS_PATTERN]);
  else capture('taskkill', ['/IM', WINDOWS_IMAGE, '/T', '/F']);
  if (!(await waitUntilStopped(5_000))) {
    throw new Error(`${PRODUCT_NAME} est toujours ouvert — fermez-le puis relancez l'installation.`);
  }
  ui.ok(`${PRODUCT_NAME} fermé de force.`);
}

export async function installApplication(builtArtifact) {
  ui.step("Installation de l'application…");
  if (!IS_MAC) throw new Error('L’installation Windows est gérée par NSIS.');
  const destination = await placeOnMac(builtArtifact);
  ui.ok(`Application installée : ${destination}`);
  return destination;
}

export function launchApplication(installedPath) {
  if (IS_MAC) {
    capture('open', ['-a', installedPath]);
    return;
  }
  capture('cmd.exe', ['/c', 'start', '', path.join(installedPath, `${PRODUCT_NAME}.exe`)]);
}
