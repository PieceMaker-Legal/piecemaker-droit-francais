#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = ['conversion', 'sql', 'afficher', 'chronologie', 'tabular_review', 'raisonnement', 'docx', 'acte'];
const REASONING_COMMANDS = ['verifier'];
const VOLETS = ['dossier', 'chronologie', 'tabular-review', 'tampon'];
const REVIEW_ACTIONS = ['lister', 'ouvrir', 'documents', 'modeles', 'enregistrer_modele', 'preparer', 'lancer'];
const DATA_DIRS = ['.piecemaker-droit-francais-dev', '.piecemaker-droit-francais', '.piecemaker'];
const BOOLEAN_FLAGS = new Set(['force', 'fermer']);
const NODE_WRITE = /\b(?:update|insert(?:\s+or\s+\w+)?\s+into|replace\s+into|delete\s+from)\s+(?:main\.)?piecemaker_nodes\b/i;
const DOCUMENT_COLUMNS = /\bdoc_date\b|'document'/i;

export const HELP = `Usage: pm <outil> [options]

  conversion [--dossier PATH] [--force] [pièce…]
  sql [--dossier PATH] [--requete SQL]
  afficher [--fichier PATH] [--volet ${VOLETS.join('|')}] [--review FILE]
      sans cible : liste les volets ouverts
      --fermer : ferme le fichier ou le volet
  chronologie lister [--dossier NOM]
  chronologie modifier --piece ID [--date AAAA-MM-JJ] [--libelle TEXT] [--dossier NOM]
  tabular_review ${REVIEW_ACTIONS.join('|')}
      [--dossier PATH] [--fichier FILE] [--projet ID] [--mode analyse|recherche]
      [--nom TEXT] [--modele ID] [--description TEXT] [--questions JSON]
      [--documents a,b] [--recherche JSON] [--ia claude|codex|mistral] [--modele-ia TEXT]
  raisonnement ${REASONING_COMMANDS.join('|')}
      [--question Q1] [--texte TEXT] [--objectif oui|non] [--date NOM] [--nom NOM]
      [--libelle TEXT] [--regle EXPR] [--role condition|fondement|moyen_adverse]
      [--source ID|PATH] [--extrait TEXT] [--a-la-date AAAA-MM-JJ] [--type TYPE]
      [--valeur V] [--piece PATH] [--force-probante FORCE] [--appreciation TEXT]
      [--vue complete] [--champs TEXT] [--cas TEXT] [--parametres TEXT]
      [--etiquette NOM] [--exception-de NOM|base] [--etat NOM] [--si EXPR] [--consequence non]
  docx preparer --fichier FILE.docx --liens FILE.json --sortie FILE.docx [--modele FILE.js]
  docx verifier|comparer --fichier FILE.docx [--modele FILE.js]
  docx extraire --fichier FILE.docx --sortie FILE.js
      chemins relatifs au dossier ; modèle initial : .piecemaker/raisonnement.js
  acte exporter --sortie FILE.docx [--modele MODELE.docx]
  acte fusionner|importer --fichier FILE.docx
      l'acte rédigé vit dans .piecemaker/raisonnement.js ; le DOCX en est l'impression
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

function spawnPiecemaker(cliPath, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
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
  const cliPath = path.join(vendor, 'installer', 'bin', 'piecemaker.mjs');
  const panelsPath = panels.openPanelsFile();
  return {
    sessionDossier: (cwd) => sessionDossier(cwd, { lookup: client.sessionDossier }),
    sqlFn: client.runSql,
    reasoningFn: client.runReasoning,
    docxFn: client.runDocxReasoning,
    acteFn: client.runActe,
    tabularFn: client.runTabularReview,
    execFn: (args, dir) => spawnPiecemaker(cliPath, args, dir),
    chronologieSql: volets.chronologieSql,
    reviewFile: volets.reviewFile,
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
  if (volet === 'tampon') return { cwd, tab: 'plugin:piecemaker-tampon' };
  if (volet === 'tabular-review') return { cwd, tab: 'plugin:piecemaker-tabular-review', review: review || undefined };
  return { cwd, tab: 'plugin:piecemaker-dossier', view: volet === 'chronologie' ? 'chronology' : 'general' };
}

function panelNoticeLabel(target) {
  if (target.tab === 'files') return `Fichiers (${path.basename(target.document || '')})`;
  if (target.tab === 'plugin:piecemaker-tampon') return 'Bordereau';
  if (target.tab === 'plugin:piecemaker-raisonnement') return 'Raisonnement';
  if (target.tab === 'plugin:piecemaker-tabular-review') {
    if (target.draft) return `Analyse tabulaire (projet ${target.draft})`;
    if (target.review) return `Analyse tabulaire (${target.review})`;
    return 'Analyse tabulaire';
  }
  return target.view === 'chronology' ? 'Dossier (chronologie)' : 'Dossier (vue générale)';
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

export async function run(argv, { cwd = process.cwd(), deps } = {}) {
  const { flags, positional } = parseArgv(argv);
  if (flags.help && !positional.length) return HELP;
  const tool = positional[0];
  if (!tool) usage();
  if (!TOOLS.includes(tool)) usage(`Outil inconnu : ${tool}`);
  if (flags.help) return HELP;
  const api = deps || await defaultDeps(cwd);
  const resolved = resolveDossier(flags.dossier, flags.dossier || !api.sessionDossier ? cwd : await api.sessionDossier(cwd));

  if (tool === 'conversion') {
    const pieces = positional.slice(1);
    const result = await api.execFn(conversionArgs({
      dossier: resolved,
      pieces,
      force: flags.force === true || flags.force === 'true',
    }), resolved);
    if (result.code !== 0) {
      fail((result.stderr && result.stderr.trim()) || (result.stdout && result.stdout.trim()) || `Échec de la conversion (code ${result.code}).`);
    }
    return result.stdout;
  }

  if (tool === 'sql') {
    const requete = flags.requete && flags.requete !== true ? String(flags.requete) : positional.slice(1).join(' ').trim();
    if (!requete) usage('Indiquez une requête SQL (--requete ou arguments).');
    const result = await api.sqlFn({ requete, cwd: resolved });
    const target = sqlPanelTarget(requete, resolved);
    if (!target) return result;
    const request = { project: resolved, tab: target.tab, view: target.view };
    return withNotice(result, await followPanel(api, request, target));
  }

  if (tool === 'afficher') {
    const closing = flags.fermer === true;
    if ((!flags.fichier || flags.fichier === true) && (!flags.volet || flags.volet === true)) {
      if (closing) usage('Indiquez --fichier ou --volet avec --fermer.');
      return api.describePanels ? api.describePanels(resolved) : 'Aucun volet ouvert à côté du chat.';
    }
    if (flags.fichier && flags.fichier !== true) {
      const file = path.resolve(cwd, String(flags.fichier));
      if (!closing && !api.exists(file)) fail(`Fichier introuvable : ${flags.fichier}`);
      const target = { cwd: resolved, tab: 'files', document: file };
      const request = { project: resolved, tab: 'files', document: file };
      if (closing) {
        const { closed, alreadyClosed } = await confirmClose(api, request, target);
        if (!closed) fail('La fermeture du fichier n’a pas été confirmée dans PieceMaker.');
        return alreadyClosed ? `Déjà fermé : ${flags.fichier}` : `Fermé : ${flags.fichier}`;
      }
      const { opened, alreadyOpen } = await confirmPanel(api, request, target);
      if (!opened) fail('L’ouverture du fichier n’a pas été confirmée dans PieceMaker.');
      return alreadyOpen
        ? `Déjà affiché dans le volet de lecture : ${flags.fichier}`
        : `Affiché dans le volet de lecture : ${flags.fichier}`;
    }
    if (!VOLETS.includes(flags.volet)) usage(`Volet inconnu : ${flags.volet}`);
    const review = flags.review && flags.review !== true ? path.basename(String(flags.review)) : '';
    const target = voletTarget(resolved, flags.volet, review);
    const request = { project: resolved, ...target };
    delete request.cwd;
    if (closing) {
      const { closed, alreadyClosed } = await confirmClose(api, request, target);
      if (!closed) fail(`La fermeture du volet ${flags.volet} n’a pas été confirmée dans PieceMaker.`);
      const label = `${flags.volet}${review ? ` (${review})` : ''}`;
      return alreadyClosed ? `Déjà fermé : ${label}` : `Fermé : ${label}`;
    }
    const { opened, alreadyOpen } = await confirmPanel(api, request, target);
    if (!opened) fail(`L’ouverture du volet ${flags.volet} n’a pas été confirmée dans PieceMaker.`);
    const label = `${flags.volet}${review ? ` (${review})` : ''}`;
    return alreadyOpen ? `Déjà affiché : ${label}` : `Volet affiché : ${label}`;
  }

  if (tool === 'chronologie') {
    const action = positional[1];
    if (action !== 'lister' && action !== 'modifier') usage('chronologie attend lister ou modifier.');
    const result = await api.sqlFn({
      requete: api.chronologieSql({
        action,
        dossier: flags.dossier && flags.dossier !== true ? flags.dossier : undefined,
        piece: flags.piece,
        date: flags.date === true ? undefined : flags.date,
        libelle: flags.libelle === true ? undefined : flags.libelle,
      }),
      cwd,
    });
    const target = { cwd: resolved, tab: 'plugin:piecemaker-dossier', view: 'chronology' };
    return withNotice(result, await followPanel(api, { project: resolved, tab: target.tab, view: target.view }, target));
  }

  if (tool === 'tabular_review') {
    const action = positional[1];
    if (!REVIEW_ACTIONS.includes(action)) usage('tabular_review attend une action connue.');
    const project = path.resolve(resolved);
    if (action === 'ouvrir') {
      const draft = flags.projet && flags.projet !== true ? String(flags.projet) : '';
      const name = draft ? undefined : api.reviewFile(project, flags.fichier);
      const target = { cwd: project, tab: 'plugin:piecemaker-tabular-review', review: name, draft: draft || undefined };
      const request = { project, tab: 'plugin:piecemaker-tabular-review', review: name, draft: draft || undefined };
      const notice = await followPanel(api, request, target);
      if (draft) return notice;
      return withNotice(`Analyse affichée dans le volet Tabular Review. Contenu : « Tabular Review/${name} ».`, notice);
    }
    const documents = flags.documents && flags.documents !== true
      ? String(flags.documents).split(',').map((item) => item.trim()).filter(Boolean)
      : undefined;
    const result = await api.tabularFn({
      action,
      project,
      fichier: flags.fichier !== true ? flags.fichier : undefined,
      projet: flags.projet !== true ? flags.projet : undefined,
      mode: flags.mode !== true ? flags.mode : undefined,
      nom: flags.nom !== true ? flags.nom : undefined,
      modele: flags.modele !== true ? flags.modele : undefined,
      description: flags.description !== true ? flags.description : undefined,
      questions: parseJson(flags.questions, 'questions'),
      documents,
      recherche: parseJson(flags.recherche, 'recherche'),
      ia: flags.ia !== true ? flags.ia : undefined,
      modele_ia: flags.modele_ia !== true ? flags.modele_ia : undefined,
    });
    const text = Array.isArray(result) && action === 'documents' ? result.join('\n') : JSON.stringify(result);
    if (action === 'lister' || action === 'preparer' || action === 'lancer') {
      const draft = result && typeof result === 'object' && result.projet ? String(result.projet) : '';
      const target = { cwd: project, tab: 'plugin:piecemaker-tabular-review', draft: draft || undefined };
      return withNotice(text, await followPanel(api, { project, tab: target.tab, draft: target.draft }, target));
    }
    return text;
  }

  if (tool === 'docx') {
    const commande = positional[1];
    if (!['preparer', 'verifier', 'comparer', 'extraire'].includes(commande)) usage('docx attend preparer, verifier, comparer ou extraire.');
    if (!flags.fichier || flags.fichier === true) usage('Indiquez --fichier FILE.docx.');
    if (commande === 'preparer' && (!flags.liens || flags.liens === true)) usage('Indiquez --liens FILE.json.');
    if (['preparer', 'extraire'].includes(commande) && (!flags.sortie || flags.sortie === true)) usage('Indiquez une nouvelle --sortie.');
    const input = { commande, cwd: path.resolve(resolved), fichier: String(flags.fichier) };
    for (const flag of ['liens', 'sortie', 'modele']) if (flags[flag] !== undefined) {
      if (flags[flag] === true) usage(`Indiquez une valeur pour --${flag}.`);
      input[flag] = String(flags[flag]);
    }
    const result = await api.docxFn(input);
    if (commande !== 'preparer') return JSON.stringify(result);
    const document = path.resolve(input.cwd, result.fichier);
    return withNotice(JSON.stringify(result), await followPanel(api, { project: input.cwd, tab: 'files', document }, { cwd: input.cwd, tab: 'files', document }));
  }

  if (tool === 'acte') {
    const commande = positional[1];
    if (!['exporter', 'fusionner', 'importer'].includes(commande)) usage('acte attend exporter, fusionner ou importer.');
    const flag = commande === 'exporter' ? 'sortie' : 'fichier';
    if (!flags[flag] || flags[flag] === true) usage(`Indiquez --${flag} FILE.docx.`);
    if (flags.modele === true) usage('Indiquez une valeur pour --modele.');
    const input = { commande, cwd: path.resolve(resolved), [flag]: String(flags[flag]), ...(flags.modele ? { modele: String(flags.modele) } : {}) };
    const result = await api.acteFn(input);
    const text = typeof result.verification === 'string' ? `${JSON.stringify({ ...result, verification: undefined })}\n${result.verification}` : JSON.stringify(result);
    if (commande !== 'exporter') return withNotice(text, await followPanel(api, { project: input.cwd, tab: 'plugin:piecemaker-raisonnement' }, { cwd: input.cwd, tab: 'plugin:piecemaker-raisonnement' }));
    const document = path.resolve(input.cwd, result.fichier);
    return withNotice(text, await followPanel(api, { project: input.cwd, tab: 'files', document }, { cwd: input.cwd, tab: 'files', document }));
  }

  if (tool === 'raisonnement') {
    const commande = positional[1];
    if (!REASONING_COMMANDS.includes(commande)) usage(`raisonnement attend ${REASONING_COMMANDS.join(', ')}.`);
    const input = { commande, cwd: path.resolve(resolved) };
    const result = await api.reasoningFn(input);
    const target = { cwd: input.cwd, tab: 'plugin:piecemaker-raisonnement' };
    return withNotice(result, await followPanel(api, { project: input.cwd, tab: target.tab }, target));
  }

  usage(`Outil inconnu : ${tool}`);
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
