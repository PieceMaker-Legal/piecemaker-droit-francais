#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = ['conversion', 'sql', 'afficher', 'chronologie', 'tabular_review'];
const VOLETS = ['dossier', 'chronologie', 'tabular-review'];
const REVIEW_ACTIONS = ['lister', 'ouvrir', 'documents', 'modeles', 'enregistrer_modele', 'preparer', 'lancer'];
const DATA_DIRS = ['.piecemaker-droit-francais-dev', '.piecemaker-droit-francais', '.piecemaker'];
const BOOLEAN_FLAGS = new Set(['force']);

export const HELP = `Usage: pm <outil> [options]

  conversion [--dossier PATH] [--force] [pièce…]
  sql [--dossier PATH] [--requete SQL]
  afficher [--fichier PATH] [--volet ${VOLETS.join('|')}] [--review FILE]
      sans cible : liste les volets ouverts
  chronologie lister [--dossier NOM]
  chronologie modifier --piece ID [--date AAAA-MM-JJ] [--libelle TEXT] [--dossier NOM]
  tabular_review ${REVIEW_ACTIONS.join('|')}
      [--dossier PATH] [--fichier FILE] [--projet ID] [--mode analyse|recherche]
      [--nom TEXT] [--modele ID] [--description TEXT] [--questions JSON]
      [--documents a,b] [--recherche JSON] [--ia claude|codex|mistral] [--modele-ia TEXT]
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
    sqlFn: client.runSql,
    tabularFn: client.runTabularReview,
    execFn: (args, dir) => spawnPiecemaker(cliPath, args, dir),
    chronologieSql: volets.chronologieSql,
    reviewFile: volets.reviewFile,
    describePanels: (dir) => panels.describeOpenPanels(dir, panelsPath),
    exists: (file) => fs.existsSync(file),
    openPanel: (body) => client.requestPanelOpen(body),
    panelCompleted: (args) => client.panelRequestCompleted(args),
    waitPanel: (target, timeoutMs) => panels.waitForOpenPanel(target, panelsPath, timeoutMs),
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

export async function run(argv, { cwd = process.cwd(), deps } = {}) {
  const { flags, positional } = parseArgv(argv);
  if (flags.help && !positional.length) return HELP;
  const tool = positional[0];
  if (!tool) usage();
  if (!TOOLS.includes(tool)) usage(`Outil inconnu : ${tool}`);
  if (flags.help) return HELP;
  const resolved = resolveDossier(flags.dossier, cwd);
  const api = deps || await defaultDeps(cwd);

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
    return api.sqlFn({ requete, cwd: resolved });
  }

  if (tool === 'afficher') {
    if ((!flags.fichier || flags.fichier === true) && (!flags.volet || flags.volet === true)) {
      return api.describePanels ? api.describePanels(resolved) : 'Aucun volet ouvert à côté du chat.';
    }
    if (flags.fichier && flags.fichier !== true) {
      const file = path.resolve(cwd, String(flags.fichier));
      if (!api.exists(file)) fail(`Fichier introuvable : ${flags.fichier}`);
      const target = { cwd: resolved, tab: 'files', document: file };
      const { opened, alreadyOpen } = await confirmPanel(api, { project: resolved, tab: 'files', document: file }, target);
      if (!opened) fail('L’ouverture du fichier n’a pas été confirmée dans PieceMaker.');
      return alreadyOpen
        ? `Déjà affiché dans le volet de lecture : ${flags.fichier}`
        : `Affiché dans le volet de lecture : ${flags.fichier}`;
    }
    if (!VOLETS.includes(flags.volet)) usage(`Volet inconnu : ${flags.volet}`);
    const review = flags.review && flags.review !== true ? path.basename(String(flags.review)) : '';
    const target = flags.volet === 'tabular-review'
      ? { cwd: resolved, tab: 'plugin:piecemaker-tabular-review', review: review || undefined }
      : { cwd: resolved, tab: 'plugin:piecemaker-dossier', view: flags.volet === 'chronologie' ? 'chronology' : 'general' };
    const request = { project: resolved, ...target };
    delete request.cwd;
    const { opened, alreadyOpen } = await confirmPanel(api, request, target);
    if (!opened) fail(`L’ouverture du volet ${flags.volet} n’a pas été confirmée dans PieceMaker.`);
    const label = `${flags.volet}${review ? ` (${review})` : ''}`;
    return alreadyOpen ? `Déjà affiché : ${label}` : `Volet affiché : ${label}`;
  }

  if (tool === 'chronologie') {
    const action = positional[1];
    if (action !== 'lister' && action !== 'modifier') usage('chronologie attend lister ou modifier.');
    return api.sqlFn({
      requete: api.chronologieSql({
        action,
        dossier: flags.dossier && flags.dossier !== true ? flags.dossier : undefined,
        piece: flags.piece,
        date: flags.date === true ? undefined : flags.date,
        libelle: flags.libelle === true ? undefined : flags.libelle,
      }),
      cwd,
    });
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
      const { opened } = await confirmPanel(api, request, target);
      if (!opened) fail('Le volet Tabular Review n’a pas été ouvert dans PieceMaker.');
      if (draft) return `Projet affiché dans le volet Tabular Review : ${draft}`;
      return `Analyse affichée dans le volet Tabular Review. Contenu : « Tabular Review/${name} ».`;
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
    return Array.isArray(result) && action === 'documents' ? result.join('\n') : JSON.stringify(result);
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
