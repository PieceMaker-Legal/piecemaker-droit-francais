#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CATALA_COMMANDS, listPrograms, runCatala, sourceFiles } from './catala.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = ['check', 'tab', 'dossier', 'tabular_review', 'bordereau', 'raisonnement', 'suivi_dossiers', 'memoire', 'catala', 'okf'];
const TAB_COMMANDS = ['lister', 'afficher', 'fermer'];
const TAB_TARGETS = ['dossier', 'index', 'tabular_review', 'bordereau', 'raisonnement', 'suivi_dossiers', 'catala', 'fichier'];
const DOSSIER_COMMANDS = ['sql', 'conversion', 'arborescence', 'index'];
const INDEX_ACTIONS = ['lancer', 'lire', 'colonnes'];
const REVIEW_ACTIONS = ['lister', 'modeles', 'create_template', 'preparer', 'lancer', 'lire', 'colonnes', 'relancer', 'verifier'];
const REVIEW_FOLLOWED = ['colonnes', 'relancer'];
const REASONING_COMMANDS = ['verifier', 'lister'];
const SUIVI_COMMANDS = ['verifier', 'lire', 'ecrire'];
const OKF_COMMANDS = ['verify', 'ontologie', 'types', 'link', 'unlink'];
const CONVERSION_WAIT_MS = 90000;
const DATA_DIRS = ['.piecemaker-droit-francais-dev', '.piecemaker-droit-francais', '.piecemaker'];
const BOOLEAN_FLAGS = new Set(['force', 'whole_program', 'single']);
const NODE_WRITE = /\b(?:update|insert(?:\s+or\s+\w+)?\s+into|replace\s+into|delete\s+from)\s+(?:main\.)?piecemaker_nodes\b/i;
const DOCUMENT_COLUMNS = /\bdoc_date\b|'document'/i;
const PIECE_STATES = { 'awaiting-scan': 'à convertir', 'not-converted': 'à convertir', 'conversion-failed': 'échec' };
const SUIVI_FILES = /^(?:(.+)-)?suivi\.json$/;
const MEMOIRES_DIR = '.piecemaker/memoires';
const ETAPE_LABELS = { preparation: 'préparation', raisonnement: 'raisonnement', redaction: 'rédaction', finalisation: 'finalisation', attente: 'en attente de tiers', clos: 'clos' };
const URGENT_DEADLINE = /— (DÉPASSÉE|AUJOURD’HUI|date à établir)/;

export const HELP = `Usage: pm <outil> <commande> [options]   (toutes : [--dossier PATH])

  check
      bilan numéroté du dossier, dans l'ordre du travail : conversion, anonymisation,
      mapping, index, puis chaque raisonnement (programme Catala, prémisses, actes,
      suivi) et les revues de recherche ; chaque défaut donne la commande ou le
      sous-agent qui le corrige

  tab lister
      volets ouverts à côté du chat
  tab afficher|fermer <cible>
      cibles : dossier | index | tabular_review [FICHIER.json] | bordereau
               | raisonnement | suivi_dossiers | catala | fichier PATH

  dossier sql "REQUÊTE"
      seul accès à la base du dossier ; données masquées par le serveur
  dossier conversion [--force] [pièce…]
      sans pièce : tout le dossier (pièces pas encore prêtes) ;
      attend 90 s au plus, puis renvoie l’avancée : relancez pour suivre
  dossier arborescence [--dossiers '[{"nom":"…","explication":"…"}]'] [--motif "raison"]
      lit l’arborescence ; avec --dossiers, propose une arborescence que l’avocat accepte, refuse ou modifie
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

  memoire verifier [--memoire NOM]
      mémoire d'un projet : .piecemaker/memoires/NOM.md, récit sans frontmatter,
      nommée comme son acte ; sans --memoire : toutes ; rien si tout est conforme

  okf verify
      index du dossier au format OKF (.piecemaker/okf/, une fiche par document) :
      reconstruit les fiches sans IA, puis liste les erreurs (type, document, lien, citation)
      et les contradictions (une prémisse à valeur unique, plusieurs valeurs selon les pièces),
      puis les éléments manquants du graphe : pièce sans prémisse ni lien, prémisse sans pièce,
      sans valeur ou sans partie, partie isolée
  okf types --json '[{"name":"contrat","icon":"pen"}]' [--motif "raison"]
      propose à l'avocat le catalogue complet des types (clés name et icon) ; rien ne change avant sa décision
  okf ontologie
      relations admises entre documents (~/.piecemaker/ontologie.json, commune à tous les dossiers, réglée par l'avocat dans l'onglet Index) :
      nom, sens, types de la source et de la cible ; lecture seule
  okf ontologie proposer --json '{"relations":[...],"documentTypes":[...]}' [--motif "raison"]
      propose à l'avocat les relations (clés name, label, inverse, description, source, target) et/ou
      les types de documents, listes complètes ; clés absentes, inconnues ou hors règles refusées ; rien ne change
      avant sa décision : l'onglet Index › Ontologie montre chaque changement à accepter, refuser ou modifier ;
      une nouvelle proposition remplace la précédente pour chaque liste fournie
  okf link <source> <relation> <target> --citation "phrase du document source"
      entre documents : une relation de l'ontologie (pm okf ontologie), entre les types qu'elle admet ;
      source et cible : chemins ; la citation doit figurer mot pour mot dans le document source
  okf link <pièce> states "<titre de la prémisse>" --citation "phrase de la pièce" [--value "valeur"] [--single]
      la pièce établit une prémisse (fait, ou clause d'un contrat) ; sa fiche Premise est créée si elle manque ;
      --single : la prémisse n'a qu'une valeur, un écart entre pièces est une contradiction
  okf link "<titre de la prémisse>" involves <CODE_PARTIE>
      la prémisse concerne une partie du dossier ; pas de citation
  okf unlink <source> <relation> <target>

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
    reasoningFn: client.runReasoning,
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
      const validated = read('etapes.json').mappingValide;
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
  if (volet === 'catala') return { cwd, tab: 'plugin:piecemaker-catala' };
  if (volet === 'tabular_review') return { cwd, tab: 'plugin:piecemaker-tabular-review', review: review || undefined };
  return { cwd, tab: 'plugin:piecemaker-dossier', view: volet === 'index' ? 'chronology' : 'general' };
}

function panelNoticeLabel(target) {
  if (target.tab === 'files') return `Fichiers (${path.basename(target.document || '')})`;
  if (target.tab === 'plugin:piecemaker-tampon') return 'Bordereau';
  if (target.tab === 'plugin:piecemaker-raisonnement') return 'Raisonnement';
  if (target.tab === 'plugin:piecemaker-echeances') return 'Suivi des dossiers';
  if (target.tab === 'plugin:piecemaker-catala') return 'Catala';
  if (target.tab === 'plugin:piecemaker-tabular-review') {
    if (target.draft) return `Analyse tabulaire (projet ${target.draft})`;
    if (target.review) return `Analyse tabulaire (${target.review})`;
    return 'Analyse tabulaire';
  }
  if (target.view === 'index-analysis') return 'Dossier (analyse tabulaire de l’index)';
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
  const sansEntite = state.anonymized && !state.lifted && (await api.entityCount?.(project)) === 0;
  const anonymisation = state.lifted ? 'levée par l’avocat (pièces lisibles par l’IA)'
    : sansEntite ? 'à refaire, aucune entité ni mapping en base pour ce dossier : pm dossier conversion'
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
  const pending = pieces.filter((piece) => piece.protected && piece.status !== 'ready');
  const job = await runningJob(api, project);
  const conversionLine = job ? progress(job)
    : pending.length ? `${pending.length} pièce(s) non convertie(s) : pm dossier conversion\n${pending.map((piece) => `  - ${piece.path} (${PIECE_STATES[piece.status] ?? piece.status})`).join('\n')}`
      : `${pieces.length} pièce(s), toutes converties`;
  const lignes = [
    { nom: 'anonymisation', texte: anonymisation, ok: (state.anonymized && !sansEntite) || state.lifted },
    { nom: 'mapping', texte: mapping, ok: mappingOk },
    { nom: 'index', texte: index, ok: indexOk },
    { nom: 'conversion', texte: conversionLine, ok: !job && !pending.length },
  ];
  return { lignes, pret: lignes.every((ligne) => ligne.ok) };
}

const DOSSIER_LABELS = { conversion: 'Conversion', anonymisation: 'Anonymisation', mapping: 'Mapping' };

const isPremiseGap = (entry) => entry.element.startsWith('/_premises/');
const agents = (names) => (names.length ? ` (sous-agent ${names.join(', ')})` : '');
const point = (numero, nom, defauts, detail, depth = 0) => ({ numero, depth, ok: !defauts, texte: `${nom} : ${defauts ? `${defauts}${detail ? ` → ${detail}` : ''}` : 'valide'}` });
const titre = (numero, texte, depth = 0) => ({ numero, depth, texte, titre: true });
const letter = (index) => String.fromCharCode(65 + index);

function indexPoint({ erreurs = [], contradictions = [], manques = [] }) {
  const orphans = manques.filter((entry) => !entry.programmes?.length);
  const defauts = [
    erreurs.length ? `${erreurs.length} erreur(s)` : '',
    orphans.length ? `${orphans.length} manque(s)` : '',
    contradictions.length ? `${contradictions.length} contradiction(s) à présenter à l’avocat` : '',
  ].filter(Boolean).join(', ');
  const owners = [
    ...(erreurs.length || orphans.some((entry) => !isPremiseGap(entry)) ? ['index-maker'] : []),
    ...(orphans.some(isPremiseGap) ? ['premise-maker'] : []),
  ];
  return point('4°', 'Index', defauts, `pm okf verify${agents(owners)}`);
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

function attachedPremises(folder, name) {
  const directory = path.join(folder, '.piecemaker', 'catala', name);
  return sourceFiles(directory)
    .flatMap((file) => [...fs.readFileSync(path.join(directory, file), 'utf8').matchAll(/okf:\/(_premises\/\S+\.md)/g)])
    .filter((cited) => fs.existsSync(path.join(folder, '.piecemaker', 'okf', cited[1]))).length;
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

async function reasoningPoints(api, folder, manques) {
  let etapes = {};
  try { etapes = JSON.parse(fs.readFileSync(path.join(folder, '.piecemaker', 'etapes.json'), 'utf8')); } catch {}
  const suites = Object.fromEntries(Object.entries(etapes.raisonnements ?? {}).filter(([, suite]) => !suite.remplacePar));
  const superseded = new Set(Object.keys(etapes.raisonnements ?? {}).filter((nom) => !suites[nom]));
  const programs = listPrograms(folder);
  let suivis = [];
  try { suivis = fs.readdirSync(path.join(folder, '.piecemaker')).filter((entry) => SUIVI_FILES.test(entry)).sort(); } catch {}
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
      add('Catala', catalaState(folder, nom), `pm catala verifier --programme ${nom}`);
      const gaps = manques.filter((entry) => entry.programmes?.includes(nom)).length;
      if (gaps || attachedPremises(folder, nom)) add('Prémisses', gaps ? `${gaps} manque(s)` : '', 'pm okf verify (sous-agent premise-maker)');
      else add('Prémisses', 'aucune', 'sous-agent premise-maker');
    } else add('Catala', 'programme à écrire', 'skill catala');
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
    return { ok: !blocked, texte: `Recherche « ${draft.nom} » : ${blocked ? 'bloquée → pm tabular_review lister (sous-agent deep-research-maker)' : 'en attente'}` };
  });
}

async function check(api, folder) {
  const { lignes } = await dossierState(api, folder);
  const preparation = ['conversion', 'anonymisation', 'mapping'].map((nom, index) => {
    const ligne = lignes.find((entry) => entry.nom === nom);
    return { numero: `${index + 1}°`, depth: 0, ok: ligne.ok, texte: `${DOSSIER_LABELS[nom]} : ${ligne.ok ? 'valide' : ligne.texte.split('\n')[0]}` };
  });
  const okfResult = await api.okfFn({ action: 'verify', folder });
  const { points, others } = await reasoningPoints(api, folder, okfResult.manques ?? []);
  const research = await researchPoints(api, folder);
  const suivis = await Promise.all(others.map(async (suivi) => point('', `Suivi ${suivi}`, await suiviState(api, folder, suivi), `pm suivi_dossiers verifier --suivi ${suivi}`)));
  const tail = [...research, ...suivis].map((entry, index) => ({ ...entry, numero: `${6 + index}°`, depth: 0 }));
  const all = [...preparation, indexPoint(okfResult), ...points, ...tail];
  const failing = all.filter((entry) => !entry.titre && !entry.ok).length;
  return [
    failing ? `Dossier : ${failing} point(s) à traiter.` : 'Dossier : valide.',
    ...all.map((entry) => `${'  '.repeat(entry.depth)}${entry.numero} ${entry.texte}`),
  ].join('\n');
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
  const action = positional[2];
  if (!INDEX_ACTIONS.includes(action)) usage(`dossier index attend ${INDEX_ACTIONS.join(', ')}.`);
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
    const { erreurs, contradictions = [], manques } = await api.okfFn({ action, folder });
    return [
      erreurs.length ? `Index OKF : ${erreurs.length} erreur(s).` : 'Index OKF : aucune erreur.',
      ...erreurs.map((entry) => `- ${entry.fiche} : ${entry.erreur}`),
      ...(contradictions.length ? [`Contradictions : ${contradictions.length}.`] : []),
      ...contradictions.map((entry) => `- ${entry.titre} : ${entry.valeurs.map((item) => `${item.piece} → ${item.valeur}`).join(' ; ')}`),
      ...(manques ? [manques.length ? `Graphe : ${manques.length} élément(s) manquant(s).` : 'Graphe : aucun élément manquant.'] : []),
      ...(manques || []).map((entry) => `- ${entry.element} : ${entry.manque}${entry.programmes?.length ? ` (programme ${entry.programmes.join(', ')})` : ''}`),
    ].join('\n');
  }
  if (action === 'types' || (action === 'ontologie' && positional[2] === 'proposer')) {
    if (!value(flags.json)) usage(action === 'types' ? 'okf types attend --json : liste complète des types {name, icon}.' : 'okf ontologie proposer attend --json \'{"relations":[...],"documentTypes":[...]}\'.');
    let proposee;
    try { proposee = JSON.parse(String(flags.json)); } catch { usage('--json : JSON illisible.'); }
    const ontologie = { ...(action === 'types' ? { documentTypes: proposee } : Array.isArray(proposee) ? { relations: proposee } : proposee), ...(value(flags.motif) ? { motif: String(flags.motif) } : {}) };
    const proposition = await api.okfFn({ action: 'proposer', folder, ontologie });
    const parts = [...(proposition.relations ? [`${proposition.relations.length} relation(s)`] : []), ...(proposition.documentTypes ? [`${proposition.documentTypes.length} type(s) de documents`] : [])];
    return parts.length ? `Proposition enregistrée (${parts.join(', ')}) : l’avocat l’accepte, la refuse ou la modifie dans l’onglet Index › Ontologie.` : 'Aucun changement par rapport à l’ontologie actuelle : aucune proposition en attente.';
  }
  if (action === 'ontologie') {
    const { relations, systeme, erreur, proposition, documentTypes = [], types = [], icones = [] } = await api.okfFn({ action, folder });
    return [
      ...(erreur ? [`Attention : ${erreur}`] : []),
      ...(proposition ? [`Proposition en attente de l’avocat (${proposition.date}) : ${[...(proposition.relations || []), ...(proposition.documentTypes || [])].map((entry) => entry.name).join(', ')}.`] : []),
      'Relations entre documents (ontologie commune à tous les dossiers, modifiable par l’avocat seul ; l’assistant propose en modifiant ~/.piecemaker/ontologie.json avec Edit ou Write) :',
      ...relations.map((entry) => `- ${entry.name} (${entry.label}) : ${entry.source.join(', ')} → ${entry.target.join(', ')}${entry.description ? ` — ${entry.description}` : ''}`),
      `Types principaux du dossier : ${types.join(', ')}. Classement : pm dossier arborescence.`,
      `Icônes disponibles : ${icones.join(', ')}.`,
      'Types de documents (pm okf types --json pour proposer la liste complète) :',
      ...documentTypes.map((entry) => `- ${entry.name} : ${entry.icon}`),
      'Relations système :',
      ...systeme.map((entry) => `- ${entry.name} (${entry.label}) : ${entry.source} → ${entry.target}`),
    ].join('\n');
  }
  const [source, relation, target] = positional.slice(2);
  if (!source || !relation || !target) usage(`okf ${action} attend <source> <relation> <target>.`);
  if (action === 'link' && relation !== 'involves' && !value(flags.citation)) usage('okf link attend --citation.');
  const detail = action === 'link' ? {
    ...(value(flags.citation) ? { citation: String(flags.citation) } : {}),
    ...(value(flags.value) ? { value: String(flags.value) } : {}),
    ...(flags.single ? { single: true } : {}),
  } : {};
  const lien = await api.okfFn({ action, folder, source, relation, target, ...detail });
  return `${action === 'link' ? 'Lien enregistré' : 'Lien retiré'} : ${lien.source} ${lien.relation} ${lien.target}`;
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

function memoire(positional, flags, resolved) {
  if (positional[1] !== 'verifier') usage('memoire attend verifier.');
  if (flags.memoire === true) usage('Indiquez une valeur pour --memoire.');
  const folder = path.resolve(resolved);
  const directory = path.join(folder, MEMOIRES_DIR);
  let noms = flags.memoire ? [String(flags.memoire)] : [];
  if (!flags.memoire) { try { noms = fs.readdirSync(directory).filter((entry) => entry.endsWith('.md')).map((entry) => entry.slice(0, -3)).sort(); } catch {} }
  let etapes = {};
  try { etapes = JSON.parse(fs.readFileSync(path.join(folder, '.piecemaker', 'etapes.json'), 'utf8')); } catch {}
  const acte = (nom) => Boolean(etapes.raisonnements?.[nom]) || [`raisonnements/${nom}.yaml`, `catala/${nom}`, `${nom}-suivi.json`].some((relative) => fs.existsSync(path.join(folder, '.piecemaker', relative)));
  return noms.flatMap((nom) => {
    const fichier = `${MEMOIRES_DIR}/${nom}.md`;
    let texte;
    try { texte = fs.readFileSync(path.join(directory, `${nom}.md`), 'utf8'); } catch { return [`${fichier} : introuvable.`]; }
    return [
      ...(/^---\r?\n/.test(texte) ? [`${fichier}:1: erreur : pas de frontmatter. Les échéances vont dans .piecemaker/${nom}-suivi.json ; l’étape en cours et le document à produire sont sur le tableau de l’onglet Suivi des dossiers (pm check). Reportez-y ses données, puis retirez le frontmatter.`] : []),
      ...(acte(nom) ? [] : [`${fichier} : manque : aucun raisonnement, programme Catala, suivi ni carte du tableau ne s’appelle ${nom}. Nommez la mémoire comme son acte.`]),
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
