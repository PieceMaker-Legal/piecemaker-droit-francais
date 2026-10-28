/**
 * Step 10 — LibreOffice, moteur de conversion des pièces vers PDF.
 *
 * Une pièce Excel ou Word doit être en PDF avant d'être tamponnée
 * (`POST /api/stamping` → `websocket-server/lib/office-to-pdf.cjs`). Les
 * images et le texte brut sont rendus par `pdf-lib`, sans dépendance ; les
 * formats bureautiques exigent LibreOffice en mode headless, comme le font
 * les skills documentaires officielles d'Anthropic (`anthropics/skills`).
 *
 * Cette étape installe LibreOffice avec le gestionnaire de paquets du système
 * (Homebrew, winget, apt/dnf) et enregistre SOFFICE_PATH quand le binaire
 * n'est pas sur le PATH — sur macOS il vit dans le bundle .app.
 */

import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { log, spinner } from '../lib/ui.mjs';
import { confirm } from '../lib/prompt.mjs';
import { commandExists, run, IS_MAC, IS_WINDOWS, REPO_ROOT } from '../lib/platform.mjs';
import { writeEnv } from '../lib/state.mjs';

const require = createRequire(import.meta.url);
const { findSoffice } = require(`${REPO_ROOT}/websocket-server/lib/office-to-pdf.cjs`);

export const meta = {
  id: '10-libreoffice',
  label: 'Conversion des pièces en PDF (LibreOffice)',
  description: 'Installe LibreOffice, requis pour tamponner les pièces Excel et Word',
};

const MANUAL_URL = 'https://www.libreoffice.org/download/download-libreoffice/';

/** Commande d'installation adaptée au système, ou null si aucun gestionnaire connu. */
function installerCommand() {
  if (IS_MAC) {
    if (commandExists('brew')) return { command: 'brew', args: ['install', '--cask', 'libreoffice'], manager: 'Homebrew' };
    return null;
  }
  if (IS_WINDOWS) {
    if (commandExists('winget', ['--version'])) {
      return {
        command: 'winget',
        args: ['install', '-e', '--id', 'TheDocumentFoundation.LibreOffice',
          '--accept-package-agreements', '--accept-source-agreements'],
        manager: 'winget',
      };
    }
    return null;
  }
  if (commandExists('apt-get', ['--version'])) {
    return { command: 'sudo', args: ['apt-get', 'install', '-y', 'libreoffice'], manager: 'apt' };
  }
  if (commandExists('dnf', ['--version'])) {
    return { command: 'sudo', args: ['dnf', 'install', '-y', 'libreoffice'], manager: 'dnf' };
  }
  return null;
}

/** Enregistre SOFFICE_PATH si le binaire n'est pas joignable par son nom seul. */
function recordPath(soffice) {
  if (soffice === 'soffice' || soffice === 'libreoffice') return;
  writeEnv({ SOFFICE_PATH: soffice });
  log.detail(`SOFFICE_PATH enregistré : ${soffice}`);
}

export async function install(ctx) {
  log.step('Vérification de LibreOffice...');

  const existing = findSoffice();
  if (existing) {
    log.ok(`LibreOffice déjà installé (${existing})`);
    recordPath(existing);
    return { status: 'done', note: '' };
  }

  const installer = installerCommand();

  if (ctx.dryRun) {
    log.info(installer
      ? `[simulation] ${installer.command} ${installer.args.join(' ')}`
      : `[simulation] Installation manuelle depuis ${MANUAL_URL}`);
    return { status: 'skipped', note: 'Mode simulation — aucune modification effectuée.' };
  }

  if (!installer) {
    log.warn('Aucun gestionnaire de paquets reconnu pour installer LibreOffice automatiquement.');
    log.detail(`Installez-le depuis ${MANUAL_URL}, puis relancez cette étape.`);
    log.detail('Binaire déjà présent ailleurs ? Renseignez SOFFICE_PATH dans .env');
    return {
      status: 'failed',
      note: `LibreOffice absent — installation manuelle requise (${MANUAL_URL}). Les pièces Excel et Word ne pourront pas être tamponnées.`,
    };
  }

  log.info('LibreOffice convertit les pièces Excel et Word en PDF avant tamponnage (téléchargement de plusieurs centaines de Mo).');
  const accepted = await confirm(`Installer LibreOffice via ${installer.manager} ?`, true);
  if (!accepted) {
    return {
      status: 'partial',
      note: 'LibreOffice non installé — seules les pièces PDF, images et texte pourront être tamponnées.',
    };
  }

  const spin = spinner(`Installation de LibreOffice (${installer.manager})...`);
  const code = await run(installer.command, installer.args, {
    onLine: (line) => spin.update(line.slice(0, 100)),
  });

  const soffice = findSoffice();
  if (code === 0 && soffice) {
    spin.succeed(`LibreOffice installé (${soffice})`);
    recordPath(soffice);
    return { status: 'done', note: '' };
  }

  spin.fail('Installation de LibreOffice échouée');
  log.detail(`Installez-le manuellement depuis ${MANUAL_URL}, puis relancez cette étape.`);
  return {
    status: 'failed',
    note: `LibreOffice n'a pas pu être installé automatiquement (${installer.manager}, code ${code}). Installation manuelle : ${MANUAL_URL}`,
  };
}

export async function check() {
  const soffice = findSoffice();
  if (soffice) return { status: 'done', note: '' };
  return {
    status: 'failed',
    note: 'LibreOffice introuvable — les pièces Excel et Word ne pourront pas être converties en PDF pour le tamponnage.',
  };
}

export const LIBREOFFICE = {
  version: '26.8.1.1',
  url: 'https://download.documentfoundation.org/libreoffice/stable/26.8.1/win/x86_64/LibreOffice_26.8.1_Win_x86-64.msi',
  sha256: 'c6298b10cfa1748bcbedad94c62ce771e240e5021bfd6d7a967cd571b04b5312',
  sources: 'https://download.documentfoundation.org/libreoffice/src/26.8.1/',
};
export const LIBREOFFICE_DIR = 'libreoffice';
export const LIBREOFFICE_MAC = {
  arm64: {
    ...LIBREOFFICE,
    url: 'https://download.documentfoundation.org/libreoffice/stable/26.8.1/mac/aarch64/LibreOffice_26.8.1_MacOS_aarch64.dmg',
    sha256: 'ca074e0b13571efb30a31fc531c5f95e997030637325e5d5de92d67aefdf0dfc',
  },
  x64: {
    ...LIBREOFFICE,
    url: 'https://download.documentfoundation.org/libreoffice/stable/26.8.1/mac/x86_64/LibreOffice_26.8.1_MacOS_x86-64.dmg',
    sha256: '4c7464313a529e9074400cbcdc894fc40ac4ef9421ded03b16b5a78d12cb155e',
  },
};

export function libreOfficePackage(platform = process.platform, arch = process.arch) {
  if (platform === 'win32' && arch === 'x64') return LIBREOFFICE;
  if (platform === 'darwin' && Object.hasOwn(LIBREOFFICE_MAC, arch)) return LIBREOFFICE_MAC[arch];
  throw new Error(`LibreOffice embarqué non disponible pour ${platform}/${arch}.`);
}

async function extractLibreOffice(archive, destination, platform) {
  if (platform === 'win32') {
    const code = await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'msiexec.exe'), ['/a', archive, '/qn', '/norestart', `TARGETDIR=${destination}`], { windowsHide: true });
    if (code !== 0) throw new Error(`Extraction LibreOffice échouée (code ${code}).`);
    return;
  }
  const mount = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-libreoffice-mount-'));
  const attached = await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, archive]);
  if (attached !== 0) {
    await fs.rmdir(mount);
    throw new Error(`Montage LibreOffice échoué (code ${attached}).`);
  }
  try {
    const copied = await run('/usr/bin/ditto', [path.join(mount, 'LibreOffice.app'), path.join(destination, 'LibreOffice.app')]);
    if (copied !== 0) throw new Error(`Copie LibreOffice échouée (code ${copied}).`);
  } finally {
    const detached = await run('/usr/bin/hdiutil', ['detach', mount]);
    if (detached !== 0) throw new Error(`Démontage LibreOffice échoué (code ${detached}).`);
    await fs.rmdir(mount);
  }
}

export async function embedLibreOffice(stageDir, {
  platform = process.platform,
  arch = process.arch,
  fetchImpl = fetch,
  extract = extractLibreOffice,
} = {}) {
  const metadata = libreOfficePackage(platform, arch);
  const response = await fetchImpl(metadata.url);
  if (!response.ok) throw new Error(`LibreOffice indisponible (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) {
    throw new Error('LibreOffice : empreinte SHA-256 invalide.');
  }
  const destination = path.join(stageDir, LIBREOFFICE_DIR);
  const archive = path.join(stageDir, platform === 'darwin' ? 'libreoffice.dmg' : 'libreoffice.msi');
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(archive, bytes);
  try {
    await extract(archive, destination, platform);
  } finally {
    await fs.rm(archive, { force: true });
  }
  if (platform === 'darwin') {
    await fs.access(path.join(destination, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice'));
    await fs.access(path.join(destination, 'LibreOffice.app', 'Contents', 'Resources', 'LICENSE.html'));
  } else {
    await fs.access(path.join(destination, 'program', 'soffice.com'));
    await fs.access(path.join(destination, 'program', 'soffice.exe'));
    await fs.access(path.join(destination, 'LICENSE.html'));
  }
  await fs.rm(path.join(destination, path.basename(archive)), { force: true });
  await fs.writeFile(path.join(destination, 'PIECEMAKER-SOURCES.txt'), `LibreOffice ${LIBREOFFICE.version}\nDistribution officielle non modifiée.\nSources : ${LIBREOFFICE.sources}\nLicences et notices : fichiers LICENSE et notices fournis dans ce dossier.\nhttps://www.libreoffice.org/licenses/\n`, 'utf8');
  const manifestPath = path.join(stageDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const resources = (manifest.build.extraResources || []).filter(entry => entry?.to !== LIBREOFFICE_DIR);
  manifest.build.extraResources = [...resources, { from: LIBREOFFICE_DIR, to: LIBREOFFICE_DIR }];
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  log.detail(`LibreOffice ${LIBREOFFICE.version} embarqué pour la conversion PDF.`);
}
