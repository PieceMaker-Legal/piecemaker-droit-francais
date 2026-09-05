#!/usr/bin/env node

import { ADMIN_URL, APP, APP_URL, INSTALLER, PORTS } from './lib/config.mjs';
import { gitAvailable, resolveNodeRuntime } from './lib/node-runtime.mjs';
import { freePort } from './lib/ports.mjs';
import { ensureDependencies, ensureRepository, rebuildNativeModules } from './lib/repos.mjs';
import { APP_LOG, startApplication, startInstallerStack } from './lib/services.mjs';
import { installApplicationEntry, openApplication, verifyPwaAssets } from './lib/pwa.mjs';
import { banner, blank, c, detail, fail, ok, step, warn } from './lib/ui.mjs';

const report = { step, ok, warn, detail };

const HELP = `${c.bold('piecemaker')} — installe, met à jour et lance toute la plateforme.

  piecemaker                 tout faire : ports, dépôts, dépendances, PWA, serveurs
  piecemaker --launch-only   ne relance que les serveurs manquants
  piecemaker --no-open       ne pas ouvrir l application à la fin
  piecemaker --help          cette aide

${c.dim('Le socle technique (proxy PII, MCP, GLiNER) garde sa propre commande : piecemaker-installer.')}
`;

function parseArguments(argv) {
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    launchOnly: argv.includes('--launch-only'),
    open: !argv.includes('--no-open'),
  };
}

async function cleanPorts(launchOnly) {
  step('Libération des ports');
  const targets = launchOnly
    ? [PORTS.appServer, PORTS.appClient]
    : [PORTS.appClient, PORTS.appServer, PORTS.admin, PORTS.litellm];

  for (const port of targets) {
    const result = await freePort(port);
    if (!result.released) {
      warn(`port ${port} toujours occupé`);
      continue;
    }
    if (result.killed.length > 0) detail(`port ${port} libéré (${result.killed.join(', ')})`);
  }
  ok('Ports disponibles');
}

async function synchroniseRepositories(runtime) {
  if (!gitAvailable()) {
    throw new Error('git est requis et introuvable.');
  }

  for (const repo of [INSTALLER, APP]) {
    const state = await ensureRepository(repo, runtime, report);
    if (state.cloned) ok(`${repo.label} — installé`);
    else if (state.updated) ok(`${repo.label} — mis à jour`);
    else if (!state.offline && !state.dirty && !state.diverged) ok(`${repo.label} — déjà à jour`);

    const dependencies = await ensureDependencies(repo, runtime, report, { force: state.cloned });
    if (dependencies.installed) ok(`${repo.label} — dépendances installées`);
  }

  rebuildNativeModules(APP, runtime, report, ['better-sqlite3', 'node-pty']);
}

async function launchServices(runtime) {
  const socle = startInstallerStack(runtime, report);
  if (socle.started) ok(`Socle actif — proxy PII :${PORTS.litellm}, administration ${ADMIN_URL}`);

  const application = await startApplication(runtime, report);
  if (application.alreadyRunning) {
    ok(`Application déjà active — ${APP_URL}`);
    return true;
  }

  if (!application.serverUp) {
    fail(`Serveur applicatif injoignable sur le port ${PORTS.appServer}`);
    detail(`journal : ${APP_LOG}`);
    return false;
  }
  if (!application.clientUp) {
    fail(`Client applicatif injoignable sur le port ${PORTS.appClient}`);
    detail(`journal : ${APP_LOG}`);
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
  if (!entry.standalone) detail('navigateur Chromium absent : ouverture en onglet classique');
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

  await cleanPorts(options.launchOnly);

  if (!options.launchOnly) {
    await synchroniseRepositories(runtime);
  }

  const running = await launchServices(runtime);
  if (!running) return 1;

  if (!options.launchOnly) {
    await installPwa();
  }

  blank();
  ok(`Application  ${c.bold(APP_URL)}`);
  ok(`Administration  ${ADMIN_URL}`);
  blank();

  if (options.open) openApplication();
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
