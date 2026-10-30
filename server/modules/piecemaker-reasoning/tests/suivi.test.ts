import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';
import { parse } from 'yaml';

import { closed, shift } from '../calendar.js';
import type { ReasoningConnectors, SourceInfo } from '../program.js';
import { createBoardService, dossierMatterId } from '../suivi-board.js';
import { createSuiviService } from '../suivi-service.js';
import { mentionsDate, suiviDateId, verifySuivi } from '../suivi.js';

const SOURCES: Record<string, SourceInfo> = {
  LEGIARTI000000000101: { kind: 'texte', title: 'Code fictif, article 10', text: 'Le délai pour former appel est d’un mois à compter de la signification du jugement.', validity: { from: '2000-01-01', to: null } },
  LEGIARTI000000000102: { kind: 'texte', title: 'Code fictif, article 11', text: 'Le délai qui expirerait un samedi, un dimanche ou un jour férié est prorogé jusqu’au premier jour ouvrable suivant. Le jour de l’acte ne compte pas.', validity: { from: '2000-01-01', to: null } },
  LEGIARTI000000000103: { kind: 'texte', title: 'Code fictif, article 12', text: 'Ancienne rédaction abrogée.', validity: { from: '1990-01-01', to: '2010-01-01' } },
  'pieces/03_signification.md': { kind: 'piece', title: '03 Signification', text: 'Acte signifié le 14 octobre 2026 à Jean Dupont, demeurant 12 rue des Lilas, Paris.' },
  'pieces/01_contrat.md': { kind: 'piece', title: '01 Contrat', text: 'Fait le 15/01/2024. Le contrat est conclu pour une durée de trois ans. Il se renouvelle tacitement sauf dénonciation trois mois avant son terme, le terme se décomptant de date à date.' },
  'pieces/04_courrier.md': { kind: 'piece', title: '04 Courrier', text: 'Courrier de Société Exemple SAS du 2 mars 2026 relatif aux livraisons.' },
};

const plain = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const connectors: ReasoningConnectors = {
  source: async (_cwd, id) => (/^(LEGIARTI|JURITEXT)\d+$/.test(id) || id.includes('/') ? SOURCES[id] ?? null : undefined),
  match: (text, excerpt) => (text.includes(excerpt) ? excerpt : new RegExp(plain(excerpt).split(' ').join('[^\\p{L}\\p{N}]+'), 'iu').exec(text)?.[0] ?? null),
  registry: async () => ({ found: true, status: 'active' }),
  bodacc: async () => [],
};

const CONTENTIEUX = `evenements:
  signification_du_jugement:
    date: 2026-10-14
    preuve:
      - piece: pieces/03_signification.md
        citation: Acte signifié le 14 octobre 2026
echeances:
  appel:
    intitule: Interjeter appel
    de: signification_du_jugement
    delai:
      mois: 1
    selon:
      - source: LEGIARTI000000000101
        citation: Le délai pour former appel est d’un mois
    decompte:
      depart: exclu
      report: jour_ouvrable_suivant
      selon:
        - source: LEGIARTI000000000102
          citation: prorogé jusqu’au premier jour ouvrable suivant
`;

const CONTRAT = `evenements:
  signature_du_contrat:
    date: 2024-01-15
    preuve:
      - piece: pieces/01_contrat.md
        citation: Fait le 15/01/2024
echeances:
  fin_de_la_duree_initiale:
    intitule: Terme de la durée initiale
    de: signature_du_contrat
    delai:
      ans: 3
    selon:
      - source: pieces/01_contrat.md
        citation: conclu pour une durée de trois ans
    decompte:
      depart: exclu
      report: aucun
      selon:
        - source: pieces/01_contrat.md
          citation: le terme se décomptant de date à date
  denonciation:
    intitule: Dénoncer le contrat pour éviter la reconduction
    avant: fin_de_la_duree_initiale
    delai:
      mois: 3
    selon:
      - source: pieces/01_contrat.md
        citation: sauf dénonciation trois mois avant son terme
    decompte:
      depart: exclu
      report: jour_ouvrable_precedent
      selon:
        - source: pieces/01_contrat.md
          citation: le terme se décomptant de date à date
`;

const toJson = (fixture: string) => JSON.stringify(parse(fixture), null, 2);
const verifyRaw = (code: string, options: { today?: string; marks?: Map<string, { date: string; piece: string | null; at: string }>; reliability?: Map<string, boolean> } = {}) => verifySuivi({
  code, cwd: '/dossier-fictif', connectors, reliability: options.reliability ?? new Map(), marks: options.marks ?? new Map(), today: options.today ?? '2026-10-26',
});
const verify = (fixture: string, options: Parameters<typeof verifyRaw>[1] = {}) => verifyRaw(toJson(fixture), options);
const texts = (result: Awaited<ReturnType<typeof verifyRaw>>, kind: 'erreur' | 'manque') => result.issues.filter((issue) => issue.kind === kind).map((issue) => `${issue.path} : ${issue.text}`);

test('le calendrier reporte le terme et connaît les jours fériés', () => {
  assert.equal(closed('2026-11-14'), 'samedi');
  assert.equal(closed('2026-11-11'), '11 novembre');
  assert.equal(closed('2027-03-29'), 'lundi de Pâques');
  assert.equal(closed('2026-11-12'), null);
  assert.equal(shift('2026-01-31', { unite: 'mois', nombre: 1 }, 1), '2026-02-28');
  assert.equal(shift('2027-01-15', { unite: 'mois', nombre: 3 }, -1), '2026-10-15');
  assert.equal(shift('2026-11-10', { unite: 'jours_ouvres', nombre: 2 }, 1), '2026-11-13');
});

test('une citation doit montrer la date', () => {
  assert.ok(mentionsDate('signifié le 14 octobre 2026', '2026-10-14'));
  assert.ok(mentionsDate('Fait le 15/01/2024', '2024-01-15'));
  assert.ok(mentionsDate('le 1er mars 2026', '2026-03-01'));
  assert.ok(mentionsDate('reçu le 2 Février 2026', '2026-02-02'));
  assert.ok(!mentionsDate('signifié le 14 octobre 2025', '2026-10-14'));
  assert.ok(!mentionsDate('le 4/10/2026', '2026-10-14'));
});

test('contentieux : le délai est calculé, reporté et démontré', async () => {
  const result = await verify(CONTENTIEUX);
  assert.deepEqual(texts(result, 'erreur'), []);
  assert.deepEqual(texts(result, 'manque'), []);
  const [appel] = result.echeances;
  assert.equal(appel.date, '2026-11-16');
  assert.deepEqual(appel.calcul, ['Signification du jugement le 14/10/2026 + 1 mois → 14/11/2026', 'samedi 14/11/2026 (samedi, dimanche) → lundi 16/11/2026, jours fériés de métropole']);
  assert.equal(appel.selon[0].titre, 'Code fictif, article 10');
  assert.equal(result.evenements[0].preuve[0].titre, '03 Signification');
});

test('les noms du suivi s’écrivent en français, mots séparés par une espace', async () => {
  const result = await verify(CONTENTIEUX.replaceAll('signification_du_jugement', 'signification du jugement').replace('  appel:', '  délai d’appel:'));
  assert.deepEqual(texts(result, 'erreur'), []);
  assert.equal(result.echeances[0].nom, 'délai d’appel');
  assert.equal(result.echeances[0].date, '2026-11-16');
  const colon = await verify(CONTENTIEUX.replace('  appel:', '  "appel: civil":'));
  assert.equal(colon.issues[0].kind, 'erreur');
});

test('contrat : une échéance part d’une autre, à rebours, et se signale une fois dépassée', async () => {
  const result = await verify(CONTRAT);
  assert.deepEqual(texts(result, 'erreur'), []);
  const byName = Object.fromEntries(result.echeances.map((deadline) => [deadline.nom, deadline]));
  assert.equal(byName.fin_de_la_duree_initiale.date, '2027-01-15');
  assert.equal(byName.denonciation.date, '2026-10-15');
  assert.deepEqual(texts(result, 'manque'), ['echeances.denonciation : échéance dépassée le 15/10/2026 sans être marquée faite : ajoute fait: { date, preuve } ou fais-la marquer par l’avocat']);
  const marked = await verify(CONTRAT, { marks: new Map([['denonciation', { date: '2026-10-10', piece: null, at: '2026-10-10T10:00:00Z' }]]) });
  assert.deepEqual(texts(marked, 'manque'), []);
  assert.equal(marked.echeances.find((deadline) => deadline.nom === 'denonciation')!.fait?.par, 'avocat');
});

test('un acte non signé part d’une date supposée, sans alerte de dépassement', async () => {
  const result = await verify(CONTRAT.replace(/    preuve:\n      - piece: pieces\/01_contrat.md\n        citation: Fait le 15\/01\/2024\n/, '    hypothese: true\n'));
  assert.deepEqual(texts(result, 'manque'), []);
  assert.ok(result.echeances.every((deadline) => deadline.suppose));
});

test('le suivi n’est pas une chronologie : un événement sans portée est signalé', async () => {
  const result = await verify(CONTENTIEUX.replace('echeances:', `  courrier_sur_les_livraisons:
    date: 2026-03-02
    preuve:
      - piece: pieces/04_courrier.md
        citation: du 2 mars 2026
echeances:`));
  assert.deepEqual(texts(result, 'manque'), ['evenements.courrier_sur_les_livraisons : événement qui ne fait courir aucune échéance et dont aucun texte cité ne fonde la portée : relie-le à une échéance (de ou avant), cite le texte ou la clause qui lui donne effet (selon), ou retire-le ; le suivi n’est pas une chronologie']);
});

test('chaque entrée est justifiée : délai, décompte, date et citation', async () => {
  const bare = await verify(`evenements:
  signification_du_jugement:
    date: 2026-10-14
    preuve:
      - piece: pieces/03_signification.md
        citation: Jean Dupont
echeances:
  appel:
    intitule: Interjeter appel
    de: signification_du_jugement
    delai:
      mois: 1
    date: 2026-11-14
  audience:
    intitule: Audience
    date: 2026-12-01
`);
  assert.deepEqual(texts(bare, 'erreur'), [
    'echeances.appel : délai sans fondement : cite le texte, la décision ou la clause qui le fixe (selon: [{ source, citation }])',
    'echeances.audience : date sans justification : cite la pièce qui la fixe (preuve: [{ piece, citation }]) ou le texte (selon)',
  ]);
  assert.deepEqual(texts(bare, 'manque'), [
    'evenements.signification_du_jugement.preuve : la citation ne montre pas la date du 14/10/2026 : cite le passage de la pièce qui la porte',
    'echeances.appel : décompte non justifié : ajoute decompte : { depart: exclu ou inclus, report: jour_ouvrable_suivant, jour_ouvrable_precedent ou aucun, selon: [{ source, citation }] }, avec le texte ou la clause qui fixe ce décompte',
  ]);
  assert.deepEqual(bare.echeances.find((deadline) => deadline.nom === 'appel')!.calcul, ['Signification du jugement le 14/10/2026 + 1 mois → 14/11/2026', 'tombe un samedi : report à préciser dans decompte']);
  const wrong = await verify(CONTENTIEUX.replace('    de: signification_du_jugement', '    de: signification_du_jugement\n    date: 2026-11-14'));
  assert.deepEqual(texts(wrong, 'erreur'), ['echeances.appel.date : date écrite 14/11/2026, le calcul donne 16/11/2026 : corrige la date ou le délai']);
});

test('les sources sont relues : identifiant officiel, citation, version en vigueur, fiabilité', async () => {
  const result = await verify(CONTENTIEUX.replace('LEGIARTI000000000101', 'article 10 du code fictif').replace(/LEGIARTI000000000102\n          citation: .*/, 'LEGIARTI000000000103\n          citation: Ancienne rédaction abrogée'), { reliability: new Map([['pieces/03_signification.md', false]]) });
  const errors = texts(result, 'erreur');
  assert.equal(errors.length, 3);
  assert.equal(errors[0], 'evenements.signification_du_jugement.preuve[0].piece : pièce marquée non fiable par l’avocat : 03 Signification');
  assert.match(errors[1], /^echeances\.appel\.selon\[0\]\.source : source sans identifiant officiel : article 10 du code fictif ; indique son identifiant/);
  assert.equal(errors[2], 'echeances.appel.decompte.selon[0].source : version citée en vigueur du 01/01/1990 au 01/01/2010, pas au 14/10/2026 : cite la version applicable à cette date');
});

test('syntaxe et clés : le suivi signale les fautes de frappe et de structure', async () => {
  const typo = await verify(CONTENTIEUX.replace('    decompte:', '    decomte:'));
  assert.match(texts(typo, 'erreur')[0], /^echeances\.appel\.decomte : clé inconnue decomte : écris decompte/);
  const broken = await verifyRaw('{\n  "evenements": {\n    "a": 1,\n  }\n}\n');
  assert.equal(broken.issues[0].kind, 'erreur');
  assert.equal(broken.issues[0].line, 4);
  const duplicate = await verifyRaw('{\n  "evenements": {},\n  "evenements": {}\n}\n');
  assert.equal(duplicate.issues[0].line, 3);
  const loop = await verify(`echeances:
  a:
    intitule: A
    avant: b
    delai:
      jours: 1
  b:
    intitule: B
    de: a
    delai:
      jours: 1
`);
  assert.ok(texts(loop, 'erreur').some((line) => line.includes('en boucle')));
});

test('le service garde le suivi par dossier, le relit s’il change et enregistre ce que l’avocat marque fait', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suivi-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'suivi-'));
  const db = new Database(':memory:');
  db.exec("CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT UNIQUE, custom_project_name TEXT, isStarred BOOLEAN DEFAULT 0, isArchived BOOLEAN DEFAULT 0); CREATE TABLE sessions (session_id TEXT PRIMARY KEY, project_path TEXT, isArchived BOOLEAN DEFAULT 0, updated_at DATETIME)");
  db.prepare('INSERT INTO projects (project_id, project_path, custom_project_name) VALUES (?,?,?), (?,?,?)').run('p1', root, 'Dupont c. Exemple', 'p2', other, null);
  db.prepare("INSERT INTO sessions VALUES ('s1', ?, 0, '2026-10-20'), ('s2', ?, 0, '2026-10-25')").run(root, root);
  const service = createSuiviService(() => db, connectors);
  assert.equal((await service.read(root)).absent, true);
  await assert.rejects(service.verify(root), /Aucun suivi/);
  fs.mkdirSync(path.join(root, '.piecemaker'));
  fs.writeFileSync(path.join(root, '.piecemaker', 'suivi.json'), toJson(CONTRAT));
  const first = await service.read(root);
  assert.equal(first.revision, 1);
  assert.equal((await service.read(root)).revision, 1);
  const marked = await service.mark(root, 'denonciation', { date: '2026-10-12', piece: 'pieces/05_lettre.md' });
  assert.deepEqual(marked.echeances.find((deadline) => deadline.nom === 'denonciation')!.fait, { date: '2026-10-12', preuve: [], par: 'avocat', piece: 'pieces/05_lettre.md', at: marked.echeances.find((deadline) => deadline.nom === 'denonciation')!.fait!.at });
  await assert.rejects(service.mark(root, 'inconnue', {}), /introuvable/);
  const restored = await service.mark(root, 'denonciation', { annuler: true });
  assert.equal(restored.echeances.find((deadline) => deadline.nom === 'denonciation')!.fait, null);
  fs.writeFileSync(path.join(root, '.piecemaker', 'suivi.json'), toJson(CONTENTIEUX));
  const all = await service.all();
  assert.equal(all.length, 1);
  assert.equal(all[0].nom, 'Dupont c. Exemple');
  assert.equal(all[0].session, 's2');
  assert.equal(all[0].snapshot.echeances[0].nom, 'appel');
  assert.match(await service.command(root, { commande: 'verifier' }), /16\/11\/2026 — Interjeter appel \(appel\) — à venir/);
});

const boardFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-'));
  fs.mkdirSync(path.join(root, '.piecemaker'));
  const db = new Database(':memory:');
  db.exec("CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT UNIQUE, custom_project_name TEXT, isStarred BOOLEAN DEFAULT 0, isArchived BOOLEAN DEFAULT 0);");
  db.prepare('INSERT INTO projects (project_id, project_path, custom_project_name) VALUES (?,?,?)').run('p1', root, 'Dupont c. Exemple');
  const service = createSuiviService(() => db, connectors);
  const board = createBoardService(() => db, service);
  const file = path.join(root, '.piecemaker', 'suivi.json');
  const matterPath = `projects/cabinet/matters/${dossierMatterId(root)}`;
  const raw = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const matter = async () => (await board.current()).docs[matterPath] as { name: string; client?: string; keyDates: Array<Record<string, unknown>> };
  return { root, db, service, board, file, matterPath, raw, matter };
};

test('un ancien suivi.yaml devient suivi.json sans perdre le fichier d’origine', async () => {
  const { root, service, file, raw } = boardFixture();
  fs.writeFileSync(path.join(root, '.piecemaker', 'suivi.yaml'), CONTENTIEUX);
  assert.equal((await service.read(root)).echeances[0].date, '2026-11-16');
  assert.equal(raw().evenements.signification_du_jugement.date, '2026-10-14');
  assert.ok(fs.existsSync(`${file.replace('.json', '.yaml')}.migre`));
  assert.ok(!fs.existsSync(file.replace('.json', '.yaml')));
});

test('le board affiche les dates calculées, sans les recopier dans le fichier', async () => {
  const { file, matter, raw, board, matterPath } = boardFixture();
  fs.writeFileSync(file, toJson(CONTENTIEUX));
  const first = await matter();
  assert.equal(first.name, 'Dupont c. Exemple');
  const appel = first.keyDates.find((date) => date.label === 'Interjeter appel')!;
  assert.equal(appel.date, '2026-11-16');
  assert.equal(appel.id, suiviDateId('appel'));
  assert.equal(appel.done, false);
  assert.match(String(appel.source), /vérifiée/);
  await board.write('update', matterPath, { client: 'Société Exemple SAS', nextStep: 'Relire le jugement' });
  assert.equal((await matter()).client, 'Société Exemple SAS');
  assert.equal(raw().matter.keyDates, undefined);
  assert.ok(raw().echeances.appel);
});

test('une case cochée sur le board marque l’échéance et se décoche', async () => {
  const { file, matter, board, matterPath, service, root } = boardFixture();
  fs.writeFileSync(file, toJson(CONTENTIEUX));
  const dates = (await matter()).keyDates;
  const base = dates.map((date) => date.id);
  const checked = dates.map((date) => (date.label === 'Interjeter appel' ? { ...date, done: true } : date));
  await board.write('update', matterPath, { keyDates: checked }, base);
  assert.equal((await service.read(root)).echeances[0].fait?.par, 'avocat');
  assert.equal((await matter()).keyDates.find((date) => date.label === 'Interjeter appel')!.done, true);
  await board.write('update', matterPath, { keyDates: dates }, base);
  assert.equal((await service.read(root)).echeances[0].fait, null);
});

test('une date retirée sur le board est supprimée, pas celle ajoutée entre-temps par l’agent', async () => {
  const { file, matter, board, matterPath, raw } = boardFixture();
  fs.writeFileSync(file, toJson(CONTENTIEUX));
  const dates = (await matter()).keyDates;
  const seen = dates.map((date) => date.id).filter((id) => id !== suiviDateId('appel'));
  await board.write('update', matterPath, { keyDates: dates.filter((date) => date.id !== suiviDateId('appel')) }, seen);
  assert.ok(raw().echeances.appel);
  await board.write('update', matterPath, { keyDates: dates.filter((date) => date.id !== suiviDateId('appel')) }, dates.map((date) => date.id));
  assert.equal(raw().echeances.appel, undefined);
});

test('une date saisie à la main est conservée et signalée à justifier', async () => {
  const { file, matter, board, matterPath, service, root } = boardFixture();
  fs.writeFileSync(file, toJson(CONTENTIEUX));
  const dates = (await matter()).keyDates;
  await board.write('update', matterPath, { keyDates: [...dates, { id: 'manuelle-1', label: 'Rendez-vous', date: '2026-12-01', kind: 'other' }] }, dates.map((date) => date.id));
  assert.ok((await matter()).keyDates.some((date) => date.id === 'manuelle-1' && date.label === 'Rendez-vous'));
  assert.ok((await service.read(root)).issues.some((issue) => issue.kind === 'manque' && issue.path.startsWith('matter.keyDates')));
});

test('supprimer le dossier du board met le fichier de côté et un set le restaure', async () => {
  const { file, board, matterPath, matter, raw } = boardFixture();
  fs.writeFileSync(file, toJson(CONTENTIEUX));
  await matter();
  await board.write('delete', matterPath, undefined);
  assert.ok(!fs.existsSync(file));
  assert.ok(fs.existsSync(`${file}.supprime`));
  assert.equal((await board.current()).docs[matterPath], undefined);
  await board.write('set', matterPath, { name: 'Dupont c. Exemple' });
  assert.ok(raw().echeances.appel);
});

test('le board ne montre que les dossiers ayant un suivi et refuse tout ajout manuel', async () => {
  const { board, db, matterPath } = boardFixture();
  const orphan = 'projects/cabinet/matters/affaire-manuelle';
  assert.equal((await board.current()).docs[matterPath], undefined);
  await assert.rejects(board.write('set', orphan, { name: 'Affaire manuelle' }), /ne s'ajoute pas/);
  await assert.rejects(board.command({ commande: 'ecrire', chemin: orphan, donnees: { name: 'Affaire manuelle' } }), /ne s'ajoute pas/);
  db.prepare('INSERT INTO pm_board_docs VALUES(?,?)').run(orphan, JSON.stringify({ name: 'Ancienne affaire manuelle' }));
  assert.equal((await board.current()).docs[orphan], undefined);
});

test('un suivi illisible ne bloque ni le board ni les autres écritures, et n’est jamais écrasé', async () => {
  const { file, board, matterPath, matter } = boardFixture();
  fs.writeFileSync(file, '{ "evenements": ');
  assert.equal((await matter()).name, 'Dupont c. Exemple');
  await assert.rejects(board.write('update', matterPath, { client: 'Société Exemple SAS' }), /illisible/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ "evenements": ');
});

test('les autres documents du board restent dans la base et l’agent y accède', async () => {
  const { board, db } = boardFixture();
  assert.equal(((await board.current()).docs['c4lSample/state'] as { dismissed: boolean }).dismissed, true);
  await board.command({ commande: 'ecrire', chemin: 'projects/cabinet/requests/r1', donnees: { status: 'open', instructions: 'Ajouter un dossier' } });
  await board.command({ commande: 'ecrire', chemin: 'projects/cabinet/requests/r1', donnees: { status: 'done' } });
  const read = JSON.parse(await board.command({ commande: 'lire', chemin: 'projects/cabinet/requests' }));
  assert.deepEqual(read.r1, { status: 'done', instructions: 'Ajouter un dossier' });
  assert.equal((db.prepare('SELECT count(*) AS n FROM pm_board_docs').get() as { n: number }).n, 3);
  await assert.rejects(board.write('set', '../sortie', {}), /Chemin invalide/);
});
