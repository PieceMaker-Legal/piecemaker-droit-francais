import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import * as volets from '../../../mcp/piecemaker/volets.mjs';
import { CASSATION_MATIERES, COLUMN_FORMATS, PREMIERE_INSTANCE_TYPES, RESEARCH_SOURCES } from '../../../mcp/piecemaker/volets.mjs';
import { etatDossier, findVendor, parseArgv, run, sessionDossier } from './pm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('parseArgv sépare drapeaux, booléens et positionnels', () => {
  assert.deepEqual(parseArgv(['dossier', 'sql', 'SELECT 1', '--dossier', '/tmp']), {
    flags: { dossier: '/tmp' },
    positional: ['dossier', 'sql', 'SELECT 1'],
  });
  assert.deepEqual(parseArgv(['dossier', 'conversion', '--force', 'contrat.pdf']), {
    flags: { force: true },
    positional: ['dossier', 'conversion', 'contrat.pdf'],
  });
  assert.equal(parseArgv(['tabular_review', 'preparer', '--nom', '']).flags.nom, '');
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

test('les anciens noms renvoient Outil inconnu', async () => {
  for (const tool of ['conversion', 'sql', 'afficher', 'tabular_review_index', 'suivi']) {
    await assert.rejects(() => run([tool], { deps: {} }), (error) => error.exitCode === 2 && /Outil inconnu/.test(error.message));
  }
});

test('dossier sql passe par sqlFn et suit l’index après une écriture', async () => {
  const calls = [];
  const deps = {
    sqlFn: async (input) => {
      calls.push(input);
      return 'ok';
    },
    waitPanel: async () => true,
  };
  assert.equal(await run(['dossier', 'sql', 'SELECT label FROM piecemaker_nodes'], { deps }), 'ok');
  assert.deepEqual(calls[0], { requete: 'SELECT label FROM piecemaker_nodes', cwd: process.cwd() });
  const written = await run(['dossier', 'sql', "UPDATE piecemaker_nodes SET doc_date='2024-03-01' WHERE id='p:1'"], { deps });
  assert.match(written, /^ok\nDéjà visible : Dossier \(index\)\.\n?$/);
  await assert.rejects(() => run(['dossier', 'sql'], { deps }), /requête SQL/);
});

test('tab liste, ouvre et ferme chaque cible', async () => {
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
  assert.equal(await run(['tab', 'lister'], { deps }), 'Aucun volet ouvert à côté du chat.');
  assert.equal(await run(['tab', 'afficher', 'fichier', 'Actes/lettre.docx'], { deps }), 'Affiché dans le volet de lecture : Actes/lettre.docx');
  assert.equal(opened[0].tab, 'files');
  await assert.rejects(() => run(['tab', 'afficher', 'fichier', 'absent.docx'], { deps }), /introuvable/);
  assert.equal(await run(['tab', 'afficher', 'index'], { deps }), 'Volet affiché : index');
  assert.equal(opened[1].view, 'chronology');
  const tabs = { bordereau: 'plugin:piecemaker-tampon', raisonnement: 'plugin:piecemaker-raisonnement', suivi_dossiers: 'plugin:piecemaker-echeances' };
  for (const [cible, tab] of Object.entries(tabs)) {
    assert.equal(await run(['tab', 'afficher', cible], { deps }), `Volet affiché : ${cible}`);
    assert.equal(opened.at(-1).tab, tab);
  }
  await run(['tab', 'afficher', 'tabular_review', 'Tabular Review/analyse.json'], { deps });
  assert.equal(opened.at(-1).review, 'analyse.json');
  await assert.rejects(() => run(['tab', 'afficher', 'tampon'], { deps }), /Cible inconnue/);
  await assert.rejects(() => run(['tab', 'ouvrir'], { deps }), (error) => error.exitCode === 2);
});

test('tab fermer ferme le volet sans le rouvrir', async () => {
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
  assert.equal(await run(['tab', 'fermer', 'index'], { deps }), 'Fermé : index');
  assert.equal(closed[0].tab, 'plugin:piecemaker-dossier');
  assert.equal(await run(['tab', 'fermer', 'index'], { deps }), 'Déjà fermé : index');
});

test('bordereau tamponne dans l’ordre, liste les échecs et recharge le volet ouvert', async () => {
  const calls = [];
  const opened = [];
  const deps = {
    stampFn: async (body) => {
      calls.push(body);
      return {
        message: 'Tamponnage terminé : 1 pièce(s) traitée(s), 1 erreur(s).',
        results: [
          { pieceNumber: 1, filename: 'contrat.pdf', success: true },
          { pieceNumber: 2, filename: 'absent.pdf', success: false, error: 'Fichier introuvable : absent.pdf' },
        ],
      };
    },
    waitPanel: async () => true,
    openPanel: async (body) => {
      opened.push(body);
      return { id: '1' };
    },
  };
  const output = await run(['bordereau', 'contrat.pdf', 'absent.pdf'], { deps });
  assert.deepEqual(calls[0], { folder: process.cwd(), pieces: ['contrat.pdf', 'absent.pdf'] });
  assert.match(output, /^Pièce n°1 : contrat\.pdf\nPièce n°2 : ÉCHEC, Fichier introuvable : absent\.pdf\n/);
  assert.match(output, /Déjà visible : Bordereau\./);
  assert.deepEqual(opened, [{ project: process.cwd(), tab: 'plugin:piecemaker-tampon' }]);
  await assert.rejects(() => run(['bordereau'], { deps }), /Indiquez les pièces/);
});

test('tabular_review transmet les actions et refuse les actions retirées', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-skill-tr-'));
  const calls = [];
  const opened = [];
  const deps = {
    refuseIndex: volets.refuseIndex,
    waitPanel: async () => opened.length > 0,
    openPanel: async () => {
      opened.push(true);
      return { id: '1' };
    },
    tabularFn: async (input) => {
      calls.push(input);
      if (input.action === 'create_template') return { id: 'm-1', nom: 'Baux' };
      return { projet: 'p-1' };
    },
  };
  const prepared = await run([
    'tabular_review', 'preparer', '--dossier', dossier, '--mode', 'recherche', '--nom', 'Faute grave',
    '--recherche', '{"query":"faute","sources":["cassation"]}',
  ], { deps });
  assert.match(prepared, /"projet":"p-1"/);
  assert.match(prepared, /visible : Analyse tabulaire/i);
  assert.deepEqual(calls.find((call) => call.action === 'preparer').recherche, { query: 'faute', sources: ['cassation'] });
  assert.equal(await run(['tabular_review', 'create_template', '--nom', 'Baux', '--questions', '[]', '--dossier', dossier], { deps }), '{"id":"m-1","nom":"Baux"}');
  for (const action of ['ouvrir', 'documents', 'enregistrer_modele', 'classement']) {
    await assert.rejects(() => run(['tabular_review', action, '--dossier', dossier], { deps }), /action connue/);
  }
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('dossier index garde l’index dans l’onglet Dossier, crée ou relance', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-skill-index-'));
  const calls = [];
  const opened = [];
  let found = { projet: 'p-index' };
  const deps = {
    tabularIndex: volets.tabularIndex,
    refuseIndex: volets.refuseIndex,
    waitPanel: async () => opened.length > 0,
    openPanel: async (body) => {
      opened.push(body);
      return { id: '1' };
    },
    tabularFn: async (input) => {
      calls.push(input);
      if (input.action === 'index') return found;
      if (input.action === 'lister') return { analyses: [{ fichier: 'index.json', index: true }] };
      return { ok: true };
    },
  };
  await assert.rejects(() => run(['dossier', 'index', 'lire', '--dossier', dossier], { deps }), /pm dossier index lancer/);
  await run(['dossier', 'index', 'lancer', '--ia', 'mistral', '--dossier', dossier], { deps });
  assert.deepEqual(calls.filter((call) => call.action !== 'index').map((call) => [call.action, call.projet, call.ia]), [['preparer', 'p-index', 'mistral'], ['lancer', 'p-index', 'mistral']]);
  found = { fichier: 'index.json', absentes: 2 };
  await run(['dossier', 'index', 'lancer', '--dossier', dossier], { deps });
  assert.deepEqual([calls.at(-1).action, calls.at(-1).fichier], ['relancer', 'index.json']);
  const read = await run(['dossier', 'index', 'lire', '--dossier', dossier], { deps });
  assert.equal(calls.at(-1).fichier, 'index.json');
  assert.equal(opened[0].tab, 'plugin:piecemaker-dossier');
  assert.equal(opened[0].view, 'chronology');
  assert.match(read, /visible : Dossier \(index\)\./i);
  for (const action of ['preparer', 'relancer', 'ouvrir', 'classement', 'lister', 'modifier']) {
    await assert.rejects(() => run(['dossier', 'index', action, '--dossier', dossier], { deps }), (error) => error.exitCode === 2);
  }
  await assert.rejects(() => run(['tabular_review', 'relancer', '--fichier', 'Tabular Review/index.json', '--dossier', dossier], { deps }), /pm dossier index/);
  await run(['dossier', 'arborescence', '--dossiers', '[{"nom":"Contrats","explication":"Baux"}]', '--dossier', dossier], { deps });
  assert.deepEqual(calls.at(-1), { action: 'arborescence', project: dossier, dossiers: [{ nom: 'Contrats', explication: 'Baux' }] });
  await assert.rejects(() => run(['dossier', 'arborescence', '--dossier', dossier], { deps }), /--dossiers/);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('dossier verifier résume anonymisation, mapping, index et conversion', async () => {
  const deps = {
    caseState: () => ({ anonymized: true, lifted: false }),
    tabularFn: async ({ action }) => (action === 'lister' ? { analyses: [{ fichier: 'index.json', index: true }] } : { fichier: 'index.json', absentes: 2 }),
    piecesFn: async () => ({ pieces: [{ path: 'Pièces/bail.pdf', status: 'ready' }, { path: 'Pièces/lettre.pdf', status: 'conversion-failed' }] }),
    conversionJob: async () => ({ job: null }),
  };
  assert.equal(await run(['dossier', 'verifier', '--dossier', '/dossiers/Dupont'], { deps }), [
    'Anonymisation : faite',
    'Mapping : à valider par l’avocat (onglet Dossier, Mapping)',
    'Index : 2 pièce(s) absente(s) de l’index : pm dossier index lancer',
    'Conversion : 1 pièce(s) non convertie(s) : pm dossier conversion',
    '  - Pièces/lettre.pdf (échec)',
  ].join('\n'));
  const fresh = {
    ...deps,
    caseState: () => ({ anonymized: false, lifted: true }),
    tabularFn: async () => ({ analyses: [], projets: [] }),
    conversionJob: async () => ({ job: { state: 'running', phase: 'convert', percent: 40, processed: 2, total: 5 } }),
  };
  assert.equal(await run(['dossier', 'verifier', '--dossier', '/dossiers/Dupont'], { deps: fresh }), [
    'Anonymisation : levée par l’avocat (pièces lisibles par l’IA)',
    'Mapping : sans objet (anonymisation levée)',
    'Index : absent : pm dossier index lancer',
    'Conversion : Conversion en cours : phase convert, 40 %, 2/5 pièce(s).',
  ].join('\n'));
});

test('etatDossier est prêt quand mapping validé, index à jour et pièces converties', async () => {
  const deps = {
    caseState: () => ({ anonymized: true, lifted: false }),
    mappingValidated: () => true,
    tabularFn: async ({ action }) => (action === 'lister' ? { analyses: [{ fichier: 'index.json', index: true }] } : { fichier: 'index.json', absentes: 0 }),
    piecesFn: async () => ({ pieces: [{ path: 'Pièces/bail.pdf', status: 'ready' }] }),
    conversionJob: async () => ({ job: null }),
  };
  assert.equal((await etatDossier('/dossiers/Dupont', { deps })).pret, true);
  const etat = await etatDossier('/dossiers/Dupont', { deps: { ...deps, mappingValidated: () => false } });
  assert.equal(etat.pret, false);
  assert.deepEqual(etat.lignes.filter((ligne) => !ligne.ok).map((ligne) => ligne.nom), ['mapping']);
});

test('dossier conversion lance le CLI, ou renvoie l’avancée d’un travail en cours', async () => {
  const calls = [];
  let job = null;
  const deps = {
    conversionJob: async () => ({ job }),
    execFn: async (args, cwd) => {
      calls.push({ args, cwd });
      return { code: 0, stdout: '{"result":{"documents":1}}', stderr: '' };
    },
  };
  const text = await run(['dossier', 'conversion', '--force', 'contrat.pdf', '--dossier', '/tmp/affaire'], { deps });
  assert.equal(text, '{"result":{"documents":1}}');
  assert.deepEqual(calls[0], { args: ['conversion', '--json', '--case', '/tmp/affaire', 'contrat.pdf', '--force'], cwd: '/tmp/affaire' });
  job = { state: 'running', phase: 'convert', percent: 40, processed: 2, total: 5 };
  assert.equal(await run(['dossier', 'conversion', '--dossier', '/tmp/affaire'], { deps }), 'Conversion en cours : phase convert, 40 %, 2/5 pièce(s).\nRelancez pm dossier conversion pour suivre.');
  assert.equal(calls.length, 1);
});

test('dossier conversion rend la main après le délai d’attente', async () => {
  let aborted = false;
  let job = null;
  const deps = {
    conversionWaitMs: 20,
    conversionJob: async () => ({ job }),
    execFn: (args, cwd, signal) => new Promise((resolve) => {
      job = { state: 'running', phase: 'anonymize', percent: 70, processed: 7, total: 10 };
      signal.addEventListener('abort', () => { aborted = true; resolve({ code: 1, stdout: '', stderr: '' }); });
    }),
  };
  const text = await run(['dossier', 'conversion', '--dossier', '/tmp/affaire'], { deps });
  assert.equal(aborted, true);
  assert.equal(text, 'Conversion en cours : phase anonymize, 70 %, 7/10 pièce(s).\nLe travail continue dans PieceMaker : relancez pm dossier conversion pour suivre.');
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
  await assert.rejects(run(['raisonnement', 'consignes'], { cwd: dossier, deps }), (error) => error.exitCode === 2);
  await assert.rejects(run(['raisonnement', 'verifier', '--raisonnement'], { cwd: dossier, deps }));
  assert.equal(calls.length, 2);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('suivi_dossiers verifier, lire et ecrire passent par suiviFn', async () => {
  const calls = [];
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-suivi-'));
  const deps = { suiviFn: async (input) => { calls.push(input); return 'Suivi du dossier'; } };
  assert.equal(await run(['suivi_dossiers', 'verifier'], { cwd: dossier, deps }), 'Suivi du dossier');
  assert.deepEqual(calls, [{ commande: 'verifier', cwd: path.resolve(dossier) }]);
  await run(['suivi_dossiers', 'verifier', '--suivi', 'appel-suivi.json'], { cwd: dossier, deps });
  assert.deepEqual(calls.pop(), { commande: 'verifier', cwd: path.resolve(dossier), suivi: 'appel-suivi.json' });
  await assert.rejects(run(['suivi_dossiers', 'verifier', '--suivi'], { cwd: dossier, deps }), (error) => error.exitCode === 2);
  await run(['suivi_dossiers', 'lire', 'projects/cabinet/requests'], { cwd: dossier, deps });
  assert.deepEqual(calls[1], { commande: 'lire', chemin: 'projects/cabinet/requests', cwd: path.resolve(dossier) });
  await run(['suivi_dossiers', 'ecrire', 'projects/cabinet/requests/r1', '--json', '{"status":"done"}'], { cwd: dossier, deps });
  assert.deepEqual(calls[2], { commande: 'ecrire', chemin: 'projects/cabinet/requests/r1', donnees: { status: 'done' }, cwd: path.resolve(dossier) });
  await assert.rejects(run(['suivi_dossiers', 'ecrire', 'projects/cabinet/requests/r1'], { cwd: dossier, deps }), (error) => error.exitCode === 2);
  await assert.rejects(run(['suivi_dossiers', 'lister'], { cwd: dossier, deps }), (error) => error.exitCode === 2);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('SKILL.md documente toute la surface d’interface', () => {
  const references = path.join(HERE, '..', 'references');
  const skill = [path.join(HERE, '..', 'SKILL.md'), ...fs.readdirSync(references).map((name) => path.join(references, name))]
    .map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const required = [
    'pm tab', 'pm dossier', 'pm tabular_review', 'pm bordereau', 'pm raisonnement', 'pm suivi_dossiers',
    'lister', 'afficher', 'fermer', 'verifier', 'sql', 'conversion', 'arborescence', 'index', 'lire', 'ecrire',
    'dossier', 'tabular_review', 'bordereau', 'raisonnement', 'suivi_dossiers', 'fichier',
    '--force', '--dossier', '--dossiers', '--raisonnement', '--suivi', '--json',
    'Visible',
    'modeles', 'create_template', 'preparer', 'lancer', 'colonnes', 'relancer',
    '--fichier', '--projet', '--mode', '--nom', '--modele', '--description', '--questions',
    '--documents', '--recherche', '--ia', '--modele-ia',
    'analyse', 'recherche', 'claude', 'codex', 'mistral',
    'publicationBulletin', 'publicationConseilEtat', 'publicationCaa',
    'typesPremiereInstance', 'dateDebut', 'dateFin', 'dispositifOnly',
    'TOUS', 'PUBLIE', 'INEDIT', 'NON_PUBLIE',
    ...COLUMN_FORMATS, ...RESEARCH_SOURCES, ...CASSATION_MATIERES, ...PREMIERE_INSTANCE_TYPES,
  ];
  for (const token of required) {
    assert.equal(skill.includes(token), true, `SKILL.md omet ${token}`);
  }
});

test('sessionDossier suit la session plutôt que le répertoire courant', async () => {
  const lookup = async (id) => ({ 'claude-1': '/dossiers/Dupont', 'thread-1': '/dossiers/Exemple' })[id] ?? null;
  assert.equal(await sessionDossier('/ailleurs', { env: { PIECEMAKER_DOSSIER: '/dossiers/Vibe' }, lookup }), '/dossiers/Vibe');
  assert.equal(await sessionDossier('/ailleurs', { env: { CLAUDE_CODE_SESSION_ID: 'claude-1' }, lookup }), '/dossiers/Dupont');
  assert.equal(await sessionDossier('/ailleurs', { env: { CODEX_THREAD_ID: 'thread-1' }, lookup }), '/dossiers/Exemple');
  assert.equal(await sessionDossier('/ailleurs', { env: { CLAUDE_CODE_SESSION_ID: 'inconnue' }, lookup }), '/ailleurs');
  assert.equal(await sessionDossier('/ailleurs', { env: { CLAUDE_CODE_SESSION_ID: 'claude-1' }, lookup: async () => { throw new Error('hors ligne'); } }), '/ailleurs');
});
