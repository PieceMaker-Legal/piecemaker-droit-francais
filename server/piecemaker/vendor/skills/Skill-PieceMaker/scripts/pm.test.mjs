import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

test('dossier sql n’attend ni n’avertit quand aucune interface n’est ouverte sur le dossier', async () => {
  const update = "UPDATE piecemaker_nodes SET doc_date='2024-03-01' WHERE id='p:1'";
  const deps = (listening) => ({
    sqlFn: async () => 'ok',
    waitPanel: async () => false,
    panelCompleted: async () => false,
    openPanel: async () => ({ id: '1', listening }),
    openPanelsTimeoutMs: 300,
  });
  const started = Date.now();
  assert.equal(await run(['dossier', 'sql', update], { deps: deps(false) }), 'ok');
  assert.ok(Date.now() - started < 250);
  assert.match(await run(['dossier', 'sql', update], { deps: deps(true) }), /Le volet n’a pas suivi/);
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
  const tabs = { bordereau: 'plugin:piecemaker-tampon', suivi_dossiers: 'plugin:piecemaker-echeances', catala: 'plugin:piecemaker-catala' };
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
  assert.equal(opened[0].view, 'index-analysis');
  assert.match(read, /visible : Dossier \(analyse tabulaire de l’index\)\./i);
  for (const action of ['preparer', 'relancer', 'ouvrir', 'classement', 'lister', 'modifier']) {
    await assert.rejects(() => run(['dossier', 'index', action, '--dossier', dossier], { deps }), (error) => error.exitCode === 2);
  }
  await assert.rejects(() => run(['tabular_review', 'relancer', '--fichier', 'Tabular Review/index.json', '--dossier', dossier], { deps }), /pm dossier index/);
  await run(['dossier', 'arborescence', '--dossiers', '[{"nom":"Contrats","explication":"Baux"}]', '--dossier', dossier], { deps });
  assert.deepEqual(calls.at(-1), { action: 'arborescence', project: dossier, dossiers: [{ nom: 'Contrats', explication: 'Baux' }] });
  await run(['dossier', 'arborescence', '--dossiers', '[{"nom":"Contrats"}]', '--motif', 'Regrouper les baux', '--dossier', dossier], { deps });
  assert.deepEqual(calls.at(-1), { action: 'arborescence', project: dossier, dossiers: [{ nom: 'Contrats' }], motif: 'Regrouper les baux' });
  await run(['dossier', 'arborescence', '--dossier', dossier], { deps });
  assert.deepEqual(calls.at(-1), { action: 'arborescence', project: dossier });
  fs.mkdirSync(path.join(dossier, '.piecemaker'), { recursive: true });
  fs.writeFileSync(path.join(dossier, '.piecemaker', 'arborescence.json'), '[{"name":"Pièces"}]');
  const moves = [];
  deps.moveFn = async (input) => { moves.push(input); return { previous: 'Note.docx', current: 'Pièces/Note.docx' }; };
  assert.match(await run(['dossier', 'classer', 'Note.docx', 'Pièces', '--dossier', dossier], { deps }), /^Classé : Note\.docx → Pièces\/Note\.docx/);
  assert.deepEqual(moves, [{ folder: dossier, path: 'Note.docx', directory: 'Pièces' }]);
  await assert.rejects(() => run(['dossier', 'classer', 'Note.docx', 'Brouillons', '--dossier', dossier], { deps }), (error) => error.exitCode === 2 && /Pièces/.test(error.message));
  assert.equal(moves.length, 1);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('check numérote préparation, index, raisonnements reliés par leur nom et recherches', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-check-'));
  const write = (relative, content) => { fs.mkdirSync(path.dirname(path.join(dossier, relative)), { recursive: true }); fs.writeFileSync(path.join(dossier, relative), content); };
  write('.piecemaker/catala/rupture/clerk.toml', '');
  write('.piecemaker/catala/rupture/rupture.catala_fr', '');
  write('.piecemaker/catala/bail/clerk.toml', '');
  write('.piecemaker/catala/bail/resultats/verification.json', '{"passed":true}');
  const later = new Date(Date.now() + 60000);
  fs.utimesSync(path.join(dossier, '.piecemaker/catala/bail/resultats/verification.json'), later, later);
  write('.piecemaker/rupture-suivi.json', '{}');
  write('.piecemaker/suivi.json', '{}');
  write('Projets/conclusions.docx', '');
  write('.piecemaker/etapes.json', JSON.stringify({ raisonnements: {
    ancien: { etape: 'raisonnement', remplacePar: 'rupture' },
    rupture: { etape: 'redaction', precedent: 'ancien', documents: [
      { type: 'Conclusions', nom: 'Conclusions en défense', chemin: 'Projets/conclusions.docx' },
      { type: 'Lettre', nom: 'Lettre fictive', chemin: 'Projets/lettre.docx', valide: true },
      { type: 'Assignation', nom: 'Assignation fictive', chemin: 'Projets/assignation.docx' },
    ] },
  } }));
  const calls = [];
  const deps = {
    caseState: () => ({ anonymized: true, lifted: false }),
    mappingValidated: () => true,
    tabularFn: async ({ action }) => (action === 'lister'
      ? { analyses: [], projets: [{ projet: 'p1', nom: 'Rupture fictive', mode: 'recherche', erreur: 'Recherche trop large.' }, { projet: 'p2', nom: 'Index', index: true }] }
      : { absentes: 3 }),
    piecesFn: async () => ({ pieces: [{ path: 'Pièces/bail.pdf', status: 'ready', protected: true }] }),
    conversionJob: async () => ({ job: null }),
    okfFn: async (input) => { calls.push(input); return {
      erreurs: [{ fiche: 'Pièces/bail.md', erreur: 'lien sans citation' }, { fiche: '/Note.docx.md', erreur: 'type « Non classé » hors arborescence (Pièces)' }],
      contradictions: [],
      manques: [{ element: '/_premises/date-de-rupture.md', manque: 'prémisse sans valeur', programmes: ['rupture'] }, { element: 'Pièces/avenant.md', manque: 'pièce sans prémisse ni lien' }],
    }; },
    suiviFn: async ({ suivi }) => (suivi === 'suivi.json' ? '0 erreur(s), 0 manque(s).'
      : `Suivi du dossier (.piecemaker/${suivi})\nÉchéances :\n  02/01/2026 — Conclusions (conclusions) — DÉPASSÉE\n  01/06/2027 — Audience (audience) — à venir\n\n1 erreur(s), 0 manque(s).`),
  };
  const text = await run(['check', '--dossier', dossier], { deps });
  assert.deepEqual(calls, [{ action: 'verify', folder: dossier }]);
  assert.equal(text, [
    'Dossier : 8 point(s) à traiter.',
    '1° Conversion : valide',
    '2° Anonymisation : valide',
    '3° Mapping : valide',
    '4° Index : attribuer un type à Note.docx : pm dossier classer <document> <dossier> (dossiers : pm dossier arborescence), 1 erreur(s), 1 manque(s) → pm okf verify',
    '5° Raisonnement',
    '  5.A bail',
    '    5.A.1 Programme Catala (.piecemaker/catala/bail/) : valide',
    '    5.A.2 Prémisses OKF du programme : aucune → skill okf',
    '  5.B rupture (rédaction)',
    '    5.B.1 Programme Catala (.piecemaker/catala/rupture/) : jamais vérifié → pm catala verifier --programme rupture',
    '    5.B.2 Prémisses OKF du programme : 1 manque(s) → pm okf verify',
    '    5.B.3 Conclusions en défense : en cours de rédaction',
    '    5.B.4 Lettre fictive : validé',
    '    5.B.5 Assignation fictive : à rédiger',
    '    5.B.6 Suivi : 1 erreur(s), 0 manque(s), 1 échéance(s) dépassée(s), du jour ou sans date → pm suivi_dossiers verifier --suivi rupture-suivi.json',
    '6° Recherche « Rupture fictive » : bloquée → pm tabular_review lister',
    '7° Suivi suivi.json : valide',
  ].join('\n'));
  assert.doesNotMatch(text, /ancien|yaml/i);
  write('.piecemaker/catala/bail/bail.catala_fr', '## okf:/_premises/date-du-bail.md\n');
  write('.piecemaker/okf/_premises/date-du-bail.md', '');
  assert.match(await run(['check', '--dossier', dossier], { deps }), /5\.A\.2 Prémisses OKF du programme : valide/);
  write('.piecemaker/catala/bail/bail.catala_fr', [
    'déclaration champ d\'application Bail:',
    '  contexte bail_signé condition',
    '  contexte congé_donné condition',
    '  contexte loyer_impayé condition',
    '  contexte caution_versée condition',
    '  contexte loyer contenu argent',
  ].join('\n'));
  write('.piecemaker/catala/bail/test_bail.catala_fr', [
    'champ d\'application Exemple:',
    '  ## okf:/_premises/date-du-bail.md',
    '  règle calcul.bail_signé rempli',
    '  ## okf:/_premises/fiche-absente.md',
    '  règle calcul.congé_donné rempli',
    '  règle calcul.loyer_impayé rempli',
    '  règle calcul.caution_versée non rempli',
  ].join('\n'));
  assert.match(await run(['check', '--dossier', dossier], { deps }), /5\.A\.2 Prémisses OKF du programme : 3 entrée\(s\) sans prémisse : loyer, congé_donné, loyer_impayé → pm catala verifier --programme bail\n/);
  await assert.rejects(() => run(['dossier', 'verifier', '--dossier', dossier], { deps }), /dossier attend/);
  await assert.rejects(() => run(['okf', 'verify-graph', '--dossier', dossier], { deps }), /okf attend/);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('tabular_review verifier signale seulement les recherches bloquées', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-revue-'));
  const projets = [{ projet: 'p1', nom: 'Rupture fictive', mode: 'recherche', a_completer: ['questions'] }, { projet: 'p2', nom: 'Autre', mode: 'recherche' }, { projet: 'p3', nom: 'Index', index: true }];
  const verify = (liste) => run(['tabular_review', 'verifier', '--dossier', dossier], { deps: { tabularFn: async () => ({ analyses: [], projets: liste }) } });
  assert.equal(await verify(projets), 'Recherche « Rupture fictive » : bloquée → pm tabular_review lister');
  assert.equal(await verify(projets.slice(1)), '');
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('check sur un dossier à jour ne signale rien', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-check-'));
  const deps = {
    caseState: () => ({ anonymized: true, lifted: false }),
    mappingValidated: () => true,
    tabularFn: async ({ action }) => (action === 'lister' ? { analyses: [], projets: [] } : {}),
    piecesFn: async () => ({ pieces: [] }),
    conversionJob: async () => ({ job: null }),
    okfFn: async () => ({ erreurs: [], contradictions: [], manques: [] }),
    suiviFn: async () => { throw new Error('inattendu'); },
  };
  assert.equal(await run(['check', '--dossier', dossier], { deps }), [
    'Dossier : valide.',
    '1° Conversion : valide',
    '2° Anonymisation : valide',
    '3° Mapping : valide',
    '4° Index : valide',
    '5° Raisonnement : aucun',
  ].join('\n'));
  const pending = { ...deps, mappingValidated: () => false, piecesFn: async () => ({ pieces: [{ path: 'Pièces/lettre.pdf', status: 'conversion-failed', protected: true }] }) };
  assert.equal((await run(['check', '--dossier', dossier], { deps: pending })).split('\n').slice(0, 4).join('\n'), [
    'Dossier : 2 point(s) à traiter.',
    '1° Conversion : 1 pièce(s) non convertie(s) : pm dossier conversion',
    '2° Anonymisation : valide',
    '3° Mapping : à valider par l’avocat (onglet Dossier, Mapping)',
  ].join('\n'));
  const copie = { ...deps, entityCount: async () => 0 };
  assert.equal((await run(['check', '--dossier', dossier], { deps: copie })).split('\n').slice(0, 3).join('\n'), [
    'Dossier : 1 point(s) à traiter.',
    '1° Conversion : valide',
    '2° Anonymisation : à refaire, aucune entité ni mapping en base pour ce dossier : pm dossier conversion',
  ].join('\n'));
  const scan = { ...deps, caseState: () => ({ anonymized: false, lifted: false }), conversionJob: async () => ({ job: { state: 'running', phase: 'scan', percent: 27.25, processed: 8, total: 216 } }) };
  assert.equal((await run(['check', '--dossier', dossier], { deps: scan })).split('\n').slice(1, 3).join('\n'), [
    '1° Conversion : Conversion en cours : phase scan, 8/216 (avancement global 27 %). Ne bouclez pas sur pm dossier conversion : traitez d’abord Catala et suivi, qui ne lisent pas les pièces.',
    '2° Anonymisation : en cours, voir 1°',
  ].join('\n'));
  const parties = { ...deps, okfFn: async () => ({ erreurs: [], contradictions: [], manques: [
    { element: '/_premises/date-de-rupture.md', manque: 'prémisse sans partie concernée (involves) : attend l’avocat', avocat: true },
    { element: 'Pièces/avenant.md', manque: 'pièce à examiner' },
  ] }) };
  assert.equal((await run(['check', '--dossier', dossier], { deps: parties })).split('\n')[4], '4° Index : 1 manque(s), 1 manque(s) en attente de l’avocat (parties à qualifier, onglet Dossier) → pm okf verify');
  fs.rmSync(dossier, { recursive: true, force: true });
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
  assert.equal(calls.length, 1);
});

const ARRIERE_PLAN = 'Le travail continue en arrière-plan dans PieceMaker. Ne relancez pas cette commande en boucle.\n'
  + 'Traitez maintenant les points qui ne lisent pas les pièces : programme Catala et suivi.\n'
  + 'L’index et les prémisses attendent la fin du scan : il écrit les fiches OKF et pseudonymise les pièces.\n'
  + 'Revenez à la fin avec pm dossier conversion.';

test('dossier conversion attend un travail déjà en cours sans relancer le CLI', async () => {
  let reads = 0;
  const job = { state: 'running', phase: 'scan', percent: 27.25, processed: 8, total: 216 };
  const execFn = async () => { throw new Error('inattendu'); };
  const running = { conversionWaitMs: 30, conversionPollMs: 5, execFn, conversionJob: async () => ({ job }) };
  assert.equal(await run(['dossier', 'conversion', '--dossier', '/tmp/affaire'], { deps: running }), `Conversion en cours : phase scan, 8/216 (avancement global 27 %).\n${ARRIERE_PLAN}`);
  const ending = { ...running, conversionWaitMs: 1000, conversionJob: async () => ({ job: reads++ < 2 ? job : { ...job, state: 'done' } }) };
  assert.equal(await run(['dossier', 'conversion', '--dossier', '/tmp/affaire'], { deps: ending }), 'Conversion terminée. Lancez pm check.');
});

test('pm sous Codex n’affiche pas l’avertissement NO_COLOR et FORCE_COLOR', () => {
  const hook = `data:text/javascript,${encodeURIComponent("process.once('beforeExit', () => console.error({ couleur: 1 }))")}`;
  const result = spawnSync(process.execPath, ['--import', hook, fileURLToPath(new URL('./pm.mjs', import.meta.url)), '--help'], { env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '1' }, encoding: 'utf8' });
  assert.doesNotMatch(result.stderr, /NO_COLOR/);
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
  assert.equal(text, `Conversion en cours : phase anonymize, 7/10 (avancement global 70 %).\n${ARRIERE_PLAN}`);
});

test('SKILL.md documente toute la surface d’interface', () => {
  const references = path.join(HERE, '..', 'references');
  const skill = [path.join(HERE, '..', 'SKILL.md'), ...fs.readdirSync(references).map((name) => path.join(references, name))]
    .map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const required = [
    'pm tab', 'pm dossier', 'pm tabular_review', 'pm bordereau', 'pm suivi_dossiers', 'pm okf', 'link', 'unlink', 'examinee', '--motif', '--retirer', '--citation',
    'lister', 'afficher', 'fermer', 'verifier', 'sql', 'conversion', 'arborescence', 'index', 'lire', 'ecrire',
    'dossier', 'tabular_review', 'bordereau', 'suivi_dossiers', 'fichier',
    '--force', '--dossier', '--dossiers', '--suivi', '--json',
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


test('okf types propose la liste complète à l’avocat', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-types-'));
  const calls = [];
  const documentTypes = [{ name: 'contrat', icon: 'pen' }];
  const result = await run(['okf', 'types', '--json', JSON.stringify(documentTypes)], { cwd: dossier, deps: {
    okfFn: async (input) => { calls.push(input); return { documentTypes, motif: '', date: '' }; },
  } });
  assert.deepEqual(calls, [{ action: 'proposer', folder: path.resolve(dossier), ontologie: { documentTypes } }]);
  assert.match(result, /Proposition enregistrée \(1 type\(s\) de documents\)/);
  assert.equal(await run(['okf', 'types', '--json', '[]'], { cwd: dossier, deps: { okfFn: async () => ({ motif: '', date: '' }) } }), 'Aucun changement par rapport à l’ontologie actuelle : aucune proposition en attente.');
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('memoire verifier refuse le frontmatter et exige un acte du même nom', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-memoire-'));
  const write = (relative, content) => { fs.mkdirSync(path.dirname(path.join(dossier, relative)), { recursive: true }); fs.writeFileSync(path.join(dossier, relative), content); };
  const verify = (...args) => run(['memoire', 'verifier', ...args, '--dossier', dossier], { deps: {} });
  write('.piecemaker/memoires/appel.md', '# Appel Jean Dupont\n\nL’avocat veut contester la date de signification.\n');
  write('.piecemaker/appel-suivi.json', '{}');
  write('.piecemaker/memoires/bail.md', '---\nechéances: []\n---\n# Bail Société Exemple SAS\n');
  write('.piecemaker/etapes.json', JSON.stringify({ raisonnements: { bail: { etape: 'redaction' } } }));
  write('.piecemaker/memoires/divers.md', 'Notes.\n');
  assert.equal(await verify('--memoire', 'appel'), '');
  assert.match(await verify('--memoire', 'bail'), /^\.piecemaker\/memoires\/bail\.md:1: erreur : pas de frontmatter\. Les échéances vont dans \.piecemaker\/bail-suivi\.json/);
  assert.equal((await verify()).split('\n').length, 2);
  assert.match(await verify(), /divers\.md : manque : aucun programme Catala, suivi ni carte du tableau ne s’appelle divers/);
  assert.equal(await verify('--memoire', 'absente'), '.piecemaker/memoires/absente.md : introuvable.');
  await assert.rejects(() => verify('--memoire'), /--memoire/);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('pm catala section transmet fichier, source, extrait et titre au wrapper Catala', async () => {
  const seen = [];
  const deps = { catalaFn: async (input) => { seen.push(input); return 'Section ajoutée'; }, catalaUpdated: async () => { throw new Error('volet'); } };
  assert.equal(await run(['catala', 'section', '--fichier', 'prime.catala_fr', '--source', 'LEGIARTI000000000001', '--extrait', 'Texte fictif', '--titre', 'Article 1', '--dossier', '/tmp/dossier'], { deps }), 'Section ajoutée');
  assert.deepEqual(seen[0].flags, { fichier: 'prime.catala_fr', source: 'LEGIARTI000000000001', extrait: 'Texte fictif', titre: 'Article 1', dossier: '/tmp/dossier' });
  assert.match((await run(['--help'], { deps })) ?? '', /catala section --fichier F --source ID --extrait/);
});
