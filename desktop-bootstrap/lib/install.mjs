import fs from 'node:fs/promises';
import { buildDesktopApp, downloadPrebuiltApp } from './build.mjs';
import { generateCertificates, isCaTrusted, signApplication, trustCertificateAuthority } from './certificates.mjs';
import { createShortcuts, installApplication, launchApplication, quitRunningApplication, registerWindowsUninstall } from './place.mjs';
import { finishProgress, openProgressWindow, settleProgressWindow } from './progress.mjs';
import { ui } from './ui.mjs';
import {
  IS_MAC,
  IS_WINDOWS,
  PRODUCT_NAME,
  bootstrapHome,
  certsDir,
  releaseTag,
  sourceDir,
  trustMarkerPath,
} from './paths.mjs';

const options = new Set(process.argv.slice(2));
const skipCertificates = options.has('--no-certificate');
const skipLaunch = options.has('--no-launch');
const skipProgress = options.has('--no-progress');

async function main() {
  if (!IS_MAC && !IS_WINDOWS) {
    throw new Error('Seuls macOS et Windows sont pris en charge.');
  }
  if (!sourceDir) {
    throw new Error('PIECEMAKER_SRC_DIR est absent — lancez install.sh ou install.ps1.');
  }

  await fs.mkdir(bootstrapHome, { recursive: true });
  process.chdir(bootstrapHome);

  if (!skipProgress) await openProgressWindow({ version: releaseTag, offerPiste: !skipLaunch });
  console.log(`\n${PRODUCT_NAME} — installation de l'application de bureau (${releaseTag})`);

  ui.step("Autorité locale du proxy d'anonymisation");
  await generateCertificates();

  let builtArtifact = await downloadPrebuiltApp(bootstrapHome);
  if (!builtArtifact) {
    if (IS_WINDOWS && !options.has('--build-from-source')) {
      throw new Error("Le paquet Windows précompilé est indisponible. L'application actuelle est conservée. Réessayez lorsque la release est prête.");
    }
    builtArtifact = await buildDesktopApp(sourceDir);
  }
  // Une instance encore ouverte garderait son serveur, donc ses plugins, et
  // `open` ou `start` ne ferait que la ramener au premier plan. Avec
  // --no-launch (mise à jour lancée depuis l'application, sous-processus de son
  // serveur : server/piecemaker/desktop-update), c'est l'appelant qui quitte et
  // relance l'application ; la fermer ici tuerait la mise à jour en cours.
  if (!skipLaunch) await quitRunningApplication();
  const installedPath = await installApplication(builtArtifact);

  if (skipCertificates) {
    ui.warn('Étape certificat ignorée (--no-certificate).');
  } else {
    await runCertificateStep(installedPath);
  }

  createShortcuts(installedPath);
  registerWindowsUninstall(installedPath, releaseTag);

  await import('../composants/install.mjs').then((composants) => (
    composants.installRuntimeComponents({ sourceDir, output: ui })
  ));

  console.log(`\n${PRODUCT_NAME} est installé : ${installedPath}`);
  console.log(`Certificats locaux : ${certsDir}`);
  return installedPath;
}

async function runCertificateStep(installedPath) {
  ui.step('Certificat local');

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
    if (identity) ui.ok(`Application signée avec l'identité locale « ${identity} ».`);
    else ui.ok("Signature éditeur de l'application conservée.");
  } catch (error) {
    ui.warn(`Signature locale impossible (${error.message}) — l'application reste utilisable.`);
  }
}

let installedPath = null;
try {
  installedPath = await main();
  finishProgress({ ok: true, message: `${PRODUCT_NAME} est installé.` });
} catch (error) {
  ui.fail(error.message);
  finishProgress({ ok: false, error: error.message });
  process.exitCode = 1;
}
await settleProgressWindow({
  launch: installedPath && !skipLaunch
    ? () => {
      ui.step(`Démarrage de ${PRODUCT_NAME}…`);
      launchApplication(installedPath);
    }
    : null,
});
