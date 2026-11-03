#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = ['tab', 'dossier', 'tabular_review', 'bordereau', 'raisonnement', 'suivi_dossiers'];
const TAB_COMMANDS = ['lister', 'afficher', 'fermer'];
const TAB_TARGETS = ['dossier', 'index', 'tabular_review', 'bordereau', 'raisonnement', 'suivi_dossiers', 'fichier'];
const DOSSIER_COMMANDS = ['verifier', 'sql', 'conversion', 'arborescence', 'index'];
const INDEX_ACTIONS = ['lancer', 'lire', 'colonnes'];
const REVIEW_ACTIONS = ['lister', 'modeles', 'create_template', 'preparer', 'lancer', 'lire', 'colonnes', 'relancer'];
const REVIEW_FOLLOWED = ['colonnes', 'relancer'];
const REASONING_COMMANDS = ['verifier', 'lister'];
const SUIVI_COMMANDS = ['verifier', 'lire', 'ecrire'];
const CONVERSION_WAIT_MS = 90000;
const DATA_DIRS = ['.piecemaker-droit-francais-dev', '.piecemaker-droit-francais', '.piecemaker'];
const BOOLEAN_FLAGS = new Set(['force']);
const NODE_WRITE = /\b(?:update|insert(?:\s+or\s+\w+)?\s+into|replace\s+into|delete\s+from)\s+(?:main\.)?piecemaker_nodes\b/i;
const DOCUMENT_COLUMNS = /\bdoc_date\b|'document'/i;
const PIECE_STATES = { 'awaiting-scan': 'à convertir', 'not-converted': 'à convertir', 'conversion-failed': 'échec' };

export const HELP = `Usage: pm <outil> <commande> [options]   (toutes : [--dossier PATH])

  tab lister
      volets ouverts à côté du chat
  tab afficher|fermer <cible>
      cibles : dossier | index | tabular_review [FICHIER.json] | bordereau
               | raisonnement | suivi_dossiers | fichier PATH

  dossier verifier
      anonymisation, index (pièces absentes), pièces non converties
  dossier sql "REQUÊTE"
      seul accès à la base du dossier ; données masquées par le serveur
  dossier conversion [--force] [pièce…]
      sans pièce : tout le dossier (pièces pas encore prêtes) ;
      attend 90 s au plus, puis renvoie l’avancée : relancez pour suivre
  dossier arborescence --dossiers '[{"nom":"…","explication":"…"}]'
      remplace .piecemaker/arborescence.json (lecture : le fichier)
  dossier index lancer [--ia claude|codex|mistral] [--modele-ia TEXT]
      crée l’index s’il manque ; sinon analyse les pièces absentes de l’index
  dossier index lire
  dossier index colonnes --questions JSON

  tabular_review ${REVIEW_ACTIONS.join('|')}
      [--fichier FILE] [--projet ID] [--mode analyse|recherche]
      [--nom TEXT] [--modele ID] [--description TEXT] [--questions JSON]
      [--documents a,b] [--recherche JSON] [--ia claude|codex|mistral] [--modele-ia TEXT]

  bordereau <pièce…>
      tamponne les pièces dans cet ordre : Pièces tamponnées/Pièce n°N.pdf

  raisonnement verifier [--raisonnement NOM]
  raisonnement lister
      un fichier par raisonnement : .piecemaker/raisonnements/NOM.yaml ;
      --raisonnement est requis quand le dossier en compte plusieurs

  suivi_dossiers verifier [--suivi FICHIER]
      vérifie .piecemaker/<nom>-suivi.json et recalcule les échéances ;
      --suivi est requis quand le dossier en compte plusieurs
  suivi_dossiers lire <chemin>
      lit un document du Matter board (ex. projects/cabinet/requests)
  suivi_dossiers ecrire <chemin> --json '{...}'
      écrit un document du Matter board
Le serveur PieceMaker doit tourner (boucle locale).`;

export function parseArgv(argv) {
  const flags = {};
  const positional = [];
  const args = [...argv];
  while (args.length) {
    const token = args.shift();
    if (token === '--') {
      positional.push(...args);
      break;
    }
    if (token === '-h' || token === '--help') {
      flags.help = true;
      continue;
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const key = (eq === -1 ? token.slice(2) : token.slice(2, eq)).replace(/-/g, '_');
      if (BOOLEAN_FLAGS.has(key)) flags[key] = true;
      else if (eq !== -1) flags[key] = token.slice(eq + 1);
      else if (!args.length || (args[0].startsWith('-') && args[0] !== '-')) flags[key] = true;
      else flags[key] = args.shift();
    } else positional.push(token);
  }
  return { flags, positional };
}

function isVendor(root) {
  return Boolean(root) && fs.existsSync(path.join(root, 'installer', 'lib', 'conversion-client.mjs'));
}

function asVendor(dir) {
  if (isVendor(dir)) return dir;
  const nested = path.join(dir, 'server', 'piecemaker', 'vendor');
  return isVendor(nested) ? nested : null;
}

function dataHomes(env) {
  return [
    env.CLOUDCLI_HOME,
    env.PIECEMAKER_HOME,
    ...DATA_DIRS.map((name) => path.join(os.homedir(), name)),
  ].filter(Boolean);
}

function walkVendor(start) {
  let dir = path.resolve(start);
  while (true) {
    const found = asVendor(dir);
    if (found) return found;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function findVendor({ env = process.env, cwd = process.cwd(), here = HERE } = {}) {
  if (env.PIECEMAKER_VENDOR && isVendor(env.PIECEMAKER_VENDOR)) return env.PIECEMAKER_VENDOR;
  const nearby = asVendor(path.resolve(here, '..', '..', '..'));
  if (nearby) return nearby;
  for (const start of [here, cwd]) {
    const found = walkVendor(start);
    if (found) return found;
  }
  for (const home of dataHomes(env)) {
    try {
      const marker = JSON.parse(fs.readFileSync(path.join(home, 'local-server.json'), 'utf8'));
      const found = marker.appRoot && asVendor(marker.appRoot);
      if (found) return found;
    } catch {
      continue;
    }
  }
  throw new Error('Vendor PieceMaker introuvable. Démarrez l’application PieceMaker.');
}

function conversionArgs({ dossier, pieces, force }) {
  const args = ['conversion', '--json', '--case', dossier];
  for (const piece of pieces || []) args.push(piece);
  if (force) args.push('--force');
  return args;
}

const SESSION_VARIABLES = ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID'];

export async function sessionDossier(cwd, { env = process.env, lookup } = {}) {
  if (env.PIECEMAKER_DOSSIER) return env.PIECEMAKER_DOSSIER;
  for (const name of SESSION_VARIABLES) {
    if (!env[name] || !lookup) continue;
    try {
      const dossier = await lookup(env[name]);
      if (dossier) return dossier;
    } catch {}
  }
  return cwd;
}

function resolveDossier(dossier, cwd) {
  return dossier && String(dossier).trim() ? String(dossier).trim() : cwd;
}

function parseJson(value, name) {
  if (value === undefined || value === true) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${name} : JSON invalide.`);
  }
}

function spawnPiecemaker(cliPath, args, cwd, signal) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      signal,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      if (signal?.aborted) return;
      resolve({ code: 1, stdout, stderr: stderr || error.message });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function fail(message) {
  const error = new Error(message);
  error.exitCode = 1;
  throw error;
}

function usage(message) {
  const error = new Error(message ? `${message}\n${HELP}` : HELP);
  error.exitCode = 2;
  throw error;
}

async function defaultDeps(cwd) {
  const vendor = findVendor({ cwd });
  const client = await import(pathToFileURL(path.join(vendor, 'installer', 'lib', 'conversion-client.mjs')).href);
  const volets = await import(pathToFileURL(path.join(vendor, 'mcp', 'piecemaker', 'volets.mjs')).href);
  const panels = await import(pathToFileURL(path.join(vendor, 'mcp', 'piecemaker', 'volets-ouverts.mjs')).href);
  const library = createRequire(path.join(vendor, 'piecemaker-plugin', 'scripts', 'lib', 'case-folders.cjs'));
  const caseFolders = library('./case-folders.cjs');
  const protection = library('./protection.cjs');
  const cliPath = path.join(vendor, 'installer', 'bin', 'piecemaker.mjs');
  const panelsPath = panels.openPanelsFile();
  return {
    sessionDossier: (cwd) => sessionDossier(cwd, { lookup: client.sessionDossier }),
    sqlFn: client.runSql,
    reasoningFn: client.runReasoning,
    suiviFn: client.runSuivi,
    tabularFn: client.runTabularReview,
    stampFn: client.runStamping,
    execFn: (args, dir, signal) => spawnPiecemaker(cliPath, args, dir, signal),
    conversionJob: client.readConversionJob,
    piecesFn: client.readLocalPieces,
    caseState: (dir) => {
      const found = caseFolders.locateProjectCase(dir);
      return { anonymized: Boolean(found?.anonymized), lifted: protection.isProtectionBypassed(found?.caseRoot ?? dir) };
    },
    mappingValidated: (dir) => {
      try { return Boolean(JSON.parse(fs.readFileSync(path.join(dir, '.piecemaker', 'etapes.json'), 'utf8')).mappingValide); } catch { return false; }
    },
    tabularIndex: volets.tabularIndex,
    refuseIndex: volets.refuseIndex,
    describePanels: (dir) => panels.describeOpenPanels(dir, panelsPath),
    exists: (file) => fs.existsSync(file),
    openPanel: (body) => client.requestPanelOpen(body),
    panelCompleted: (args) => client.panelRequestCompleted(args),
    closePanel: (body) => client.requestPanelClose(body),
    panelCloseCompleted: (args) => client.panelCloseCompleted(args),
    waitPanel: (target, timeoutMs) => panels.waitForOpenPanel(target, panelsPath, timeoutMs),
    waitClosed: (target, timeoutMs) => panels.waitForClosedPanel(target, panelsPath, timeoutMs),
    openPanelsTimeoutMs: 8000,
  };
}

async function confirmPanel(api, request, target) {
  const timeoutMs = api.openPanelsTimeoutMs ?? 8000;
  if (api.waitPanel && await api.waitPanel(target, 0)) return { opened: true, alreadyOpen: true };
  let id;
  try {
    if (api.openPanel) ({ id } = await api.openPanel(request));
  } catch {
    const opened = api.waitPanel ? await api.waitPanel(target, timeoutMs) : false;
    return { opened, alreadyOpen: false };
  }
  if (!api.waitPanel && !api.panelCompleted) return { opened: true, alreadyOpen: false };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let completed = false;
    try {
      if (id && api.panelCompleted) completed = await api.panelCompleted({ project: request.project, id });
    } catch {}
    if (await api.waitPanel(target, 0)) return { opened: true, alreadyOpen: false };
    if (completed) {
      await api.waitPanel(target, Math.min(500, deadline - Date.now()));
      return { opened: true, alreadyOpen: false };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { opened: api.waitPanel ? await api.waitPanel(target, 0) : false, alreadyOpen: false };
}

async function confirmClose(api, request, target) {
  const timeoutMs = api.openPanelsTimeoutMs ?? 8000;
  if (api.waitClosed && await api.waitClosed(target, 0)) return { closed: true, alreadyClosed: true };
  let id;
  try {
    if (api.closePanel) ({ id } = await api.closePanel(request));
  } catch {
    const closed = api.waitClosed ? await api.waitClosed(target, timeoutMs) : false;
    return { closed, alreadyClosed: false };
  }
  if (!api.waitClosed && !api.panelCloseCompleted) return { closed: true, alreadyClosed: false };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let completed = false;
    try {
      if (id && api.panelCloseCompleted) completed = await api.panelCloseCompleted({ project: request.project, id });
    } catch {}
    if (await api.waitClosed(target, 0)) return { closed: true, alreadyClosed: false };
    if (completed) {
      await api.waitClosed(target, Math.min(500, deadline - Date.now()));
      return { closed: true, alreadyClosed: false };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { closed: api.waitClosed ? await api.waitClosed(target, 0) : false, alreadyClosed: false };
}

function voletTarget(cwd, volet, review) {
  if (volet === 'bordereau') return { cwd, tab: 'plugin:piecemaker-tampon' };
  if (volet === 'raisonnement') return { cwd, tab: 'plugin:piecemaker-raisonnement' };
  if (volet === 'suivi_dossiers') return { cwd, tab: 'plugin:piecemaker-echeances' };
  if (volet === 'tabular_review') return { cwd, tab: 'plugin:piecemaker-tabular-review', review: review || undefined };
  return { cwd, tab: 'plugin:piecemaker-dossier', view: volet === 'index' ? 'chronology' : 'general' };
}

function panelNoticeLabel(target) {
  if (target.tab === 'files') return `Fichiers (${path.basename(target.document || '')})`;
  if (target.tab === 'plugin:piecemaker-tampon') return 'Bordereau';
  if (target.tab === 'plugin:piecemaker-raisonnement') return 'Raisonnement';
  if (target.tab === 'plugin:piecemaker-echeances') return 'Suivi des dossiers';
  if (target.tab === 'plugin:piecemaker-tabular-review') {
    if (target.draft) return `Analyse tabulaire (projet ${target.draft})`;
    if (target.review) return `Analyse tabulaire (${target.review})`;
    return 'Analyse tabulaire';
  }
  return target.view === 'chronology' ? 'Dossier (index)' : 'Dossier (vue générale)';
}

function sqlPanelTarget(query, cwd) {
  if (!NODE_WRITE.test(query)) return null;
  return {
    cwd,
    tab: 'plugin:piecemaker-dossier',
    view: DOCUMENT_COLUMNS.test(query) ? 'chronology' : 'general',
  };
}

function asText(result) {
  return typeof result === 'string' ? result : JSON.stringify(result);
}

function withNotice(result, notice) {
  return `${asText(result).replace(/\n$/, '')}\n${notice}`;
}

async function followPanel(api, request, target) {
  const label = panelNoticeLabel(target);
  const { opened, alreadyOpen } = await confirmPanel(api, request, target);
  if (!opened) return 'Le volet n’a pas suivi (PieceMaker n’a pas confirmé l’ouverture).';
  return alreadyOpen ? `Déjà visible : ${label}.` : `Visible : ${label}.`;
}

function reviewInput(flags) {
  return {
    fichier: flags.fichier !== true ? flags.fichier : undefined,
    projet: flags.projet !== true ? flags.projet : undefined,
    mode: flags.mode !== true ? flags.mode : undefined,
    nom: flags.nom !== true ? flags.nom : undefined,
    modele: flags.modele !== true ? flags.modele : undefined,
    description: flags.description !== true ? flags.description : undefined,
    questions: parseJson(flags.questions, 'questions'),
    dossiers: parseJson(flags.dossiers, 'dossiers'),
    documents: flags.documents && flags.documents !== true
      ? String(flags.documents).split(',').map((item) => item.trim()).filter(Boolean)
      : undefined,
    recherche: parseJson(flags.recherche, 'recherche'),
    ia: flags.ia !== true ? flags.ia : undefined,
    modele_ia: flags.modele_ia !== true ? flags.modele_ia : undefined,
  };
}

function value(flag) {
  return flag && flag !== true ? String(flag) : undefined;
}

function panelRequest(project, target) {
  const request = { project, ...target };
  delete request.cwd;
  return request;
}

async function tab(api, positional, cwd, resolved) {
  const [, commande, cible, argument] = positional;
  if (!TAB_COMMANDS.includes(commande)) usage(`tab attend ${TAB_COMMANDS.join(', ')}.`);
  if (commande === 'lister') return api.describePanels ? api.describePanels(resolved) : 'Aucun volet ouvert à côté du chat.';
  if (!TAB_TARGETS.includes(cible)) usage(`Cible inconnue : ${cible ?? '(aucune)'}`);
  const closing = commande === 'fermer';
  if (cible === 'fichier') {
    if (!argument) usage('Indiquez le chemin du fichier.');
    const file = path.resolve(cwd, argument);
    if (!closing && !api.exists(file)) fail(`Fichier introuvable : ${argument}`);
    const target = { cwd: resolved, tab: 'files', document: file };
    const request = { project: resolved, tab: 'files', document: file };
    if (closing) {
      const { closed, alreadyClosed } = await confirmClose(api, request, target);
      if (!closed) fail('La fermeture du fichier n’a pas été confirmée dans PieceMaker.');
      return alreadyClosed ? `Déjà fermé : ${argument}` : `Fermé : ${argument}`;
    }
    const { opened, alreadyOpen } = await confirmPanel(api, request, target);
    if (!opened) fail('L’ouverture du fichier n’a pas été confirmée dans PieceMaker.');
    return alreadyOpen ? `Déjà affiché dans le volet de lecture : ${argument}` : `Affiché dans le volet de lecture : ${argument}`;
  }
  const review = cible === 'tabular_review' && argument ? path.basename(argument) : '';
  const target = voletTarget(resolved, cible, review);
  const request = panelRequest(resolved, target);
  const label = `${cible}${review ? ` (${review})` : ''}`;
  if (closing) {
    const { closed, alreadyClosed } = await confirmClose(api, request, target);
    if (!closed) fail(`La fermeture de ${label} n’a pas été confirmée dans PieceMaker.`);
    return alreadyClosed ? `Déjà fermé : ${label}` : `Fermé : ${label}`;
  }
  const { opened, alreadyOpen } = await confirmPanel(api, request, target);
  if (!opened) fail(`L’ouverture de ${label} n’a pas été confirmée dans PieceMaker.`);
  return alreadyOpen ? `Déjà affiché : ${label}` : `Volet affiché : ${label}`;
}

async function runningJob(api, folder) {
  try {
    const { job } = await api.conversionJob({ folder });
    return job?.state === 'running' ? job : null;
  } catch {
    return null;
  }
}

function progress(job) {
  return `Conversion en cours : phase ${job.phase}, ${job.percent} %, ${job.processed}/${job.total} pièce(s).`;
}

async function conversion(api, project, pieces, force) {
  const running = await runningJob(api, project);
  if (running) return `${progress(running)}\nRelancez pm dossier conversion pour suivre.`;
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, api.conversionWaitMs ?? CONVERSION_WAIT_MS, null); });
  const result = await Promise.race([api.execFn(conversionArgs({ dossier: project, pieces, force }), project, controller.signal), timeout]);
  clearTimeout(timer);
  if (!result) {
    controller.abort();
    const job = await runningJob(api, project);
    return `${job ? progress(job) : 'Conversion en cours.'}\nLe travail continue dans PieceMaker : relancez pm dossier conversion pour suivre.`;
  }
  if (result.code !== 0) {
    fail((result.stderr && result.stderr.trim()) || (result.stdout && result.stdout.trim()) || `Échec de la conversion (code ${result.code}).`);
  }
  return result.stdout;
}

async function dossierState(api, project) {
  const state = api.caseState(project);
  const anonymisation = state.lifted ? 'levée par l’avocat (pièces lisibles par l’IA)'
    : state.anonymized ? 'faite' : 'à faire : pm dossier conversion';
  const mappingOk = state.lifted || Boolean(api.mappingValidated?.(project));
  const mapping = state.lifted ? 'sans objet (anonymisation levée)' : mappingOk ? 'validé par l’avocat' : 'à valider par l’avocat (onglet Dossier, Mapping)';
  const { analyses = [], projets = [] } = await api.tabularFn({ action: 'lister', project });
  let index = projets.some((entry) => entry.index) ? 'préparé, pas lancé : pm dossier index lancer' : 'absent : pm dossier index lancer';
  let indexOk = false;
  if (analyses.some((entry) => entry.index)) {
    const { absentes = 0 } = await api.tabularFn({ action: 'index', project });
    indexOk = !absentes;
    index = absentes ? `${absentes} pièce(s) absente(s) de l’index : pm dossier index lancer` : 'à jour';
  }
  const { pieces = [] } = await api.piecesFn({ folder: project });
  const pending = pieces.filter((piece) => piece.status !== 'ready');
  const job = await runningJob(api, project);
  const conversionLine = job ? progress(job)
    : pending.length ? `${pending.length} pièce(s) non convertie(s) : pm dossier conversion\n${pending.map((piece) => `  - ${piece.path} (${PIECE_STATES[piece.status] ?? piece.status})`).join('\n')}`
      : `${pieces.length} pièce(s), toutes converties`;
  const lignes = [
    { nom: 'anonymisation', texte: anonymisation, ok: state.anonymized || state.lifted },
    { nom: 'mapping', texte: mapping, ok: mappingOk },
    { nom: 'index', texte: index, ok: indexOk },
    { nom: 'conversion', texte: conversionLine, ok: !job && !pending.length },
  ];
  return { lignes, pret: lignes.every((ligne) => ligne.ok) };
}

const DOSSIER_LABELS = { anonymisation: 'Anonymisation', mapping: 'Mapping', index: 'Index', conversion: 'Conversion' };

async function verifyDossier(api, project) {
  const { lignes } = await dossierState(api, project);
  return lignes.map((ligne) => `${DOSSIER_LABELS[ligne.nom]} : ${ligne.texte}`).join('\n');
}

export async function etatDossier(project, { deps } = {}) {
  const resolved = path.resolve(project);
  return dossierState(deps || await defaultDeps(resolved), resolved);
}

async function dossier(api, positional, flags, resolved) {
  const commande = positional[1];
  if (!DOSSIER_COMMANDS.includes(commande)) usage(`dossier attend ${DOSSIER_COMMANDS.join(', ')}.`);
  const project = path.resolve(resolved);
  if (commande === 'verifier') return verifyDossier(api, project);
  if (commande === 'conversion') return conversion(api, resolved, positional.slice(2), flags.force === true);
  if (commande === 'sql') {
    const requete = positional.slice(2).join(' ').trim();
    if (!requete) usage('Indiquez une requête SQL.');
    const result = await api.sqlFn({ requete, cwd: resolved });
    const target = sqlPanelTarget(requete, resolved);
    if (!target) return result;
    return withNotice(result, await followPanel(api, { project: resolved, tab: target.tab, view: target.view }, target));
  }
  const target = voletTarget(project, 'index');
  if (commande === 'arborescence') {
    if (!value(flags.dossiers)) usage('dossier arborescence attend --dossiers JSON.');
    const result = await api.tabularIndex(api.tabularFn, { action: 'arborescence', project, dossiers: parseJson(flags.dossiers, 'dossiers') });
    return withNotice(JSON.stringify(result), await followPanel(api, panelRequest(project, target), target));
  }
  const action = positional[2];
  if (!INDEX_ACTIONS.includes(action)) usage(`dossier index attend ${INDEX_ACTIONS.join(', ')}.`);
  const result = await api.tabularIndex(api.tabularFn, { ...reviewInput(flags), action, project });
  return withNotice(JSON.stringify(result), await followPanel(api, panelRequest(project, target), target));
}

async function tabularReview(api, positional, flags, resolved) {
  const action = positional[1];
  if (!REVIEW_ACTIONS.includes(action)) usage('tabular_review attend une action connue.');
  const project = path.resolve(resolved);
  await api.refuseIndex(api.tabularFn, project, { fichier: flags.fichier, projet: flags.projet });
  const result = await api.tabularFn({ ...reviewInput(flags), action, project });
  const text = JSON.stringify(result);
  if (result?.index) {
    const target = voletTarget(project, 'index');
    return withNotice(text, await followPanel(api, panelRequest(project, target), target));
  }
  if (REVIEW_FOLLOWED.includes(action) || action === 'lister' || action === 'preparer' || action === 'lancer') {
    const review = (REVIEW_FOLLOWED.includes(action) || action === 'preparer') && result?.fichier ? String(result.fichier) : undefined;
    const draft = result && typeof result === 'object' && result.projet ? String(result.projet) : undefined;
    const target = { cwd: project, tab: 'plugin:piecemaker-tabular-review', review, draft };
    return withNotice(text, await followPanel(api, { project, tab: target.tab, review, draft }, target));
  }
  return text;
}

async function suiviDossiers(api, positional, flags, resolved) {
  const [, commande, chemin] = positional;
  if (!SUIVI_COMMANDS.includes(commande)) usage(`suivi_dossiers attend ${SUIVI_COMMANDS.join(', ')}.`);
  const cwd = path.resolve(resolved);
  if (commande === 'verifier') {
    if (flags.suivi === true) usage('Indiquez une valeur pour --suivi.');
    return api.suiviFn({ commande, cwd, ...(flags.suivi ? { suivi: String(flags.suivi) } : {}) });
  }
  if (!chemin) usage(`suivi_dossiers ${commande} attend un chemin.`);
  if (commande === 'lire') return api.suiviFn({ commande, chemin, cwd });
  if (!value(flags.json)) usage('suivi_dossiers ecrire attend --json.');
  let donnees;
  try { donnees = JSON.parse(String(flags.json)); } catch { usage('--json : JSON illisible.'); }
  return api.suiviFn({ commande, chemin, donnees, cwd });
}

export async function run(argv, { cwd = process.cwd(), deps } = {}) {
  const { flags, positional } = parseArgv(argv);
  if (flags.help && !positional.length) return HELP;
  const tool = positional[0];
  if (!tool) usage();
  if (!TOOLS.includes(tool)) usage(`Outil inconnu : ${tool}`);
  if (flags.help) return HELP;
  const api = deps || await defaultDeps(cwd);
  const resolved = resolveDossier(flags.dossier, flags.dossier || !api.sessionDossier ? cwd : await api.sessionDossier(cwd));

  if (tool === 'tab') return tab(api, positional, cwd, resolved);
  if (tool === 'dossier') return dossier(api, positional, flags, resolved);
  if (tool === 'tabular_review') return tabularReview(api, positional, flags, resolved);
  if (tool === 'suivi_dossiers') return suiviDossiers(api, positional, flags, resolved);

  if (tool === 'bordereau') {
    const pieces = positional.slice(1);
    if (!pieces.length) usage('Indiquez les pièces dans l’ordre du bordereau.');
    const project = path.resolve(resolved);
    const { results, message } = await api.stampFn({ folder: project, pieces });
    const lines = results.map((entry) => `Pièce n°${entry.pieceNumber} : ${entry.success ? entry.filename : `ÉCHEC, ${entry.error}`}`);
    const target = voletTarget(project, 'bordereau');
    const request = { project, tab: target.tab };
    if (await api.waitPanel(target, 0)) await api.openPanel(request);
    return withNotice([...lines, message].join('\n'), await followPanel(api, request, target));
  }

  const commande = positional[1];
  if (!REASONING_COMMANDS.includes(commande)) usage(`raisonnement attend ${REASONING_COMMANDS.join(', ')}.`);
  if (flags.raisonnement === true) usage('Indiquez une valeur pour --raisonnement.');
  const input = { commande, cwd: path.resolve(resolved), ...(flags.raisonnement ? { raisonnement: String(flags.raisonnement) } : {}) };
  const result = await api.reasoningFn(input);
  const target = voletTarget(input.cwd, 'raisonnement');
  return withNotice(result, await followPanel(api, { project: input.cwd, tab: target.tab }, target));
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  run(process.argv.slice(2)).then((text) => {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(error && error.exitCode ? error.exitCode : 1);
  });
}
