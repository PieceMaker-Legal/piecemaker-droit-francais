#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CATALA_COMMANDS, listPrograms, runCatala } from './catala.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = ['check', 'tab', 'dossier', 'tabular_review', 'bordereau', 'suivi_dossiers', 'memoire', 'catala', 'okf'];
const TAB_COMMANDS = ['lister', 'afficher', 'fermer'];
const TAB_TARGETS = ['dossier', 'index', 'tabular_review', 'bordereau', 'suivi_dossiers', 'catala', 'artifacts', 'fichier'];
// `index` : ancien nom de `case-index`, gardé comme alias.
const CASE_INDEX_COMMAND = 'case-index';
const DOSSIER_COMMANDS = ['sql', 'conversion', 'arborescence', 'classer', CASE_INDEX_COMMAND, 'index'];
const INDEX_ACTIONS = ['lancer', 'lire', 'colonnes'];
const REVIEW_ACTIONS = ['lister', 'modeles', 'create_template', 'preparer', 'lancer', 'lire', 'colonnes', 'relancer', 'verifier'];
const REVIEW_FOLLOWED = ['colonnes', 'relancer'];
const SUIVI_COMMANDS = ['verifier', 'lire', 'ecrire'];
const OKF_COMMANDS = ['verify', 'ontologie'];
const CONVERSION_WAIT_MS = 90000;
const DATA_DIRS = ['.piecemaker-droit-francais-dev', '.piecemaker-droit-francais', '.piecemaker'];
const BOOLEAN_FLAGS = new Set(['force', 'whole_program', 'retirer', 'noms']);
const NODE_WRITE = /\b(?:update|insert(?:\s+or\s+\w+)?\s+into|replace\s+into|delete\s+from)\s+(?:main\.)?piecemaker_nodes\b/i;
const DOCUMENT_COLUMNS = /\bdoc_date\b|'document'/i;
const PIECE_STATES = { 'awaiting-scan': 'à convertir', 'not-converted': 'à convertir', 'conversion-failed': 'échec' };
const SUIVI_FILES = /^(?:(.+)-)?suivi\.json$/;
const MEMOIRES_DIR = '.piecemaker/memoires';
const ETAPE_LABELS = { preparation: 'préparation', raisonnement: 'raisonnement', redaction: 'rédaction', finalisation: 'finalisation', attente: 'en attente de tiers', clos: 'clos' };
const URGENT_DEADLINE = /— (DÉPASSÉE|AUJOURD’HUI|date à établir)/;

const brainLib = await import('../../../piecemaker-plugin/scripts/lib/brain-case.mjs').catch(() => null);
const brainCase = (folder) => { try { return brainLib?.caseOf(folder) ?? null; } catch { return null; } };
const roadmapOf = (folder) => { const target = brainCase(folder); if (!target) return null; try { return brainLib.readRoadmap(target.roadmap); } catch { return {}; } };

function etapesOf(folder) {
  const roadmap = roadmapOf(folder);
  if (roadmap) return roadmap.etapes ?? {};
  try { return JSON.parse(fs.readFileSync(path.join(folder, '.piecemaker', 'etapes.json'), 'utf8')); } catch { return {}; }
}

function suivisOf(folder) {
  const roadmap = roadmapOf(folder);
  if (roadmap) return Object.keys(roadmap.suivis ?? {}).filter((entry) => SUIVI_FILES.test(entry)).sort();
  try { return fs.readdirSync(path.join(folder, '.piecemaker')).filter((entry) => SUIVI_FILES.test(entry)).sort(); } catch { return []; }
}

function memoiresOf(folder) {
  const target = brainCase(folder);
  if (target) {
    const notes = brainLib.goalNames(target.directory).flatMap((goal) => { try { return [[goal, fs.readFileSync(brainLib.goalFile(target.directory, goal, 'Memory.md'), 'utf8')]]; } catch { return []; } });
    return { lieu: target.directory, notes: Object.fromEntries(notes) };
  }
  const directory = path.join(folder, MEMOIRES_DIR);
  let noms = [];
  try { noms = fs.readdirSync(directory).filter((entry) => entry.endsWith('.md')).map((entry) => entry.slice(0, -3)); } catch {}
  return { lieu: null, notes: Object.fromEntries(noms.flatMap((nom) => { try { return [[nom, fs.readFileSync(path.join(directory, `${nom}.md`), 'utf8')]]; } catch { return []; } })) };
}

export const HELP = `Usage: pm <outil> <commande> [options]   (toutes : [--dossier PATH])

  check
      bilan numéroté du dossier, dans l'ordre du travail : conversion, anonymisation,
      mapping, index, puis chaque raisonnement (programme Catala, actes,
      suivi) et les revues de recherche ; chaque défaut donne la commande ou le
      sous-agent qui le corrige

  tab lister
      volets ouverts à côté du chat
  tab afficher|fermer <cible>
      cibles : dossier | index | tabular_review [FICHIER.json] | bordereau
               | suivi_dossiers | catala | fichier PATH

  dossier sql "REQUÊTE"
      seul accès à la base du dossier ; données masquées par le serveur
  dossier conversion [--force] [pièce…]
      sans pièce : tout le dossier (pièces pas encore prêtes) ;
      attend 90 s au plus, puis renvoie l’avancée : relancez pour suivre
  dossier arborescence [--dossiers '[{"nom":"…","explication":"…"}]'] [--motif "raison"]
      lit l’arborescence ; avec --dossiers, propose une arborescence que l’avocat accepte, refuse ou modifie
  dossier classer <document> <dossier>
      range le document dans un dossier de l’arborescence : il prend le type de ce dossier
  dossier case-index lancer [--ia claude|codex|mistral] [--modele-ia TEXT]
      crée le Case index s’il manque ; sinon analyse les pièces absentes du Case index
  dossier case-index lire
  dossier case-index colonnes --questions JSON

  tabular_review ${REVIEW_ACTIONS.join('|')}
      [--fichier FILE] [--projet ID] [--mode analyse|recherche]
      [--nom TEXT] [--modele ID] [--description TEXT] [--questions JSON]
      [--documents a,b] [--recherche JSON] [--ia claude|codex|mistral] [--modele-ia TEXT]

  bordereau <pièce…>
      tamponne les pièces dans cet ordre : Pièces tamponnées/Pièce n°N.pdf

  suivi_dossiers verifier [--suivi FICHIER]
      vérifie .piecemaker/<nom>-suivi.json et recalcule les échéances ;
      --suivi est requis quand le dossier en compte plusieurs
  suivi_dossiers lire <chemin>
      lit un document du Matter board (ex. projects/cabinet/requests)
  suivi_dossiers ecrire <chemin> --json '{...}'
      écrit un document du Matter board

  memoire verifier [--memoire NOM]
      mémoire d'un projet : .piecemaker/memoires/NOM.md, récit sans frontmatter,
      nommée comme son acte ; sans --memoire : toutes ; rien si tout est conforme

  okf verify
      bundle OKF du dossier (.piecemaker/okf/, format Context-OKF) : lance le validateur
      en mode strict et liste chaque ERROR et chaque LINT (frontmatter, lien cassé, concept orphelin)
  okf ontologie
      socle Legal Ontologies Foundry (David Koepsell, CC BY 4.0) : les six patterns ODP-001 à 006
      qui qualifient les concepts du bundle ; lecture seule
  okf ontologie proposer --json '{"arborescence":[...]}' [--motif "raison"]
      propose à l'avocat l'arborescence complète ; rien ne change avant sa décision (onglet Case index › Classement)

  catala verifier [--au today|AAAA-MM-JJ] [--programme NOM]
      programme Catala : .piecemaker/catala/NOM/ (clerk.toml, *.catala_fr) ;
      mise au format, typage, tests Clerk/Python, preuves, Catleg, citations, explication → resultats/verification.json ;
      --programme est requis quand le dossier en compte plusieurs
  catala lister | env
  catala formater [--programme NOM]
  catala preuve --scope CHAMP [--fichier F] [--programme NOM]
  catala expliquer --scope CHAMP [--fichier F] [--programme NOM]
      graphe des formules et conditions pour un champ sans entrées ;
  catala exceptions --scope CHAMP --variable V [--fichier F] [--programme NOM]
      arbre des exceptions d'une variable
  catala executer --scope CHAMP [--fichier F] [--programme NOM]
      exécute un scénario et affiche sa trace
  catala squelette --scope CHAMP [--fichier F] [--programme NOM]
      squelette de test Catala, entrées à leur valeur par défaut
  catala catleg [--au today|AAAA-MM-JJ] [--fichier F] [--programme NOM]
      vigueur des articles à la date --au, sinon date_vigueur de tache.json ; sans date : erreur
  catala section --fichier F --source ID --extrait "…" [--titre "Article 1224"] [--programme NOM]
      ajoute au fichier la section ## titre | ID, l'extrait vérifié mot pour mot et le texte officiel
      (cache local ; ID : LEGIARTI, JORFARTI, JURITEXT, CETATEXT ou CONSTEXT)
  catala exec <catala|clerk|catala-lsp|catala-format|catala-dap> [-- args…]
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
    moveFn: client.movePiece,
    catalaUpdated: client.notifyCatalaUpdated,
    catalaCitations: client.verifyCatalaCitations,
    suiviFn: client.runSuivi,
    okfFn: client.runOkf,
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
      const read = (file) => { try { return JSON.parse(fs.readFileSync(path.join(dir, '.piecemaker', file), 'utf8')); } catch { return {}; } };
      const validated = etapesOf(dir).mappingValide;
      const scanned = Object.values(read('anonymization-state.json').files ?? {}).map((entry) => entry?.scanned?.updatedAt ?? '').sort().at(-1);
      return Boolean(validated) && !(scanned && new Date(scanned) > new Date(validated));
    },
    entityCount: async (dir) => Number(String(await client.runSql({
      requete: "SELECT (SELECT count(*) FROM piecemaker_nodes WHERE project_id = dossier() AND id LIKE 'entity:%') + (SELECT count(*) FROM piecemaker_mappings WHERE project_id = dossier()) AS n",
      cwd: dir,
    })).split('\n')[1]),
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
    let listening;
    if (api.openPanel) ({ id, listening } = await api.openPanel(request));
    if (listening === false) return { opened: false, alreadyOpen: false, absent: true };
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
  if (volet === 'suivi_dossiers') return { cwd, tab: 'plugin:piecemaker-echeances' };
  if (volet === 'catala') return { cwd, tab: 'plugin:piecemaker-catala' };
  if (volet === 'artifacts') return { cwd, tab: 'plugin:piecemaker-artifacts', review: review || undefined };
  if (volet === 'tabular_review') return { cwd, tab: 'plugin:piecemaker-tabular-review', review: review || undefined };
  return { cwd, tab: 'plugin:piecemaker-dossier', view: volet === 'index' ? 'chronology' : 'general' };
}

function panelNoticeLabel(target) {
  if (target.tab === 'files') return `Fichiers (${path.basename(target.document || '')})`;
  if (target.tab === 'plugin:piecemaker-tampon') return 'Bordereau';
  if (target.tab === 'plugin:piecemaker-echeances') return 'Suivi des dossiers';
  if (target.tab === 'plugin:piecemaker-catala') return 'Catala';
  if (target.tab === 'plugin:piecemaker-artifacts') return target.review ? `Artifacts (${target.review})` : 'Artifacts';
  if (target.tab === 'plugin:piecemaker-tabular-review') {
    if (target.draft) return `Analyse tabulaire (projet ${target.draft})`;
    if (target.review) return `Analyse tabulaire (${target.review})`;
    return 'Analyse tabulaire';
  }
  if (target.view === 'index-analysis') return 'Dossier (analyse tabulaire du Case index)';
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
  if (!notice) return asText(result);
  return `${asText(result).replace(/\n$/, '')}\n${notice}`;
}

async function followPanel(api, request, target) {
  const label = panelNoticeLabel(target);
  const { opened, alreadyOpen, absent } = await confirmPanel(api, request, target);
  if (absent) return '';
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
  const review = (cible === 'tabular_review' || cible === 'artifacts') && argument ? path.basename(argument) : '';
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
  return `Conversion en cours : phase ${job.phase}, ${job.processed}/${job.total} (avancement global ${Math.round(job.percent)} %).`;
}

const EN_ARRIERE_PLAN = 'Le travail continue en arrière-plan dans PieceMaker. Ne relancez pas cette commande en boucle.\n'
  + 'Traitez maintenant les points qui ne lisent pas les pièces : programme Catala et suivi.\n'
  + 'L’index et ses liens attendent la fin du scan : il écrit les fiches OKF et pseudonymise les pièces.\n'
  + 'Revenez à la fin avec pm dossier conversion.';

const EN_COURS_CHECK = 'Ne bouclez pas sur pm dossier conversion : traitez d’abord Catala et suivi, qui ne lisent pas les pièces.';

function background(job) {
  return `${job ? progress(job) : 'Conversion en cours.'}\n${EN_ARRIERE_PLAN}`;
}

async function followJob(api, project, deadline) {
  while (Date.now() < deadline) {
    await new Promise((resolve) => { setTimeout(resolve, api.conversionPollMs ?? 2000); });
    if (!await runningJob(api, project)) {
      const { job } = await api.conversionJob({ folder: project }).catch(() => ({}));
      if (job?.state === 'done') return 'Conversion terminée. Lancez pm check.';
      return `Conversion arrêtée : ${job?.state ?? 'état inconnu'}${job?.error ? `, ${job.error}` : ''}.`;
    }
  }
  return background(await runningJob(api, project));
}

async function conversion(api, project, pieces, force) {
  const waitMs = api.conversionWaitMs ?? CONVERSION_WAIT_MS;
  if (await runningJob(api, project)) return followJob(api, project, Date.now() + waitMs);
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, waitMs, null); });
  const result = await Promise.race([api.execFn(conversionArgs({ dossier: project, pieces, force }), project, controller.signal), timeout]);
  clearTimeout(timer);
  if (!result) {
    controller.abort();
    return background(await runningJob(api, project));
  }
  if (result.code !== 0) {
    fail((result.stderr && result.stderr.trim()) || (result.stdout && result.stdout.trim()) || `Échec de la conversion (code ${result.code}).`);
  }
  return result.stdout;
}

async function dossierState(api, project) {
  const state = api.caseState(project);
  const sansEntite = state.anonymized && !state.lifted && (await api.entityCount?.(project)) === 0;
  const anonymisation = state.lifted ? 'levée par l’avocat (pièces lisibles par l’IA)'
    : sansEntite ? 'à refaire, aucune entité ni mapping en base pour ce dossier : pm dossier conversion'
      : state.anonymized ? 'faite' : 'à faire : pm dossier conversion';
  const mappingOk = state.lifted || Boolean(api.mappingValidated?.(project));
  const mapping = state.lifted ? 'sans objet (anonymisation levée)' : mappingOk ? 'validé par l’avocat' : 'à valider par l’avocat (onglet Dossier, Mapping)';
  const { analyses = [], projets = [] } = await api.tabularFn({ action: 'lister', project });
  let index = projets.some((entry) => entry.index) ? 'préparé, pas lancé : pm dossier case-index lancer' : 'absent : pm dossier case-index lancer';
  let indexOk = false;
  if (analyses.some((entry) => entry.index)) {
    const { absentes = 0 } = await api.tabularFn({ action: 'index', project });
    indexOk = !absentes;
    index = absentes ? `${absentes} pièce(s) absente(s) du Case index : pm dossier case-index lancer` : 'à jour';
  }
  const { pieces = [] } = await api.piecesFn({ folder: project });
  const pending = pieces.filter((piece) => piece.protected && piece.status !== 'ready');
  const job = await runningJob(api, project);
  const conversionLine = job ? progress(job)
    : pending.length ? `${pending.length} pièce(s) non convertie(s) : pm dossier conversion\n${pending.map((piece) => `  - ${piece.path} (${PIECE_STATES[piece.status] ?? piece.status})`).join('\n')}`
      : `${pieces.length} pièce(s), toutes converties`;
  const lignes = [
    { nom: 'anonymisation', texte: job && (!state.anonymized || sansEntite) ? 'en cours, voir 1°' : anonymisation, ok: (state.anonymized && !sansEntite) || state.lifted },
    { nom: 'mapping', texte: mapping, ok: mappingOk },
    { nom: 'index', texte: index, ok: indexOk },
    { nom: 'conversion', texte: conversionLine, ok: !job && !pending.length },
  ];
  return { lignes, pret: lignes.every((ligne) => ligne.ok), enCours: Boolean(job) };
}

const DOSSIER_LABELS = { conversion: 'Conversion', anonymisation: 'Anonymisation', mapping: 'Mapping' };

const point = (numero, nom, defauts, detail, depth = 0) => ({ numero, depth, ok: !defauts, texte: `${nom} : ${defauts ? `${defauts}${detail ? ` → ${detail}` : ''}` : 'valide'}` });
const titre = (numero, texte, depth = 0) => ({ numero, depth, texte, titre: true });
const letter = (index) => String.fromCharCode(65 + index);

function indexPoint({ erreurs = [], lints = [] }) {
  const defauts = [
    erreurs.length ? `${erreurs.length} erreur(s)` : '',
    lints.length ? `${lints.length} lint(s)` : '',
  ].filter(Boolean).join(', ');
  return point('4°', 'Index', defauts, 'pm okf verify');
}

function newestSource(directory) {
  let newest = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'resultats' || entry.name.startsWith('_')) continue;
    const file = path.join(directory, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestSource(file) : fs.statSync(file).mtimeMs);
  }
  return newest;
}

function catalaState(folder, name) {
  const directory = path.join(folder, '.piecemaker', 'catala', name);
  const result = path.join(directory, 'resultats', 'verification.json');
  let report = null;
  try { report = JSON.parse(fs.readFileSync(result, 'utf8')); } catch {}
  if (!report) return 'jamais vérifié';
  if (newestSource(directory) > fs.statSync(result).mtimeMs) return 'modifié depuis la vérification';
  if (report.passed) return '';
  return `${(report.checks ?? []).filter((entry) => !entry.passed).length || 1} contrôle(s) en échec`;
}


async function suiviState(api, folder, suivi) {
  let text;
  try { text = String(await api.suiviFn({ commande: 'verifier', cwd: folder, suivi })); } catch { return 'vérification impossible'; }
  const issues = /(\d+) erreur\(s\), (\d+) manque\(s\)\./.exec(text);
  const urgent = text.split('\n').filter((entry) => URGENT_DEADLINE.test(entry)).length;
  return [
    ...(issues && (issues[1] !== '0' || issues[2] !== '0') ? [`${issues[1]} erreur(s), ${issues[2]} manque(s)`] : []),
    ...(urgent ? [`${urgent} échéance(s) dépassée(s), du jour ou sans date`] : []),
  ].join(', ');
}

function documentState(folder, document) {
  if (document.valide) return '';
  return fs.existsSync(path.resolve(folder, document.chemin)) ? 'en cours de rédaction' : 'à rédiger';
}

async function reasoningPoints(api, folder) {
  const etapes = etapesOf(folder);
  const suites = Object.fromEntries(Object.entries(etapes.raisonnements ?? {}).filter(([, suite]) => !suite.remplacePar));
  const superseded = new Set(Object.keys(etapes.raisonnements ?? {}).filter((nom) => !suites[nom]));
  const programs = listPrograms(folder);
  const suivis = suivisOf(folder);
  const suiviOf = (nom) => suivis.find((entry) => SUIVI_FILES.exec(entry)[1] === nom);
  const names = [...new Set([...Object.keys(suites), ...programs, ...suivis.map((entry) => SUIVI_FILES.exec(entry)[1]).filter(Boolean)])]
    .filter((nom) => !superseded.has(nom)).sort();
  if (!names.length) return { points: [{ numero: '5°', depth: 0, ok: true, texte: 'Raisonnement : aucun' }], others: suivis };
  const points = [titre('5°', 'Raisonnement')];
  for (const [index, nom] of names.entries()) {
    const numero = `5.${letter(index)}`;
    const suite = suites[nom];
    points.push(titre(numero, `${nom}${suite ? ` (${ETAPE_LABELS[suite.etape] ?? suite.etape})` : ''}`, 1));
    if (suite?.etape === 'clos') continue;
    const children = [];
    const add = (nomPoint, defauts, detail) => children.push(point(`${numero}.${children.length + 1}`, nomPoint, defauts, detail, 2));
    if (programs.includes(nom)) {
      add(`Programme Catala (.piecemaker/catala/${nom}/)`, catalaState(folder, nom), `pm catala verifier --programme ${nom}`);
    } else add('Programme Catala', 'à écrire', 'skill catala');
    for (const document of suite?.documents ?? []) {
      const state = documentState(folder, document);
      children.push({ numero: `${numero}.${children.length + 1}`, depth: 2, ok: !state, texte: `${document.nom} : ${state || 'validé'}` });
    }
    const suivi = suiviOf(nom);
    if (suivi) add('Suivi', await suiviState(api, folder, suivi), `pm suivi_dossiers verifier --suivi ${suivi}`);
    points.push(...children);
  }
  return { points, others: suivis.filter((entry) => !SUIVI_FILES.exec(entry)[1]) };
}

async function researchPoints(api, folder) {
  const { projets = [] } = await api.tabularFn({ action: 'lister', project: folder });
  return projets.filter((draft) => draft.mode === 'recherche').map((draft) => {
    const blocked = draft.erreur || draft.a_completer?.length;
    return { ok: !blocked, texte: `Recherche « ${draft.nom} » : ${blocked ? 'bloquée → pm tabular_review lister' : 'en attente'}` };
  });
}

async function check(api, folder) {
  const { lignes, enCours } = await dossierState(api, folder);
  const preparation = ['conversion', 'anonymisation', 'mapping'].map((nom, index) => {
    const ligne = lignes.find((entry) => entry.nom === nom);
    return { numero: `${index + 1}°`, depth: 0, ok: ligne.ok, texte: `${DOSSIER_LABELS[nom]} : ${ligne.ok ? 'valide' : ligne.texte.split('\n')[0]}` };
  });
  if (enCours) preparation[0].texte += ` ${EN_COURS_CHECK}`;
  const okfResult = await api.okfFn({ action: 'verify', folder });
  const { points, others } = await reasoningPoints(api, folder);
  const research = await researchPoints(api, folder);
  const suivis = await Promise.all(others.map(async (suivi) => point('', `Suivi ${suivi}`, await suiviState(api, folder, suivi), `pm suivi_dossiers verifier --suivi ${suivi}`)));
  const tail = [...research, ...suivis].map((entry, index) => ({ ...entry, numero: `${6 + index}°`, depth: 0 }));
  const all = [...preparation, indexPoint(okfResult), ...points, ...tail];
  const failing = all.filter((entry) => !entry.titre && !entry.ok).length;
  const note = await synthese(api, folder, all);
  return [
    failing ? `Dossier : ${failing} point(s) à traiter.` : 'Dossier : valide.',
    ...all.map((entry) => `${'  '.repeat(entry.depth)}${entry.numero} ${entry.texte}`),
    ...(note ? [note] : []),
    ...pairLines(folder),
  ].join('\n');
}

function pairLines(folder) {
  const target = brainCase(folder);
  return target ? [`Dossier : ${target.about} ; goals : ${target.goals}/<goal>/ (Goal.md, Memory.md, Archive.md, Timeline.json) ; synthèse : ${path.join(target.directory, brainLib.SYNTHESE)}.`] : [];
}

async function synthese(api, folder, points) {
  let lib;
  try { lib = await import('../../../piecemaker-plugin/scripts/lib/brain-case.mjs'); } catch { return ''; }
  try {
    await lib.runSynthese(folder, { points, pm: (...argv) => run([...argv, '--dossier', folder], { cwd: folder, deps: api }) });
    return '';
  } catch (error) {
    const target = lib.caseOf(folder, { create: false });
    return `Synthèse du dossier : le script ${target ? path.join(target.directory, lib.SYNTHESE) : lib.SYNTHESE} a échoué (${error instanceof Error ? error.message : String(error)}) : corrige-le.`;
  }
}

export async function etatDossier(project, { deps } = {}) {
  const resolved = path.resolve(project);
  return dossierState(deps || await defaultDeps(resolved), resolved);
}

async function dossier(api, positional, flags, resolved) {
  const commande = positional[1];
  if (!DOSSIER_COMMANDS.includes(commande)) usage(`dossier attend ${DOSSIER_COMMANDS.join(', ')}.`);
  const project = path.resolve(resolved);
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
    const proposal = value(flags.dossiers) ? { dossiers: parseJson(flags.dossiers, 'dossiers'), ...(value(flags.motif) ? { motif: String(flags.motif) } : {}) } : {};
    const result = await api.tabularIndex(api.tabularFn, { action: 'arborescence', project, ...proposal });
    return withNotice(JSON.stringify(result), await followPanel(api, panelRequest(project, target), target));
  }
  if (commande === 'classer') {
    const [document, directory] = positional.slice(2);
    if (!document || !directory) usage('dossier classer attend <document> <dossier>.');
    const { dossiers = [] } = await api.tabularIndex(api.tabularFn, { action: 'arborescence', project });
    const names = dossiers.map((entry) => String(entry.nom));
    if (names.length && !names.some((name) => directory === name || directory.startsWith(`${name}/`))) usage(`dossier classer attend un dossier de l’arborescence : ${names.join(', ')}.`);
    const moved = await api.moveFn({ folder: project, path: document, directory });
    return withNotice(`Classé : ${moved.previous} → ${moved.current}`, await followPanel(api, panelRequest(project, target), target));
  }
  const action = positional[2];
  if (!INDEX_ACTIONS.includes(action)) usage(`dossier ${CASE_INDEX_COMMAND} attend ${INDEX_ACTIONS.join(', ')}.`);
  const result = await api.tabularIndex(api.tabularFn, { ...reviewInput(flags), action, project });
  const analysis = { ...target, view: 'index-analysis' };
  return withNotice(JSON.stringify(result), await followPanel(api, panelRequest(project, analysis), analysis));
}

async function tabularReview(api, positional, flags, resolved) {
  const action = positional[1];
  if (!REVIEW_ACTIONS.includes(action)) usage('tabular_review attend une action connue.');
  const project = path.resolve(resolved);
  if (action === 'verifier') return (await researchPoints(api, project)).filter((entry) => !entry.ok).map((entry) => entry.texte).join('\n');
  await api.refuseIndex(api.tabularFn, project, { fichier: flags.fichier, projet: flags.projet });
  const result = await api.tabularFn({ ...reviewInput(flags), action, project });
  const text = JSON.stringify(result);
  if (result?.index) {
    const target = { ...voletTarget(project, 'index'), view: 'index-analysis' };
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

async function okf(api, positional, flags, resolved) {
  const action = positional[1];
  if (!OKF_COMMANDS.includes(action)) usage(`okf attend ${OKF_COMMANDS.join(', ')}.`);
  const folder = path.resolve(resolved);
  if (action === 'verify') {
    const { erreurs, lints, resume } = await api.okfFn({ action, folder });
    return [
      ...erreurs.map((entry) => `ERROR  ${entry.fiche}: ${entry.erreur}`),
      ...lints.map((entry) => `LINT   ${entry.fiche}: ${entry.erreur}`),
      resume || `${erreurs.length} error(s), ${lints.length} lint(s)`,
    ].join('\n');
  }
  if (action === 'ontologie' && positional[2] === 'proposer') {
    if (!value(flags.json)) usage('okf ontologie proposer attend --json \'{"arborescence":[...]}\'.');
    let proposee;
    try { proposee = JSON.parse(String(flags.json)); } catch { usage('--json : JSON illisible.'); }
    const proposition = await api.okfFn({ action: 'proposer', folder, ontologie: { ...proposee, ...(value(flags.motif) ? { motif: String(flags.motif) } : {}) } });
    return proposition.arborescence ? `Proposition enregistrée (${proposition.arborescence.length} dossier(s)) : l’avocat l’accepte, la refuse ou la modifie dans l’onglet Case index › Classement.` : 'Aucun changement par rapport à l’arborescence actuelle : aucune proposition en attente.';
  }
  const { patterns = [], erreur, proposition, types = [] } = await api.okfFn({ action, folder });
  return [
    ...(erreur ? [`Attention : ${erreur}`] : []),
    ...(proposition ? [`Proposition en attente de l’avocat (${proposition.date}).`] : []),
    'Socle : Legal Ontologies Foundry, David R. Koepsell, CC BY 4.0. Patterns :',
    ...patterns.map((pattern) => `- ${pattern.id} — ${pattern.title} : ${pattern.description}`),
    `Types principaux du dossier : ${types.join(', ')}. Classement : pm dossier arborescence.`,
  ].join('\n');
}

async function suiviDossiers(api, positional, flags, resolved) {
  const [, commande, chemin] = positional;
  if (!SUIVI_COMMANDS.includes(commande)) usage(`suivi_dossiers attend ${SUIVI_COMMANDS.join(', ')}.`);
  const cwd = path.resolve(resolved);
  if (commande === 'verifier') {
    if (flags.suivi === true) usage('Indiquez une valeur pour --suivi.');
    if (flags.suivi) return api.suiviFn({ commande, cwd, suivi: String(flags.suivi) });
    const tous = suivisOf(cwd);
    if (tous.length < 2) return api.suiviFn({ commande, cwd, ...(tous.length ? { suivi: tous[0] } : {}) });
    const textes = [];
    for (const suivi of tous) textes.push(`${suivi}\n${await api.suiviFn({ commande, cwd, suivi })}`);
    return textes.join('\n\n');
  }
  if (!chemin) usage(`suivi_dossiers ${commande} attend un chemin.`);
  if (commande === 'lire') return api.suiviFn({ commande, chemin, cwd });
  if (!value(flags.json)) usage('suivi_dossiers ecrire attend --json.');
  let donnees;
  try { donnees = JSON.parse(String(flags.json)); } catch { usage('--json : JSON illisible.'); }
  return api.suiviFn({ commande, chemin, donnees, cwd });
}

function memoire(positional, flags, resolved) {
  if (positional[1] !== 'verifier') usage('memoire attend verifier.');
  if (flags.memoire === true) usage('Indiquez une valeur pour --memoire.');
  const folder = path.resolve(resolved);
  const { lieu, notes } = memoiresOf(folder);
  const noms = flags.memoire ? [String(flags.memoire)] : Object.keys(notes).sort();
  const etapes = etapesOf(folder);
  const suivis = new Set(suivisOf(folder));
  const acte = (nom) => Boolean(etapes.raisonnements?.[nom]) || suivis.has(`${nom}-suivi.json`) || fs.existsSync(path.join(folder, '.piecemaker', 'catala', nom));
  return noms.flatMap((nom) => {
    const fichier = lieu ? brainLib.goalFile(lieu, nom, 'Memory.md') : `${MEMOIRES_DIR}/${nom}.md`;
    const texte = notes[nom];
    if (texte === undefined) return [`${fichier} : introuvable.`];
    const lignes = texte.replace(/\n$/, '').split('\n').length;
    if (lieu) return [
      ...(/^---\r?\n/.test(texte) ? [`${fichier}:1: erreur : pas de frontmatter.`] : []),
      ...(lignes > brainLib.GOAL_LIMIT ? [`${fichier} : erreur : ${lignes} lignes, limite ${brainLib.GOAL_LIMIT}. Déplacez ce qui ne sert plus dans Archive.md.`] : []),
    ];
    return [
      ...(/^---\r?\n/.test(texte) ? [`${fichier}:1: erreur : pas de frontmatter. Les échéances vont dans .piecemaker/${nom}-suivi.json ; l’étape en cours et le document à produire sont sur le tableau de l’onglet Suivi des dossiers (pm check). Reportez-y ses données, puis retirez le frontmatter.`] : []),
      ...(acte(nom) ? [] : [`${fichier} : manque : aucun programme Catala, suivi ni carte du tableau ne s’appelle ${nom}. Nommez la mémoire comme son acte.`]),
    ];
  }).join('\n');
}

async function catala(api, positional, flags, resolved) {
  const [, commande, ...args] = positional;
  if (!CATALA_COMMANDS.includes(commande)) usage(`catala attend ${CATALA_COMMANDS.join(', ')}.`);
  if (flags.programme === true) usage('Indiquez une valeur pour --programme.');
  const input = { commande, cwd: path.resolve(resolved), flags, args, ...(flags.programme ? { programme: String(flags.programme) } : {}) };
  if (commande === 'verifier' && api.catalaCitations) input.deps = { citations: api.catalaCitations };
  const updatePanel = ['verifier', 'preuve', 'catleg', 'expliquer'].includes(commande) && api.catalaUpdated;
  try {
    const result = await (api.catalaFn || runCatala)(input);
    if (updatePanel) {
      try { await api.catalaUpdated({ cwd: input.cwd }); } catch { return `${result}\nVolet non actualisé : rouvrez le volet Catala.`; }
    }
    return result;
  } catch (error) {
    if (updatePanel) { try { await api.catalaUpdated({ cwd: input.cwd }); } catch {} }
    if (error instanceof TypeError) usage(error.message);
    fail(error.message);
  }
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

  if (tool === 'check') return check(api, path.resolve(resolved));
  if (tool === 'tab') return tab(api, positional, cwd, resolved);
  if (tool === 'dossier') return dossier(api, positional, flags, resolved);
  if (tool === 'tabular_review') return tabularReview(api, positional, flags, resolved);
  if (tool === 'suivi_dossiers') return suiviDossiers(api, positional, flags, resolved);
  if (tool === 'catala') return catala(api, positional, flags, resolved);
  if (tool === 'okf') return okf(api, positional, flags, resolved);
  if (tool === 'memoire') return memoire(positional, flags, resolved);

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

  usage();
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  if (process.env.NO_COLOR) delete process.env.FORCE_COLOR;
  run(process.argv.slice(2)).then((text) => {
    if (text && typeof text === 'object') {
      process.exitCode = text.exitCode;
      return;
    }
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(error && error.exitCode ? error.exitCode : 1);
  });
}
