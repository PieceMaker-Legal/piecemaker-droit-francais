#!/usr/bin/env node
/**
 * PieceMaker — commande principale et installateur terminal.
 *
 * Steps are discovered from installer/steps/*.mjs and run in filename order.
 * Each step module exports { meta, install(ctx), check(ctx) } and returns
 * { status, note } where status is done | partial | failed | skipped.
 *
 * Usage:
 *   piecemaker                 menu interactif
 *   piecemaker open            démarre le serveur et ouvre l'interface web
 *   piecemaker start|stop|restart gère le serveur local
 *   piecemaker status|logs     affiche l'état ou les journaux
 *   piecemaker chronology      affiche la chronologie du dossier courant
 *   piecemaker chronology write --path <pièce> --correction-json <json>
 *                              crée une correction de chronologie pour une pièce
 *   piecemaker chronology edit --path <pièce> --correction-json <json>
 *                              modifie une correction de chronologie existante
 *   piecemaker conversion      convertit et pseudonymise les pièces manquantes
 *   piecemaker install         ouvre le menu des composants
 *   piecemaker doctor          diagnostic seul
 *   piecemaker update          met à jour le dépôt et les dépendances
 *   piecemaker --all           installe tout sans menu
 *   piecemaker --check         diagnostic seul, n'installe rien
 *   piecemaker --step <id>     rejoue une étape
 *   piecemaker --dry-run       montre les actions sans les exécuter
 *   piecemaker --yes           accepte les valeurs par défaut (non interactif)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { banner, title, log, write, blank, summary, spinner, badge, c } from '../lib/ui.mjs';
import { select, confirm, multiSelect, pause, nonInteractive } from '../lib/prompt.mjs';
import { HOME_DIR, REPO_ROOT, commandExists, findPython } from '../lib/platform.mjs';
import { COMMANDS, CHRONOLOGY_ACTIONS } from '../lib/commandes.mjs';
import { loadConfig, readEnv, markStep, loadState, CONFIG_FILE } from '../lib/state.mjs';
import { scheduleStepResume, selectStepsToResume } from '../lib/resume-steps.mjs';
import { readLocalScanJob, startLocalScan } from '../lib/conversion-client.mjs';
import {
  getServerStatus,
  openAdmin,
  readLogs,
  restartTelegramDaemon,
  startServer,
  stopServer,
  checkForUpdate,
  updateRepository,
} from '../lib/service.mjs';

const require = createRequire(import.meta.url);
const CLAUDE_ASSETS_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../websocket-server/claude-assets.cjs');
const CLAUDE_HOOKS_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../websocket-server/claude-hooks.cjs');
const CENTRAL_MAPPING_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../piecemaker-plugin/scripts/lib/central-mapping.cjs');
const DOCUMENT_INDEX_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../websocket-server/document-index.cjs');
const CASE_INSTRUCTIONS_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../websocket-server/case-instructions.cjs');
const ORIGINALS_PIPELINE_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../websocket-server/originals-pipeline.cjs');

/**
 * The bootstrap/update command is also distributed as an installer-only
 * checkout. Claude integration modules are optional there and must not keep
 * the updater from starting before the first full repository sync.
 */
function loadClaudeIntegrations() {
  const integrations = {};
  if (fs.existsSync(CLAUDE_ASSETS_MODULE)) Object.assign(integrations, require(CLAUDE_ASSETS_MODULE));
  if (fs.existsSync(CLAUDE_HOOKS_MODULE)) Object.assign(integrations, require(CLAUDE_HOOKS_MODULE));
  return typeof integrations.syncClaudeAssets === 'function' && typeof integrations.installClaudeHooks === 'function'
    ? integrations
    : null;
}

/** Recharge le générateur du mapping central après un reset Git. */
function loadCentralMappingIntegration() {
  if (!fs.existsSync(CENTRAL_MAPPING_MODULE)) return null;
  try {
    const integration = require(CENTRAL_MAPPING_MODULE);
    return typeof integration.syncCentralMapping === 'function' ? integration : null;
  } catch {
    return null;
  }
}

function reconcileCentralMapping() {
  let hooksRemoved = false;
  const claude = loadClaudeIntegrations();
  if (typeof claude?.removeDeprecatedHooks === 'function') {
    const cleanup = claude.removeDeprecatedHooks(os.homedir());
    hooksRemoved = Boolean(cleanup.changed);
    if (!cleanup.ok) log.warn(`Hooks hérités non nettoyés (${cleanup.reason}).`);
    else if (cleanup.changed) log.ok('Hooks hérités Claude Code retirés.');
  }

  const integration = loadCentralMappingIntegration();
  const central = integration?.syncCentralMapping(loadConfig());
  if (central) log.ok(`Mapping central du proxy reconstruit (${central.entities || 0} entité(s)).`);
  else log.warn('Mapping central du proxy non reconstruit ; relancez « piecemaker start ».');
  return hooksRemoved;
}

function reconcileCaseInstructions() {
  if (!fs.existsSync(CASE_INSTRUCTIONS_MODULE)) return false;
  try {
    const { refreshRegisteredCaseRules } = require(CASE_INSTRUCTIONS_MODULE);
    if (typeof refreshRegisteredCaseRules !== 'function') return false;
    const result = refreshRegisteredCaseRules(REPO_ROOT, loadConfig());
    if (result.failed.length) {
      log.warn(`${result.failed.length} règle(s) de dossier n’ont pas pu être actualisées.`);
    }
    if (result.refreshed) log.ok(`${result.refreshed} règle(s) de dossier PieceMaker actualisée(s).`);
    return result.failed.length === 0;
  } catch (error) {
    log.warn(`Règles de dossier non actualisées (${error.message}).`);
    return false;
  }
}

/**
 * Reprend en tâche de fond les étapes d'installation restées incomplètes.
 *
 * Le diagnostic est fait ici — `check()` ne modifie rien et coûte quelques
 * secondes — pour pouvoir nommer précisément ce qui repart ; l'installation
 * elle-même, qui peut durer plusieurs minutes (npm, pip, Homebrew), part dans
 * un processus détaché. Les étapes sont rechargées depuis le disque avec
 * `fresh: true` : la reprise doit jouer le code qui vient d'être téléchargé,
 * pas celui chargé avant le reset Git.
 */
async function resumePendingStepsAfterUpdate() {
  try {
    const steps = await loadSteps({ fresh: true });
    const pending = await selectStepsToResume({
      steps,
      state: loadState(),
      ctx: buildContext({ dryRun: false }),
    });
    if (!pending.length) return false;

    const scheduled = scheduleStepResume({
      cli: fileURLToPath(import.meta.url),
      ids: pending.map((step) => step.id),
      cwd: REPO_ROOT,
    });
    if (!scheduled.started) {
      if (scheduled.reason === 'deja-en-cours') {
        log.info(`Reprise d’installation déjà en cours (PID ${scheduled.pid}) — journal : ${scheduled.logFile}`);
      }
      return false;
    }
    log.info(
      `Reprise en tâche de fond de ${pending.length} étape(s) — ${pending.map((step) => step.id).join(', ')} — journal : ${scheduled.logFile}`
    );
    return true;
  } catch (error) {
    log.warn(`Reprise automatique des étapes impossible (${error.message}).`);
    return false;
  }
}

const STEPS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'steps');
const STATUS_BADGE = {
  done: badge.done,
  partial: badge.partial,
  failed: badge.failed,
  skipped: badge.skipped,
};

function parseArgs(argv) {
  const flags = {
    command: null,
    all: false,
    caseTarget: null,
    check: false,
    dryRun: false,
    conversionDocuments: [],
    correctionJson: null,
    force: false,
    chronologyAction: 'read',
    json: false,
    piecePath: null,
    resumeSteps: null,
    step: null,
    yes: false,
    unknown: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-') && !flags.command && COMMANDS.has(arg)) flags.command = arg;
    else if (!arg.startsWith('-') && flags.command === 'chronology' && flags.chronologyAction === 'read' && CHRONOLOGY_ACTIONS.has(arg)) flags.chronologyAction = arg;
    else if (!arg.startsWith('-') && flags.command === 'chronology' && !flags.caseTarget) flags.caseTarget = arg;
    else if (!arg.startsWith('-') && flags.command === 'conversion') flags.conversionDocuments.push(arg);
    else if (arg === '--all') flags.all = true;
    else if (arg === '--action') flags.chronologyAction = argv[++i];
    else if (arg === '--case') flags.caseTarget = argv[++i];
    else if (arg === '--check') flags.check = true;
    else if (arg === '--correction-json') flags.correctionJson = argv[++i];
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--force') flags.force = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--path') flags.piecePath = argv[++i];
    else if (arg === '--yes' || arg === '-y') flags.yes = true;
    else if (arg === '--step') flags.step = argv[++i];
    else if (arg === '--resume-steps') {
      flags.resumeSteps = String(argv[++i] || '').split(',').map((id) => id.trim()).filter(Boolean);
    }
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else flags.unknown.push(arg);
  }
  return flags;
}

/**
 * Load every step module. A step that fails to import is surfaced as a broken
 * entry rather than taking the whole installer down.
 */
async function loadSteps({ fresh = false } = {}) {
  if (!fs.existsSync(STEPS_DIR)) return [];
  const files = fs
    .readdirSync(STEPS_DIR)
    .filter((f) => f.endsWith('.mjs'))
    .sort();

  // Après un « git reset --hard », les modules déjà importés sont ceux d'avant
  // la mise à jour : le suffixe force le chargement du code fraîchement posé.
  const bust = fresh ? `?update=${Date.now()}` : '';
  const steps = [];
  for (const file of files) {
    const full = path.join(STEPS_DIR, file);
    try {
      const mod = await import(`${pathToFileURL(full).href}${bust}`);
      if (!mod.meta?.id || typeof mod.install !== 'function') {
        steps.push({ broken: `${file} : export meta/install manquant`, file });
        continue;
      }
      steps.push({ ...mod.meta, file, install: mod.install, check: mod.check });
    } catch (error) {
      steps.push({ broken: `${file} : ${error.message}`, file });
    }
  }
  return steps;
}

function buildContext(flags) {
  return {
    config: loadConfig(),
    env: readEnv(),
    python: findPython(),
    dryRun: flags.dryRun,
  };
}

async function runStep(step, ctx, index, total) {
  title(`[${index}/${total}] ${step.label}`);
  if (step.description) write(`  ${c.gray(step.description)}`);
  blank();

  try {
    const result = (await step.install(ctx)) || {};
    const status = result.status || 'done';
    // « --dry-run n'écrit rien » : une simulation ne doit pas laisser une trace
    // « skipped » dans state.json, que la reprise automatique interpréterait
    // ensuite comme un refus délibéré de l'utilisateur.
    if (!ctx.dryRun) markStep(step.id, status, result.note || '');
    blank();
    if (status === 'done') log.ok(`${step.label} — terminé`);
    else if (status === 'partial') log.warn(`${step.label} — partiel${result.note ? ` : ${result.note}` : ''}`);
    else if (status === 'skipped') log.info(`${step.label} — ignoré`);
    else log.error(`${step.label} — échec${result.note ? ` : ${result.note}` : ''}`);
    return { ...result, status };
  } catch (error) {
    if (!ctx.dryRun) markStep(step.id, 'failed', error.message);
    blank();
    log.error(`${step.label} — échec : ${error.message}`);
    if (process.env.PIECEMAKER_DEBUG) log.detail(error.stack);
    return { status: 'failed', note: error.message };
  }
}

async function runAll(steps, ctx, selectedIds = null) {
  const runnable = steps.filter((s) => !s.broken && (!selectedIds || selectedIds.includes(s.id)));
  const results = [];

  for (const [i, step] of runnable.entries()) {
    const result = await runStep(step, ctx, i + 1, runnable.length);
    results.push([step, result]);

    if (result.status === 'failed' && step.required !== false) {
      blank();
      const keepGoing = await confirm('Cette étape a échoué. Continuer malgré tout ?', true);
      if (!keepGoing) break;
    }
    // Later steps read what earlier ones wrote (.env, config).
    ctx.config = loadConfig();
    ctx.env = readEnv();
  }

  return results;
}

function printSummary(results) {
  title('Résumé');
  if (!results.length) {
    log.info('Aucune étape exécutée.');
    return;
  }
  summary(
    results.map(([step, result]) => [
      step.label,
      STATUS_BADGE[result.status] || result.status,
      result.note || '',
    ])
  );
  blank();

  const failed = results.filter(([, r]) => r.status === 'failed');
  const partial = results.filter(([, r]) => r.status === 'partial');

  if (!failed.length && !partial.length) {
    log.ok('Installation complète.');
    blank();
    write(`  ${c.bold('Pour démarrer :')}`);
    write(`    piecemaker open`);
    write(`  ${c.gray('Le serveur local démarrera et l’interface web s’ouvrira automatiquement.')}`);
  } else {
    if (partial.length) log.warn(`${partial.length} étape(s) partielle(s) — relancez avec --step <id> après correction.`);
    if (failed.length) log.error(`${failed.length} étape(s) en échec.`);
    blank();
    write(`  ${c.gray(`État détaillé : ${CONFIG_FILE.replace('config.json', 'state.json')}`)}`);
  }
  blank();
}

async function runCheck(steps, ctx) {
  title('Diagnostic');
  const rows = [];
  for (const step of steps) {
    if (step.broken) {
      rows.push([step.file, badge.failed, step.broken]);
      continue;
    }
    if (typeof step.check !== 'function') {
      const recorded = loadState().steps[step.id];
      rows.push([step.label, recorded ? STATUS_BADGE[recorded.status] : badge.todo, recorded?.note || '']);
      continue;
    }
    try {
      const result = (await step.check(ctx)) || {};
      rows.push([step.label, STATUS_BADGE[result.status] || badge.todo, result.note || '']);
    } catch (error) {
      rows.push([step.label, badge.failed, error.message]);
    }
  }
  summary(rows);
  blank();
}

function printHelp() {
  write(`  ${c.bold('piecemaker')} — PieceMaker local`);
  blank();
  write('  open            démarre le serveur et ouvre l’interface web');
  write('  start           démarre le serveur local en arrière-plan');
  write('  stop            arrête le serveur local');
  write('  restart         redémarre le serveur local');
  write('  status          affiche l’état du serveur');
  write('  logs            affiche les dernières lignes du journal');
  write('  chronology [read]        affiche la chronologie pseudonymisée du dossier courant');
  write('  chronology write --path <pièce> --correction-json <json>  crée une correction de chronologie');
  write('  chronology edit --path <pièce> --correction-json <json>   modifie une correction existante');
  write('  conversion [pièce…] convertit et pseudonymise les pièces manquantes ou indiquées');
  write('  install         ouvre le menu d’installation/réparation');
  write('  doctor, check   diagnostic seul, n’installe rien');
  write('  update          met à jour PieceMaker');
  blank();
  write('  --all           installe tout sans menu');
  write('  --case <chemin> cible un dossier enregistré (chronology/conversion)');
  write('  --path <pièce>  chemin relatif de la pièce (chronology write/edit)');
  write('  --correction-json <json> correction à appliquer (chronology write/edit)');
  write('  --force         retraite les pièces');
  write('  --json          produit une sortie JSON sans décor (chronology/conversion)');
  write('  --check         diagnostic seul, n\'installe rien');
  write('  --step <id>     rejoue une seule étape');
  write('  --resume-steps <ids> rejoue les étapes indiquées sans interaction (usage interne)');
  write('  --dry-run       montre les actions sans les exécuter');
  write('  --yes, -y       accepte les valeurs par défaut (non interactif)');
  write('  --help, -h      cette aide');
  blank();
}

async function installerMenu(steps, ctx, { allowBack = false } = {}) {
  for (;;) {
    const choices = [
      { value: 'all', label: 'Tout installer', hint: 'recommandé au premier lancement' },
      { value: 'pick', label: 'Choisir les composants' },
      { value: 'check', label: 'Diagnostic', hint: 'vérifie sans rien modifier' },
      { value: allowBack ? 'back' : 'quit', label: allowBack ? 'Retour' : 'Quitter' },
    ];
    const choice = await select('Installation et réparation', choices);

    if (choice === 'quit' || choice === 'back') return;

    if (choice === 'check') {
      await runCheck(steps, ctx);
      await pause();
      continue;
    }

    let selectedIds = null;
    if (choice === 'pick') {
      const available = steps.filter((s) => !s.broken);
      selectedIds = await multiSelect(
        'Composants à installer',
        available.map((s) => ({ value: s.id, label: s.label, hint: s.description })),
        { def: available.map((s) => s.id) }
      );
      if (!selectedIds.length) {
        log.info('Aucun composant sélectionné.');
        continue;
      }
    }

    const results = await runAll(steps, ctx, selectedIds);
    printSummary(results);
    if (!allowBack) return;
    await pause();
  }
}

function printServerStatus(status) {
  title('État local');
  const rows = [
    ['Serveur HTTPS', status.running ? badge.done : badge.todo, status.running ? `PID ${status.pid || 'externe'}` : 'arrêté'],
    ['Interface web', status.running ? badge.done : badge.todo, status.url],
    ['Journal', badge.todo, status.logFile],
  ];
  summary(rows);
  blank();
}

function formatChronologyText(chronology) {
  const lines = [];
  lines.push(`Chronologie : ${chronology.stats.documents} pièce(s), ${chronology.stats.dated} datée(s), ${chronology.stats.entities} entité(s).`);
  lines.push('');
  for (const doc of chronology.documents) {
    lines.push(`${doc.dateIso || '(date manquante)'}  ${doc.nature || '(nature inconnue)'}  ${doc.name}`);
  }
  const missing = chronology.documents.filter((doc) => !doc.dateIso);
  if (missing.length) {
    lines.push('');
    lines.push('Dates manquantes :');
    for (const doc of missing) lines.push(`  - ${doc.name}`);
  }
  return `${lines.join('\n')}\n`;
}

function locateChronologyCase(flags) {
  const { locateConfiguredCase } = require('../../piecemaker-plugin/scripts/lib/case-folders.cjs');
  const located = locateConfiguredCase(loadConfig(), flags.caseTarget || process.cwd());
  if (!located) {
    throw new Error('Lancez la commande depuis un dossier juridique enregistré ou passez --case <chemin>.');
  }
  return located;
}

async function runChronologyReadCommand(flags) {
  if (!fs.existsSync(DOCUMENT_INDEX_MODULE)) {
    throw new Error('Le module de chronologie PieceMaker est introuvable.');
  }
  const located = locateChronologyCase(flags);
  const { buildChronology } = require(DOCUMENT_INDEX_MODULE);
  const chronology = await buildChronology(located.caseRoot, { deanonymizeLabels: false, includeManualDecisions: true });
  const output = flags.json
    ? `${JSON.stringify(chronology, null, 2)}\n`
    : formatChronologyText(chronology);
  process.stdout.write(output);
  return 0;
}

function resolveChronologyPiecePath(caseRoot, relativePath) {
  const relative = String(relativePath || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!relative) throw new Error('Chemin de pièce manquant.');
  const absolute = path.resolve(caseRoot, ...relative.split('/'));
  if (absolute !== caseRoot && !absolute.startsWith(`${caseRoot}${path.sep}`)) {
    throw new Error('Pièce hors du dossier juridique.');
  }
  if (!fs.existsSync(absolute)) throw new Error('Pièce introuvable.');
  return relative;
}

async function runChronologyCorrectionCommand(flags) {
  if (!fs.existsSync(DOCUMENT_INDEX_MODULE)) {
    throw new Error('Le module de chronologie PieceMaker est introuvable.');
  }
  const located = locateChronologyCase(flags);
  const relative = resolveChronologyPiecePath(located.caseRoot, flags.piecePath);

  let correction;
  try {
    correction = JSON.parse(flags.correctionJson || '{}');
  } catch (error) {
    throw new Error(`Correction JSON invalide : ${error.message}`);
  }

  const { stateKey } = require('../../piecemaker-plugin/scripts/lib/anonymization-state.cjs');
  const { applyDocumentIndexCorrection, readDocumentIndex, documentIndexFile } = require(DOCUMENT_INDEX_MODULE);
  const key = stateKey(relative);
  const existing = readDocumentIndex(located.caseRoot).overrides[key] || null;

  if (flags.chronologyAction === 'write' && existing) {
    throw new Error('Une correction existe déjà pour cette pièce ; utilisez edit_chronology pour la modifier.');
  }
  if (flags.chronologyAction === 'edit' && !existing) {
    throw new Error('Aucune correction existante pour cette pièce ; utilisez write_chronology pour en créer une.');
  }

  const mutation = applyDocumentIndexCorrection(located.caseRoot, relative, correction);

  let history;
  try {
    const { createCommit } = require('../../piecemaker-plugin/scripts/lib/commits.cjs');
    history = await createCommit({
      casesRoot: located.casesRoot,
      caseName: located.caseName,
      homeDir: HOME_DIR,
      envFile: path.join(REPO_ROOT, '.env'),
      label: flags.chronologyAction === 'write'
        ? 'Création d’une correction de chronologie'
        : 'Modification d’une correction de chronologie',
      description: `Mise à jour déterministe de la pièce ${mutation.documentKey.slice(0, 12).toUpperCase()}.`,
      event: 'assistant-chronology-correction',
      paths: [path.relative(located.caseRoot, documentIndexFile(located.caseRoot)).split(path.sep).join('/')],
      waitForLockMs: 10_000,
    });
  } catch (error) {
    history = { created: false, error: error.message };
  }

  const result = {
    ok: true,
    action: flags.chronologyAction,
    path: relative,
    documentKey: mutation.documentKey,
    override: mutation.override,
    entityDecisions: mutation.entityDecisions,
    editRevision: mutation.editRevision,
    history: {
      created: Boolean(history?.created),
      hash: history?.commit || null,
      error: history?.error || null,
    },
  };

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const verb = flags.chronologyAction === 'write' ? 'Correction créée' : 'Correction modifiée';
    log.ok(`${verb} pour ${relative}.`);
  }
  return 0;
}

async function runChronologyCommand(flags) {
  if (flags.chronologyAction === 'write' || flags.chronologyAction === 'edit') {
    return runChronologyCorrectionCommand(flags);
  }
  return runChronologyReadCommand(flags);
}

function normalizedConversionRequest(value, caseRoot) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Nom de pièce vide.');
  if (!path.isAbsolute(raw)) return raw.replaceAll('\\', '/').replace(/^\.\/+/, '');
  const relative = path.relative(caseRoot, path.resolve(raw));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('La pièce indiquée est hors du dossier juridique.');
  }
  return relative.split(path.sep).join('/');
}

function resolveConversionFiles(originals, requests, caseRoot) {
  const selected = [];
  const seen = new Set();
  for (const request of requests) {
    const normalized = normalizedConversionRequest(request, caseRoot);
    let matches = originals.filter((file) => file.path === normalized);
    if (!matches.length && !normalized.includes('/')) {
      matches = originals.filter((file) => file.name === normalized);
    }
    if (!matches.length) throw new Error(`Aucune pièce ne correspond à « ${normalized} » dans ce dossier.`);
    if (matches.length > 1) {
      throw new Error(`Plusieurs pièces portent le nom « ${normalized} » ; indiquez leur chemin relatif.`);
    }
    if (!seen.has(matches[0].path)) {
      seen.add(matches[0].path);
      selected.push(matches[0].path);
    }
  }
  return selected;
}

function publicConversionResult(job) {
  const result = job?.result || {};
  return {
    id: job?.id || null,
    state: job?.state || 'error',
    phase: job?.phase || null,
    processed: Number(job?.processed) || 0,
    total: Number(job?.total) || 0,
    result: {
      documents: Number(result.documents) || 0,
      ...(Number.isFinite(result.nodes) ? { nodes: result.nodes } : {}),
      ...(Number.isFinite(result.edges) ? { edges: result.edges } : {}),
    },
  };
}

async function waitForConversionJob(config, { folder, id }, { json = false } = {}) {
  let job = null;
  let reportedPercent = -10;
  do {
    await new Promise((resolve) => setTimeout(resolve, 500));
    ({ job } = await readLocalScanJob(config, { folder, id }));
    if (!json && job && job.percent >= reportedPercent + 10) {
      log.info(`Conversion et analyse PII : ${job.percent || 0} % (${job.processed || 0}/${job.total || 0})`);
      reportedPercent = job.percent || 0;
    }
  } while (job && job.state === 'running');
  if (!job) throw new Error('Le travail de conversion a expiré avant sa fin.');
  if (job.state === 'error') throw new Error(job.error || 'La conversion a échoué.');
  if (job.state === 'cancelled') throw new Error('La conversion a été annulée.');
  return job;
}

async function ensureServerForConversion({ json = false } = {}) {
  const status = await getServerStatus();
  if (status.running) return loadConfig();
  if (!json) log.info('Serveur PieceMaker arrêté : démarrage avant conversion.');
  await startServer();
  return loadConfig();
}

async function runConversionCommand(flags) {
  if (!fs.existsSync(ORIGINALS_PIPELINE_MODULE)) {
    throw new Error('Le module de conversion PieceMaker est introuvable.');
  }
  const { locateConfiguredCase } = require('../../piecemaker-plugin/scripts/lib/case-folders.cjs');
  const located = locateConfiguredCase(loadConfig(), flags.caseTarget || process.cwd());
  if (!located) {
    throw new Error('Lancez la commande depuis un dossier juridique enregistré ou passez --case <chemin>.');
  }

  const { listOriginals } = require(ORIGINALS_PIPELINE_MODULE);
  const originals = await listOriginals(located.caseRoot);
  const selected = resolveConversionFiles(
    originals,
    flags.conversionDocuments || [],
    located.caseRoot,
  );
  const requestedFiles = selected.length || !flags.force
    ? selected
    : originals.map((original) => original.path);
  if (!flags.json) {
    log.info(requestedFiles.length
      ? `Conversion et pseudonymisation de ${requestedFiles.length} pièce(s) sélectionnée(s).`
      : 'Conversion et pseudonymisation des pièces qui ne sont pas encore prêtes.');
  }

  const config = await ensureServerForConversion({ json: flags.json });
  const started = await startLocalScan(config, { folder: located.caseRoot, files: requestedFiles });
  const job = await waitForConversionJob(
    config,
    { folder: located.caseRoot, id: started.job?.id },
    { json: flags.json },
  );
  const result = publicConversionResult(job);
  if (flags.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else log.ok(`Conversion et pseudonymisation terminées : ${result.result.documents} pièce(s).`);
  return 0;
}

async function runOperationalCommand(command, knownUpdate = null, flags = {}) {
  if (command === 'chronology') return runChronologyCommand(flags);
  if (command === 'conversion') return runConversionCommand(flags);
  if (command === 'open') {
    const status = await openAdmin();
    log.ok(`Interface ouverte : ${status.url}`);
    return 0;
  }
  if (command === 'start') {
    const status = await startServer();
    log.ok(status.started ? `Serveur démarré : ${status.url}` : `Serveur déjà actif : ${status.url}`);
    return 0;
  }
  if (command === 'stop') {
    const status = await stopServer();
    if (status.alreadyStopped) log.info('Le serveur est déjà arrêté.');
    else log.ok('Serveur arrêté.');
    return 0;
  }
  if (command === 'restart') {
    await stopServer();
    const status = await startServer();
    log.ok(`Serveur redémarré : ${status.url}`);
    return 0;
  }
  if (command === 'status') {
    const status = await getServerStatus();
    printServerStatus(status);
    return 0;
  }
  if (command === 'logs') {
    title('Journal du serveur HTTPS');
    const content = readLogs();
    write(content || '  Aucun journal disponible.');
    blank();
    return 0;
  }
  if (command === 'update') {
    // Look before stopping anything: an up-to-date install must not lose its
    // server for the duration of a no-op npm install.
    const pending = knownUpdate ?? checkForUpdate();
    if (!pending.available) {
      log.ok(`PieceMaker est déjà à jour (${pending.ref}, ${pending.current.slice(0, 7)}).`);
      reconcileCaseInstructions();
      if (reconcileCentralMapping()) {
        log.info('Rouvrez les sessions Claude Code actives pour oublier les hooks hérités.');
      }
      // « update » reste le geste de remise à niveau : même sans nouveau commit,
      // une étape d'installation restée incomplète repart en tâche de fond.
      await resumePendingStepsAfterUpdate();
      return 0;
    }
    if (pending.remoteAvailable) {
      log.info(`Nouvelle version disponible (${pending.changed.length} fichier(s) modifié(s)).`);
    } else {
      log.info(`Restauration de l’installation depuis le dépôt distant (${pending.localChanges} fichier(s) localement modifié(s)).`);
    }

    // A live server on the port is a PieceMaker server (the health probe
    // answered 200), whether we started it or not — e.g. one launched by hand
    // from the dev clone, so with no PID file it comes back unmanaged. We adopt
    // it: stop whatever holds the port and bring a managed server back below,
    // rather than leaving the user to restart it themselves.
    const previous = await getServerStatus();
    if (previous.running) await stopServer();
    try {
      const result = updateRepository(pending);
      log.ok(`PieceMaker mis à jour (${result.ref}, ${result.target.slice(0, 7)}).`);

      reconcileCaseInstructions();

      if (result.pythonChanged) {
        log.warn('Une dépendance Python a changé : relancez « piecemaker install » (étape 03 si elle est installée).');
      }

      // Les composants PieceMaker sont découverts directement dans
      // ~/.claude/{skills,agents}. Les liens symboliques suivent déjà le dépôt ;
      // cet appel rafraîchit aussi le repli par copie sur les plateformes qui ne
      // peuvent pas créer de liens.
      const claudeIntegrations = loadClaudeIntegrations();
      if (commandExists('claude', ['--version']) && claudeIntegrations) {
        const claudeAssets = claudeIntegrations.syncClaudeAssets(REPO_ROOT, os.homedir());
        if (claudeAssets.conflicts.length) {
          log.warn(`${claudeAssets.conflicts.length} skill(s)/agent(s) Claude personnel(s) homonyme(s) conservé(s).`);
        } else {
          log.ok(`${claudeAssets.registered} skill(s)/agent(s) PieceMaker synchronisé(s) pour Claude Code.`);
        }
        const claudeHooks = claudeIntegrations.installClaudeHooks(REPO_ROOT, os.homedir());
        if (!claudeHooks.ok) log.warn(`Hooks Claude Code non synchronisés (${claudeHooks.reason}).`);
        else if (claudeHooks.changed) log.ok(`${claudeHooks.registered} hook(s) PieceMaker synchronisé(s) pour Claude Code.`);
      }

      reconcileCentralMapping();
      log.info('Rouvrez les sessions Claude Code/Codex actives pour charger les hooks et le MCP mis à jour.');
    } finally {
      if (previous.running) {
        const restarted = await startServer();
        log.ok(`Serveur redémarré : ${restarted.url}`);
      }
      const daemon = restartTelegramDaemon();
      if (daemon.restarted) log.ok('Moniteur Telegram redémarré.');
      else if (daemon.reason && daemon.reason !== 'absent' && daemon.reason !== 'unsupported') {
        log.warn(`Le moniteur Telegram n’a pas redémarré : ${daemon.reason}`);
      }
    }
    // Après le `finally` : une mise à jour qui a échoué ne doit pas enchaîner
    // sur une réinstallation en fond, l'exception traverse d'abord.
    await resumePendingStepsAfterUpdate();
    return 0;
  }
  return null;
}

/**
 * Check once before showing an interactive installer menu. A network or Git
 * failure must never prevent the local installer from opening.
 */
function checkForUpdateOnOpen() {
  const spin = spinner('Vérification des mises à jour...');
  try {
    const pending = checkForUpdate();
    spin.stop();
    if (pending.remoteAvailable) {
      log.warn(`MAJ disponible (${pending.changed.length} fichier(s) modifié(s)) — application automatique.`);
    } else {
      log.ok('PieceMaker est à jour.');
    }
    blank();
    return pending;
  } catch (error) {
    spin.stop();
    log.warn('Vérification des mises à jour impossible ; l’installation locale reste disponible.');
    if (process.env.PIECEMAKER_DEBUG) log.detail(error.message);
    blank();
    return null;
  }
}

/**
 * Bare `piecemaker` should land on a live server. Start it if it is down, but
 * never block the menu on failure: a missing certificate or a boot error is
 * reported and the interactive installer below stays reachable to fix it.
 * The browser is left closed on purpose — the menu's "Ouvrir l'interface"
 * entry is how the admin pane gets opened.
 */
async function ensureServerRunning() {
  let status;
  try {
    status = await getServerStatus();
  } catch {
    return;
  }
  if (status.running) return;

  const spin = spinner('Démarrage du serveur local...');
  try {
    const started = await startServer();
    spin.stop();
    log.ok(`Serveur démarré : ${started.url}`);
  } catch (error) {
    spin.stop();
    log.warn(`Serveur non démarré : ${error.message}`);
    log.detail('Réparez-le via « Installer ou réparer des composants » ci-dessous.');
  }
  blank();
}

async function mainMenu(steps, ctx, knownUpdate = null) {
  for (;;) {
    const status = await getServerStatus();
    printServerStatus(status);
    const choice = await select('Que voulez-vous faire ?', [
      { value: 'open', label: 'Ouvrir l’interface graphique', hint: 'paramètres, skills et agents' },
      { value: status.running ? 'stop' : 'start', label: status.running ? 'Arrêter le serveur local' : 'Démarrer le serveur local' },
      { value: 'status', label: 'Actualiser l’état' },
      { value: 'install', label: 'Installer ou réparer des composants' },
      {
        value: 'update',
        label: knownUpdate?.remoteAvailable ? 'Mettre à jour PieceMaker — MAJ disponible' : 'Mettre à jour PieceMaker',
      },
      { value: 'logs', label: 'Afficher les journaux' },
      { value: 'quit', label: 'Quitter' },
    ]);

    if (choice === 'quit') return;
    if (choice === 'install') {
      await installerMenu(steps, ctx, { allowBack: true });
      continue;
    }
    if (choice === 'update' && !(await confirm('Télécharger et appliquer la dernière version ?', true))) continue;

    try {
      await runOperationalCommand(choice, choice === 'update' ? knownUpdate : null);
      if (choice === 'update') knownUpdate = null;
    } catch (error) {
      log.error(error.message);
    }
    if (choice === 'open') return;
    await pause();
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.yes) process.env.PIECEMAKER_YES = '1';

  if (flags.help) {
    banner();
    printHelp();
    return 0;
  }

  if (flags.unknown.length) {
    banner();
    log.error(`Option ou commande inconnue : ${flags.unknown.join(' ')}`);
    printHelp();
    return 1;
  }

  if (!['chronology', 'conversion'].includes(flags.command) && (flags.caseTarget || flags.json)) {
    banner();
    log.error('Les options --case et --json sont réservées aux commandes chronology et conversion.');
    return 1;
  }

  if (flags.command === 'chronology' && !CHRONOLOGY_ACTIONS.has(flags.chronologyAction)) {
    log.error('Action inconnue : utilisez « piecemaker chronology read|write|edit ».');
    return 1;
  }

  // Les sorties JSON sont directement consommées par les assistants.
  if ((flags.command === 'chronology' && flags.json)
      || (flags.command === 'conversion' && flags.json)) {
    return runOperationalCommand(flags.command, null, flags);
  }

  banner();

  // La mise à jour automatique n'a lieu qu'à l'ouverture interactive, devant un
  // utilisateur. Une commande explicite, une étape ciblée, un diagnostic, une
  // simulation ou un mode non interactif ne doivent jamais couper puis relancer
  // les services de la machine par surprise.
  const opensInteractiveInstaller =
    (!flags.command || flags.command === 'install') &&
    !flags.all &&
    !flags.check &&
    !flags.step &&
    !flags.resumeSteps &&
    !flags.dryRun &&
    !flags.yes &&
    !nonInteractive;
  let knownUpdate = opensInteractiveInstaller ? checkForUpdateOnOpen() : null;

  if (flags.command && !['install', 'doctor', 'check'].includes(flags.command)) {
    return runOperationalCommand(flags.command, null, flags);
  }

  // `update` arrête puis relance lui-même le serveur et le proxy : il passe
  // avant ensureServerRunning() plus bas, pour ne pas démarrer un serveur juste
  // avant de le couper. Il enchaîne aussi sur la reprise des étapes.
  let autoUpdated = false;
  if (opensInteractiveInstaller && knownUpdate?.available) {
    try {
      await runOperationalCommand('update', knownUpdate);
      autoUpdated = true;
    } catch (error) {
      log.error(`Mise à jour automatique interrompue : ${error.message}`);
      log.detail('L’installateur reste disponible ; relancez « Mettre à jour PieceMaker » depuis le menu.');
    }
    knownUpdate = null;
    blank();
  }

  // Après une mise à jour, les modules d'étapes sur le disque ne sont plus ceux
  // que ce processus a pu charger : on les relit.
  const steps = await loadSteps({ fresh: autoUpdated });
  const broken = steps.filter((s) => s.broken);
  if (broken.length) {
    for (const b of broken) log.error(b.broken);
    blank();
  }
  if (!steps.some((s) => !s.broken)) {
    log.error(`Aucune étape exécutable trouvée dans ${STEPS_DIR}`);
    return 1;
  }

  const ctx = buildContext(flags);
  if (flags.dryRun) {
    log.warn('Mode simulation : aucune modification ne sera écrite.');
    blank();
  }

  if (flags.check || flags.command === 'doctor' || flags.command === 'check') {
    await runCheck(steps, ctx);
    return 0;
  }

  // Reprise détachée lancée par `update` : uniquement les étapes nommées, sans
  // interaction, sans menu et sans toucher aux services.
  if (flags.resumeSteps) {
    const wanted = steps.filter((s) => !s.broken && flags.resumeSteps.includes(s.id));
    if (!wanted.length) {
      log.error(`Aucune étape à reprendre parmi : ${flags.resumeSteps.join(', ')}`);
      return 1;
    }
    const results = await runAll(steps, ctx, wanted.map((s) => s.id));
    printSummary(results);
    return results.some(([, r]) => r.status === 'failed') ? 1 : 0;
  }

  if (flags.step) {
    const step = steps.find((s) => s.id === flags.step && !s.broken);
    if (!step) {
      log.error(`Étape inconnue : ${flags.step}`);
      log.detail(`Disponibles : ${steps.filter((s) => !s.broken).map((s) => s.id).join(', ')}`);
      return 1;
    }
    const result = await runStep(step, ctx, 1, 1);
    printSummary([[step, result]]);
    return result.status === 'failed' ? 1 : 0;
  }

  if (flags.all || nonInteractive) {
    const results = await runAll(steps, ctx);
    printSummary(results);
    return results.some(([, r]) => r.status === 'failed') ? 1 : 0;
  }

  if (flags.command === 'install') await installerMenu(steps, ctx);
  else {
    await ensureServerRunning();
    await mainMenu(steps, ctx, knownUpdate);
  }
  return 0;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    log.error(error.message);
    if (process.env.PIECEMAKER_DEBUG) log.detail(error.stack);
    process.exit(1);
  });
