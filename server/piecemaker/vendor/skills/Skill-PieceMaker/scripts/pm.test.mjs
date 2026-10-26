import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CASSATION_MATIERES, COLUMN_FORMATS, PREMIERE_INSTANCE_TYPES, RESEARCH_SOURCES, VOLETS } from '../../../mcp/piecemaker/volets.mjs';
import { findVendor, parseArgv, run, sessionDossier } from './pm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('parseArgv sépare drapeaux, booléens et positionnels', () => {
  assert.deepEqual(parseArgv(['sql', '--requete', 'SELECT 1', '--dossier', '/tmp']), {
    flags: { requete: 'SELECT 1', dossier: '/tmp' },
    positional: ['sql'],
  });
  assert.deepEqual(parseArgv(['conversion', '--force', 'contrat.pdf']), {
    flags: { force: true },
    positional: ['conversion', 'contrat.pdf'],
  });
  assert.equal(parseArgv(['chronologie', 'modifier', '--date', '']).flags.date, '');
  assert.equal(parseArgv(['--help']).flags.help, true);
});

test('findVendor résout le vendor voisin et PIECEMAKER_VENDOR', () => {
  const vendor = findVendor({ here: HERE, cwd: os.tmpdir(), env: {} });
  assert.equal(vendor, path.resolve(HERE, '..', '..', '..'));
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-skill-vendor-'));
  fs.mkdirSync(path.join(isolated, 'installer', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(isolated, 'installer', 'lib', 'conversion-client.mjs'), '');
  assert.equal(findVendor({ here: os.tmpdir(), cwd: os.tmpdir(), env: { PIECEMAKER_VENDOR: isolated } }), isolated);
  fs.rmSync(isolated, { recursive: true, force: true });
});

test('sql et chronologie passent par sqlFn', async () => {
  const calls = [];
  const deps = {
    sqlFn: async (input) => {
      calls.push(input);
      return 'ok';
    },
    chronologieSql: (input) => `SQL:${input.action}:${input.piece}:${input.date}`,
    waitPanel: async () => true,
  };
  assert.equal(await run(['sql', '--requete', 'SELECT label FROM piecemaker_nodes'], { deps }), 'ok');
  assert.deepEqual(calls[0], { requete: 'SELECT label FROM piecemaker_nodes', cwd: process.cwd() });
  const written = await run(['sql', '--requete', "UPDATE piecemaker_nodes SET label='x' WHERE id='p:1'"], { deps });
  assert.match(written, /^ok\nDéjà visible : Dossier \(vue générale\)\.\n?$/);
  const chrono = await run(['chronologie', 'modifier', '--piece', 'doc:1', '--date', '2024-03-01'], { deps });
  assert.equal(calls[2].requete, 'SQL:modifier:doc:1:2024-03-01');
  assert.match(chrono, /visible : Dossier \(chronologie\)\./i);
});

test('afficher vérifie le fichier, liste les volets et ouvre une cible', async () => {
  const opened = [];
  const deps = {
    exists: (file) => file === path.resolve(process.cwd(), 'Actes/lettre.docx'),
    describePanels: () => 'Aucun volet ouvert à côté du chat.',
    waitPanel: async (target) => opened.some((body) => body.tab === target.tab && body.view === target.view && body.document === target.document),
    openPanel: async (body) => {
      opened.push(body);
      return { id: '1' };
    },
  };
  assert.equal(await run(['afficher'], { deps }), 'Aucun volet ouvert à côté du chat.');
  assert.equal(
    await run(['afficher', '--fichier', 'Actes/lettre.docx'], { deps }),
    'Affiché dans le volet de lecture : Actes/lettre.docx',
  );
  assert.equal(opened[0].tab, 'files');
  await assert.rejects(() => run(['afficher', '--fichier', 'absent.docx'], { deps }), /introuvable/);
  assert.equal(await run(['afficher', '--volet', 'chronologie'], { deps }), 'Volet affiché : chronologie');
  assert.equal(opened[1].view, 'chronology');
  assert.equal(await run(['afficher', '--volet', 'tampon'], { deps }), 'Volet affiché : tampon');
  assert.equal(opened[2].tab, 'plugin:piecemaker-tampon');
});

test('afficher --fermer ferme le volet sans le rouvrir', async () => {
  const closed = [];
  const open = new Set(['plugin:piecemaker-dossier']);
  const deps = {
    waitPanel: async () => false,
    waitClosed: async (target) => !open.has(target.tab),
    closePanel: async (body) => {
      closed.push(body);
      open.delete(body.tab);
      return { id: 'c1' };
    },
    openPanel: async () => {
      throw new Error('ne doit pas ouvrir');
    },
  };
  assert.equal(await run(['afficher', '--fermer', '--volet', 'chronologie'], { deps }), 'Fermé : chronologie');
  assert.equal(closed[0].tab, 'plugin:piecemaker-dossier');
  assert.equal(await run(['afficher', '--fermer', '--volet', 'chronologie'], { deps }), 'Déjà fermé : chronologie');
});

test('tabular_review ouvre localement et transmet le reste', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-skill-tr-'));
  fs.mkdirSync(path.join(dossier, 'Tabular Review'));
  fs.writeFileSync(path.join(dossier, 'Tabular Review', 'analyse-exemple.json'), '{}');
  const calls = [];
  const opened = [];
  const deps = {
    reviewFile: (root, fichier) => {
      const name = path.basename(String(fichier ?? ''));
      if (!fs.existsSync(path.join(root, 'Tabular Review', name))) throw new Error(`introuvable : ${name}`);
      return name;
    },
    waitPanel: async () => opened.length > 0,
    openPanel: async () => {
      opened.push(true);
      return { id: '1' };
    },
    tabularFn: async (input) => {
      calls.push(input);
      if (input.action === 'documents') return ['Pièces/bail.md'];
      return { projet: 'p-1' };
    },
  };
  const shown = await run(['tabular_review', 'ouvrir', '--fichier', 'analyse-exemple.json', '--dossier', dossier], { deps });
  assert.match(shown, /analyse-exemple\.json/);
  assert.match(shown, /Visible : Analyse tabulaire \(analyse-exemple\.json\)\./);
  await assert.rejects(() => run(['tabular_review', 'ouvrir', '--fichier', 'absente.json', '--dossier', dossier], { deps }), /introuvable/);
  const prepared = await run([
    'tabular_review', 'preparer', '--dossier', dossier, '--mode', 'recherche', '--nom', 'Faute grave',
    '--recherche', '{"query":"faute","sources":["cassation"]}',
  ], { deps });
  assert.match(prepared, /"projet":"p-1"/);
  assert.match(prepared, /visible : Analyse tabulaire/i);
  assert.deepEqual(calls[0].recherche, { query: 'faute', sources: ['cassation'] });
  assert.equal(await run(['tabular_review', 'documents', '--dossier', dossier], { deps }), 'Pièces/bail.md');
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('SKILL.md documente toute la surface d’interface', () => {
  const skill = fs.readFileSync(path.join(HERE, '..', 'SKILL.md'), 'utf8');
  const required = [
    'conversion', 'sql', 'afficher', 'chronologie', 'tabular_review',
    '--fichier', '--volet', '--review', '--fermer', '--force', '--requete', '--dossier',
    'Visible',
    'lister', 'modifier', '--piece', '--date', '--libelle',
    'ouvrir', 'documents', 'modeles', 'enregistrer_modele', 'preparer', 'lancer',
    '--projet', '--mode', '--nom', '--modele', '--description', '--questions',
    '--documents', '--recherche', '--ia', '--modele-ia',
    'analyse', 'recherche', 'claude', 'codex', 'mistral',
    'publicationBulletin', 'publicationConseilEtat', 'publicationCaa',
    'typesPremiereInstance', 'dateDebut', 'dateFin', 'dispositifOnly',
    'TOUS', 'PUBLIE', 'INEDIT', 'NON_PUBLIE',
    ...VOLETS, ...COLUMN_FORMATS, ...RESEARCH_SOURCES, ...CASSATION_MATIERES, ...PREMIERE_INSTANCE_TYPES,
  ];
  for (const token of required) {
    assert.equal(skill.includes(token), true, `SKILL.md omet ${token}`);
  }
});

test('conversion lance le CLI piecemaker', async () => {
  const calls = [];
  const deps = {
    execFn: async (args, cwd) => {
      calls.push({ args, cwd });
      return { code: 0, stdout: '{"result":{"documents":1}}', stderr: '' };
    },
  };
  const text = await run(['conversion', '--force', 'contrat.pdf', '--dossier', '/tmp/affaire'], { deps });
  assert.equal(text, '{"result":{"documents":1}}');
  assert.deepEqual(calls[0], {
    args: ['conversion', '--json', '--case', '/tmp/affaire', 'contrat.pdf', '--force'],
    cwd: '/tmp/affaire',
  });
});

test('raisonnement transmet la commande et le nom du raisonnement à reasoningFn', async () => {
  const calls = [];
  const panels = [];
  const deps = { reasoningFn: async (input) => { calls.push(input); return 'Raisonnement penalite'; }, openPanel: async (request) => { panels.push(request); return {}; } };
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-raisonnement-'));
  const result = await run(['raisonnement', 'verifier', '--raisonnement', 'penalite'], { cwd: dossier, deps });
  assert.equal(result, 'Raisonnement penalite\nVisible : Raisonnement.');
  assert.deepEqual(panels, [{ project: path.resolve(dossier), tab: 'plugin:piecemaker-raisonnement' }]);
  assert.deepEqual(calls[0], { commande: 'verifier', cwd: path.resolve(dossier), raisonnement: 'penalite' });
  await run(['raisonnement', 'lister'], { cwd: dossier, deps });
  assert.deepEqual(calls[1], { commande: 'lister', cwd: path.resolve(dossier) });
  await assert.rejects(run(['raisonnement', 'inconnue'], { cwd: dossier, deps }));
  await assert.rejects(run(['raisonnement', 'verifier', '--raisonnement'], { cwd: dossier, deps }));
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('suivi verifier transmet le dossier à suiviFn', async () => {
  const calls = [];
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-suivi-'));
  const deps = { suiviFn: async (input) => { calls.push(input); return 'Suivi du dossier'; } };
  assert.equal(await run(['suivi', 'verifier'], { cwd: dossier, deps }), 'Suivi du dossier');
  assert.deepEqual(calls, [{ commande: 'verifier', cwd: path.resolve(dossier) }]);
  await assert.rejects(run(['suivi', 'lister'], { cwd: dossier, deps }), (error) => error.exitCode === 2);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('sessionDossier suit la session plutôt que le répertoire courant', async () => {
  const lookup = async (id) => ({ 'claude-1': '/dossiers/Dupont', 'thread-1': '/dossiers/Exemple' })[id] ?? null;
  assert.equal(await sessionDossier('/ailleurs', { env: { PIECEMAKER_DOSSIER: '/dossiers/Vibe' }, lookup }), '/dossiers/Vibe');
  assert.equal(await sessionDossier('/ailleurs', { env: { CLAUDE_CODE_SESSION_ID: 'claude-1' }, lookup }), '/dossiers/Dupont');
  assert.equal(await sessionDossier('/ailleurs', { env: { CODEX_THREAD_ID: 'thread-1' }, lookup }), '/dossiers/Exemple');
  assert.equal(await sessionDossier('/ailleurs', { env: { CLAUDE_CODE_SESSION_ID: 'inconnue' }, lookup }), '/ailleurs');
  assert.equal(await sessionDossier('/ailleurs', { env: { CLAUDE_CODE_SESSION_ID: 'claude-1' }, lookup: async () => { throw new Error('hors ligne'); } }), '/ailleurs');
});
