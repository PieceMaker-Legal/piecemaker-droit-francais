#!/usr/bin/env node

import { installPiecemakerCommand, piecemakerExecutable } from './install-command.mjs';
import { APP, APP_URL, PORTS } from './lib/config.mjs';
import { installComponents } from './lib/composants.mjs';
import { installPlugins } from './lib/plugins.mjs';
import { gitAvailable, resolveNodeRuntime } from './lib/node-runtime.mjs';
import { ensureDependencies, ensureRepository, rebuildNativeModules } from './lib/repos.mjs';
import { APP_LOG, appClientReachable, appServerReachable, startApplication, stopApplication } from './lib/services.mjs';
import { applicationWindowIsOpen, installApplicationEntry, openApplication, verifyPwaAssets } from './lib/pwa.mjs';
import { runApplicationWindow } from './lib/app-window.mjs';
import { banner, blank, c, detail, fail, ok, step, warn } from './lib/ui.mjs';

const report = { step, ok, warn, detail };

const HELP = `${c.bold('piecemaker')} — installe, met à jour, répare et lance toute la plateforme.

  piecemaker                 reset propre, puis installation et lancement
  piecemaker --launch-only   répare et relance seulement si l'application est arrêtée
  piecemaker --window        relance si besoin, ouvre la fenêtre et arrête tout à sa fermeture
  piecemaker --help          cette aide
`;

function parseArguments(argv) {
  const window = argv.includes('--window');
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    launchOnly: argv.includes('--launch-only') || window,
    window,
  };
}

async function synchroniseRepositories(runtime) {
  if (!gitAvailable()) {
    throw new Error('git est requis et introuvable.');
  }

  for (const repo of [APP]) {
    const state = await ensureRepository(repo, runtime, report);
    if (state.cloned) ok(`${repo.label} — installé`);
    else if (state.updated) ok(`${repo.label} — mis à jour`);
    else if (!state.offline && !state.dirty && !state.diverged) ok(`${repo.label} — déjà à jour`);

    const dependencies = await ensureDependencies(repo, runtime, report, { force: state.cloned });
    if (dependencies.installed) ok(`${repo.label} — dépendances installées`);
  }

  rebuildNativeModules(APP, runtime, report, ['better-sqlite3', 'node-pty']);
}

function printLogTail(logTail) {
  if (!logTail) {
    detail(`journal : ${APP_LOG}`);
    return;
  }
  detail(`journal : ${APP_LOG}`);
  for (const line of logTail.split('\n')) {
    if (line.trim()) detail(line);
  }
}

async function applicationIsRunning() {
  return await appServerReachable() && await appClientReachable();
}

async function resetAndLaunch(runtime) {
  step('Reset de l application');
  const stopped = await stopApplication();
  if (stopped.killed.length) detail(`arrêtés : ${stopped.killed.join(', ')}`);
  for (const port of stopped.occupied) warn(`port ${port} toujours occupé`);
  ok('Processus précédents arrêtés');

  const application = await startApplication(runtime, report);
  if (application.alreadyRunning) {
    ok(`Application déjà active — ${APP_URL}`);
    return true;
  }
  if (!application.serverUp) {
    fail(`Serveur applicatif injoignable sur le port ${PORTS.appServer}`);
    printLogTail(application.logTail);
    return false;
  }
  if (!application.clientUp) {
    fail(`Client applicatif injoignable sur le port ${PORTS.appClient}`);
    printLogTail(application.logTail);
    return false;
  }
  ok(`Application active — serveur :${PORTS.appServer}, client ${APP_URL}`);
  return true;
}

async function installPwa() {
  const assets = await verifyPwaAssets();
  if (!assets.manifestServed || !assets.serviceWorkerServed) {
    warn('Ressources PWA incomplètes (manifest ou service worker non servis)');
    return;
  }

  const entry = installApplicationEntry();
  if (!entry.installed) {
    warn(`PWA non installée sur le bureau : ${entry.reason}`);
    detail(`l application reste accessible sur ${APP_URL}`);
    return;
  }

  ok(`PWA installée — ${entry.location}`);
  for (const location of entry.locations || []) {
    if (location !== entry.location) detail(`également posé : ${location}`);
  }
  detail(`icône liée à ${piecemakerExecutable()}`);
  if (!entry.standalone) detail('navigateur Chromium absent : ouverture en onglet classique');
  if (!entry.verified) warn('installation incomplète : un emplacement attendu est introuvable après coup');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  banner('PieceMaker — plateforme juridique');

  const runtime = resolveNodeRuntime();
  detail(`Node ${runtime.version}`);

  step('Commande piecemaker');
  const command = installPiecemakerCommand();
  if (command.shims.length) ok(`installée : ${command.executable}`);
  else warn('commande absente du PATH — relancez node scripts/piecemaker/cli/install-command.mjs');

  if (!options.launchOnly || !(await applicationIsRunning())) {
    const running = await resetAndLaunch(runtime);
    if (!running) return 1;
  } else {
    ok(`Application déjà active — ${APP_URL}`);
  }

  if (!options.launchOnly) {
    await synchroniseRepositories(runtime);
    await installComponents(runtime, report);
    await installPlugins(runtime, report);
  }

  await installPwa();

  blank();
  ok(`Application  ${c.bold(APP_URL)}`);
  detail('Configuration du socle : onglet Dossier › Configuration.');
  blank();

  if (options.window) {
    const session = await runApplicationWindow();
    if (!session.supervised) {
      warn(`Fenêtre non supervisée : ${session.reason}`);
      return 0;
    }
    ok('Fenêtre fermée — application arrêtée');
    return 0;
  }

  if (!options.launchOnly && !applicationWindowIsOpen()) openApplication();
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    fail(error.message);
    process.exitCode = 1;
  });
