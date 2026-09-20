import fs from 'node:fs/promises';
import { buildDesktopApp } from './build.mjs';
import { generateCertificates, isCaTrusted, signApplication, trustCertificateAuthority } from './certificates.mjs';
import { createShortcuts, installApplication, launchApplication } from './place.mjs';
import { ui } from './ui.mjs';
import {
  IS_MAC,
  IS_WINDOWS,
  PRODUCT_NAME,
  certsDir,
  releaseTag,
  sourceDir,
  trustMarkerPath,
} from './paths.mjs';

const options = new Set(process.argv.slice(2));
const skipCertificates = options.has('--no-certificate');
const skipLaunch = options.has('--no-launch');

async function main() {
  if (!IS_MAC && !IS_WINDOWS) {
    throw new Error('Seuls macOS et Windows sont pris en charge.');
  }
  if (!sourceDir) {
    throw new Error('PIECEMAKER_SRC_DIR est absent — lancez install.sh ou install.ps1.');
  }

  console.log(`\n${PRODUCT_NAME} — installation de l'application de bureau (${releaseTag})`);

  const builtArtifact = await buildDesktopApp(sourceDir);
  const installedPath = await installApplication(builtArtifact);

  if (skipCertificates) {
    ui.warn('Étape certificat ignorée (--no-certificate).');
  } else {
    await runCertificateStep(installedPath);
  }

  createShortcuts(installedPath);

  if (!skipLaunch) {
    ui.step(`Démarrage de ${PRODUCT_NAME}…`);
    launchApplication(installedPath);
  }

  console.log(`\n${PRODUCT_NAME} est installé : ${installedPath}`);
  console.log(`Certificats locaux : ${certsDir}`);
}

async function runCertificateStep(installedPath) {
  ui.step('Certificat local');

  await generateCertificates();

  if (isCaTrusted()) {
    ui.ok('Certificat local déjà reconnu par le système.');
  } else {
    let authorized;
    try {
      authorized = await trustCertificateAuthority();
    } catch (error) {
      ui.warn(`Enregistrement du certificat impossible (${error.message}) — l'application reste utilisable en HTTP local.`);
      return;
    }

    if (!authorized) {
      ui.warn("Enregistrement du certificat refusé — l'application reste utilisable en HTTP local.");
      return;
    }

    await fs.writeFile(
      trustMarkerPath,
      `${JSON.stringify({ trustedAt: new Date().toISOString(), release: releaseTag }, null, 2)}\n`,
      'utf8',
    );
    ui.ok('Certificat local enregistré dans le magasin de confiance.');
  }

  try {
    const identity = await signApplication(installedPath);
    ui.ok(`Application signée avec l'identité locale « ${identity} ».`);
  } catch (error) {
    ui.warn(`Signature locale impossible (${error.message}) — l'application reste utilisable.`);
  }
}

try {
  await main();
} catch (error) {
  ui.fail(error.message);
  process.exitCode = 1;
}
