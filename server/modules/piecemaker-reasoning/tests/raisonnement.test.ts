import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { EXAMPLE_SOURCES, createReasoningService, describeReasoning, verifyReasoning as verifyYaml } from '../program.js';
import type { ReasoningConnectors, SourceInfo } from '../program.js';
import { addDuration, evaluate } from '../engine.js';
import { parseLiteral } from '../format.js';
import type { Formula } from '../format.js';
import { parseReasoningDocument, printReasoningDocument } from '../document.js';
import { EXAMPLE_LITERAL as EXAMPLE_CODE, yamlOf } from './fixtures.js';

const verifyReasoning = (input: Parameters<typeof verifyYaml>[0]) => verifyYaml({ ...input, code: yamlOf(input.code) });

const plain = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const connectors = (sources: Record<string, SourceInfo> = EXAMPLE_SOURCES): ReasoningConnectors => ({
  source: async (_cwd, id) => (/^(LEGIARTI|JURITEXT)\d+$/.test(id) || id.includes('/') ? sources[id] ?? null : undefined),
  match: (text, excerpt) => {
    if (text.includes(excerpt)) return excerpt;
    const found = new RegExp(plain(excerpt).split(' ').join('[^\\p{L}\\p{N}]+'), 'iu').exec(text);
    return found ? found[0] : null;
  },
  registry: async () => ({ found: true, status: 'active' }),
  bodacc: async () => [],
});

const verify = (code: string, options: { reliability?: Map<string, boolean>; dismissed?: Set<string> } = {}) => verifyReasoning({
  code, cwd: '/dossier-fictif', connectors: connectors(),
  reliability: options.reliability ?? new Map(), nature: (piece) => (piece.includes('contrat') ? 'contrat' : null),
  persons: [{ label: 'Société Beta SARL', kind: 'company', name: null, siren: null }],
  dismissed: options.dismissed ?? new Set(),
});

const withRoots = (code: string, roots: string) => code.replace('\n  hypotheses:', `\n${roots}\n  hypotheses:`);
const at = (annotated: unknown, route: string) => route.split(/\.|\[|\]/).filter(Boolean).reduce<any>((value, key) => value?.[key], annotated);
const texts = (result: Awaited<ReturnType<typeof verify>>, kind: 'erreur' | 'manque') => result.issues.filter((issue) => issue.kind === kind).map((issue) => `${issue.path} : ${issue.text}`);

test('le fichier est lu sans être exécuté : fonctions, appels, variables et commentaires sont refusés', () => {
  assert.equal((parseLiteral('export default { a: [1, `x`, vrai, null], b: { c: -2 } };').value as any).b.c, -2);
  for (const code of ['{ a: () => 1 }', '{ a: require("fs") }', '{ a: process }', '{ a: `${x}` }', '{ a: 1 } // note', '{ a: 1 }; alert(1)', '{ a: 1, a: 2 }']) {
    assert.throws(() => parseLiteral(code), /ligne \d+/, code);
  }
});

test('l’exemple fictif est à établir et désigne les faits décisifs', async () => {
  const result = await verify(EXAMPLE_CODE);
  assert.deepEqual(texts(result, 'erreur'), []);
  assert.equal(at(result.annotated, 'objectifs[0].statut'), 'à établir');
  assert.deepEqual(at(result.annotated, 'objectifs[0].decisifs'), ['force_majeure', 'grève_nationale']);
  assert.deepEqual(at(result.annotated, 'objectifs[0].personnes'), ['Société Beta SARL']);
  assert.equal(at(result.annotated, 'pénalité_stipulée.si[0].statut'), 'acquis');
  assert.equal(at(result.annotated, 'grève.si[0].l_une[1].statut'), 'exclu');
  assert.equal(at(result.annotated, 'force_majeure_contractuelle.si[0].l_une[0].decisif'), true);
  assert.equal(at(result.annotated, 'bilan.hypotheses'), '1/1');
  assert.equal(at(result.annotated, 'pénalité_encourue.si[0].selon[0].titre'), 'Code civil fictif, article 1231-5');
  assert.equal(at(result.annotated, 'pénalité_encourue.si[0].selon[0].en_vigueur'), true);
  const described = describeReasoning(result);
  assert.match(described, /^0 erreur\(s\), \d+ manque\(s\)\./);
  assert.match(described, /MANQUE \d+ — grève › si\[0\] › l_une\[0\] \(ligne (\d+)\)\n  ligne \1 : - grève_nationale: true\n  grève_nationale décide de la réponse/);
  assert.match(described, /MANQUE \d+ — qualification\n  absent du fichier : clé à ajouter au premier niveau de l’objet\n  raisonnement non qualifié/);
  assert.doesNotMatch(described, /Réponses|décisifs :|statut/);
});

test('toutes les feuilles établies : la réponse est acquise ; la preuve de l’exception l’exclut', async () => {
  const closed = withRoots(EXAMPLE_CODE, "  force_majeure: { false: [{ preuve: [{ piece: 'pieces/07_courriel.md', citation: `a duré deux jours` }] }] },\n  grève_nationale: { false: [{ preuve: [{ piece: 'pieces/07_courriel.md', citation: `mouvement limité à notre atelier` }] }] },");
  assert.equal(at((await verify(closed)).annotated, 'objectifs[0].statut'), 'acquis');
  const excused = withRoots(EXAMPLE_CODE, "  grève_nationale: { true: [{ preuve: [{ piece: 'pieces/07_courriel.md', citation: `mouvement limité à notre atelier` }] }] },");
  assert.equal(at((await verify(excused)).annotated, 'objectifs[0].statut'), 'exclu');
});

test('une citation à la ponctuation près est validée et remplacée par l’original ; une citation fausse est une erreur', async () => {
  const comma = await verify(EXAMPLE_CODE.replace('`Sauf inexécution définitive`', '`Sauf, inexécution définitive`'));
  assert.equal(at(comma.annotated, 'pénalité_encourue.si[1].selon[0].corrigee'), true);
  assert.equal(at(comma.annotated, 'pénalité_encourue.si[1].selon[0].citation'), 'Sauf inexécution définitive');
  assert.match(comma.code, /citation: Sauf inexécution définitive\n/);
  const wrong = await verify(EXAMPLE_CODE.replace('`Sauf inexécution définitive`', '`Sauf exécution partielle`'));
  assert.match(texts(wrong, 'erreur').join('\n'), /pénalité_encourue\.si\[1\]\.selon\[0\] : citation introuvable/);
});

test('la vigueur est une condition appréciée à la date que chaque texte désigne : absente ou dépassée c’est un manque, fausse une erreur, et chaque article dit pourquoi il s’applique', async () => {
  const missing = await verify(EXAMPLE_CODE.replace("débiteur est mis en demeure`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_conclusion_du_contrat' }", 'débiteur est mis en demeure`'));
  assert.match(texts(missing, 'manque').join('\n'), /pénalité_encourue\.si\[0\]\.selon\[0\]\.vigueur : vigueur non renseignée.*debut '2016-10-01'/);
  assert.deepEqual(texts(missing, 'erreur'), []);
  const differs = await verify(EXAMPLE_CODE.replace("débiteur est mis en demeure`, vigueur: { debut: '2016-10-01'", "débiteur est mis en demeure`, vigueur: { debut: '2016-02-10'"));
  assert.match(texts(differs, 'erreur').join('\n'), /vigueur différente de la version citée : debut '2016-10-01'/);
  const late = await verify(EXAMPLE_CODE.replace("valeur: '2024-01-15'", "valeur: '2015-06-14'"));
  assert.equal(at(late.annotated, 'objectifs[0].statut'), 'exclu');
  assert.match(texts(late, 'manque').join('\n'), /selon\[0\]\.vigueur : version non applicable : elle n’était pas en vigueur au 2015-06-14/);
  const undated = await verify(EXAMPLE_CODE.replaceAll(", au: 'date_de_conclusion_du_contrat'", ''));
  assert.equal(at(undated.annotated, 'objectifs[0].statut'), 'à établir');
  assert.match(texts(undated, 'manque').join('\n'), /pénalité_encourue\.si\[0\]\.selon\[0\]\.vigueur : applicabilité dans le temps non établie : ajoute vigueur: \{ debut, fin, au:/);
  assert.equal(undated.issues.find((entry) => entry.path === 'pénalité_encourue.si[0].selon[0].vigueur' && entry.text.startsWith('applicabilité dans le temps'))!.avocat, 'Code civil fictif, article 1231-5 : l’applicabilité du texte dans le temps n’est pas établie.');
  const unproven = await verify(EXAMPLE_CODE.replace(", preuve: [{ piece: 'pieces/01_contrat.md', citation: `Fait le 15/01/2024` }] }", ' }'));
  assert.match(texts(unproven, 'manque').join('\n'), /selon\[0\]\.vigueur : date_de_conclusion_du_contrat : renseigne cette date dans valeurs, avec sa preuve/);
  assert.match(texts(await verify(EXAMPLE_CODE.replace("valeur: '2024-01-15'", 'valeur: 12')), 'erreur').join('\n'), /date_de_conclusion_du_contrat sert à .*\.au : une date 'AAAA-MM-JJ' attendue/);
  assert.match(texts(await verify(EXAMPLE_CODE.replace("obtenir: 'pénalité_encourue',", "obtenir: 'pénalité_encourue', date: { valeur: '2025-06-14' },")), 'erreur').join('\n'), /objectifs\[0\]\.date : clé inconnue date/);
});

test('en drafting, la version d’un texte s’apprécie à la date du jour, sauf date précisée dans valeurs', async () => {
  const drafting = EXAMPLE_CODE.replace('{\n  objectifs:', "{\n  qualification: 'drafting',\n  objectifs:");
  const on = (code: string, today: string) => verifyReasoning({ code, cwd: '/dossier-fictif', connectors: connectors(), reliability: new Map(), nature: () => null, persons: [], dismissed: new Set(), today });
  const undated = drafting.replaceAll(", au: 'date_de_conclusion_du_contrat'", '');
  const current = await on(undated, '2026-10-26');
  assert.doesNotMatch(texts(current, 'manque').join('\n'), /applicabilité dans le temps non établie/);
  assert.equal(at(current.annotated, 'pénalité_encourue.si[0].selon[0].en_vigueur'), true);
  assert.match(texts(await on(undated, '2015-06-14'), 'manque').join('\n'), /pénalité_encourue\.si\[0\]\.selon\[0\]\.vigueur : version non applicable : elle n’était pas en vigueur au 2015-06-14 \(date du jour\)/);
  assert.doesNotMatch(texts(await on(drafting, '2015-06-14'), 'manque').join('\n'), /version non applicable/);
  const unsigned = drafting.replace(/date_de_conclusion_du_contrat: \{ valeur: '2024-01-15', preuve: \[[^\n]*\] \},/, 'date_de_conclusion_du_contrat: { valeur: null },');
  assert.notEqual(unsigned, drafting);
  const open = await on(unsigned, '2026-10-26');
  assert.doesNotMatch(texts(open, 'manque').join('\n'), /renseigne cette date|version non applicable/);
  assert.equal(at(open.annotated, 'pénalité_encourue.si[0].selon[0].en_vigueur'), true);
});

test('l’applicabilité d’un texte est un terme : ses conditions, sourcées et prouvées, décident si le texte s’applique', async () => {
  const unjustified = await verify(EXAMPLE_CODE.replace(", applicabilite: 'applicabilité_de_l_article_1231_5' }] },", " }] },"));
  assert.match(texts(unjustified, 'manque').join('\n'), /pénalité_encourue\.si\[0\]\.selon\[0\]\.applicabilite : applicabilité non établie : ajoute applicabilite:/);
  const result = await verify(EXAMPLE_CODE);
  assert.doesNotMatch(texts(result, 'manque').join('\n'), /applicabilite/);
  assert.equal(at(result.annotated, 'applicabilité_de_l_article_1231_5.statut'), 'acquis');
  assert.doesNotMatch(texts(result, 'manque').join('\n'), /applicabilité_de_l_article_1231_5 : terme qui ne sert/);
  const inapplicable = await verify(EXAMPLE_CODE.replace('contrat_stipulant_une_pénalité: { true: [', 'contrat_stipulant_une_pénalité: { false: ['));
  assert.equal(at(inapplicable.annotated, 'applicabilité_de_l_article_1231_5.statut'), 'exclu');
  assert.equal(at(inapplicable.annotated, 'pénalité_encourue.si[0].statut'), 'exclu');
  assert.equal(at(inapplicable.annotated, 'objectifs[0].statut'), 'exclu');
  const unproven = await verify(EXAMPLE_CODE.replace(/\n  contrat_stipulant_une_pénalité: \{[^\n]*\},/, ''));
  assert.ok(at(unproven.annotated, 'objectifs[0].decisifs').includes('contrat_stipulant_une_pénalité'));
  const errors = texts(await verify(EXAMPLE_CODE.replace("applicabilite: 'applicabilité_de_l_article_1231_5' }] },", "applicabilite: 'applicabilité_inconnue' }] },").replace("applicabilite: 'applicabilité_de_l_article_1231_5' }] },", 'applicabilite: `un contrat` }] },')), 'erreur').join('\n');
  assert.match(errors, /selon\[0\]\.applicabilite : terme applicabilité_inconnue non défini/);
  assert.match(errors, /selon\[0\]\.applicabilite : applicabilite : le nom commence par « applicabilité » \(ex\. applicabilité de un contrat\)/);
});

test('une condition sans source, un terme non défini, une boucle et un hypothèse non conforme sont des erreurs', async () => {
  const errors = texts(await verify(`{
    objectifs: [{ objectif: \`Objectif fictif\`, obtenir: 'a' }, { objectif: \`Autre objectif\`, obtenir: 'absent' }],
    a: { si: [{ b: true, selon: [{ source: 'LEGIARTI000000000005', citation: \`Sauf inexécution définitive\` }] }, { c: true }] },
    b: { si: [{ a: true, selon: [{ source: 'LEGIARTI000000000005', citation: \`Sauf inexécution définitive\` }] }] },
    hypotheses: [{ nom: \`faux\`, faits: { c: vrai }, attendu: { c: faux } }],
  }`), 'erreur').join('\n');
  assert.match(errors, /a\.si\[1\]\.selon : condition sans source/);
  assert.match(errors, /objectifs\[1\]\.obtenir : terme absent non défini/);
  assert.match(errors, /boucle : a → b → a/);
});

test('une hypothèse rejoue le droit seul et signale un résultat contraire à l’attendu', async () => {
  const result = await verify(EXAMPLE_CODE.replace('attendu: { pénalité_encourue: faux }', 'attendu: { pénalité_encourue: vrai }'));
  assert.equal(at(result.annotated, 'hypotheses[0].conforme'), false);
  assert.match(texts(result, 'erreur').join('\n'), /hypotheses\[0\] : hypothèse non conforme : obtenu pénalité_encourue = faux/);
});

test('une source d’un autre droit est acceptée mais signalée comme non vérifiable', async () => {
  const result = await verify(EXAMPLE_CODE.replace("source: 'LEGIARTI000000000005', citation: `Sauf inexécution définitive`", "source: 'CELEX:00000X0000', citation: `Sauf inexécution définitive`"));
  assert.match(texts(result, 'manque').join('\n'), /source non vérifiable automatiquement : aucun connecteur pour CELEX:00000X0000/);
  assert.deepEqual(texts(result, 'erreur'), []);
});

test('une pièce non fiable ne prouve rien ; une pièce non évaluée est signalée', async () => {
  const result = await verify(EXAMPLE_CODE, { reliability: new Map([['pieces/06_mise_en_demeure.md', false]]) });
  assert.equal(at(result.annotated, 'pénalité_encourue.si[1].l_une[0].statut'), 'à établir');
  assert.equal(at(result.annotated, 'mise_en_demeure.true[0].preuve[0].fiable'), false);
  assert.ok(!at(result.annotated, 'bilan.pieces_a_evaluer_par_l_avocat').includes('pieces/06_mise_en_demeure.md'));
  assert.ok(at(result.annotated, 'bilan.pieces_a_evaluer_par_l_avocat').includes('pieces/07_courriel.md'));
});

test('une alerte écartée par l’avocat n’est plus émise, et revient si l’élément change', async () => {
  const first = await verify(EXAMPLE_CODE);
  const target = first.issues.find((issue) => issue.text.startsWith('force_majeure décide'))!;
  const dismissed = await verify(EXAMPLE_CODE, { dismissed: new Set([target.id]) });
  assert.equal(at(dismissed.annotated, 'bilan.ecartees'), 1);
  assert.equal(at(dismissed.annotated, 'force_majeure_contractuelle.si[0].l_une[0].manques'), undefined);
  const changed = await verify(EXAMPLE_CODE.replace("force_majeure: true }", "cas_de_force_majeure: true }"), { dismissed: new Set([target.id]) });
  assert.equal(at(changed.annotated, 'bilan.ecartees'), 0);
});

test('le service lit le fichier du dossier, corrige les citations, enregistre les décisions de l’avocat', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'raisonnement-'));
  fs.mkdirSync(path.join(folder, '.piecemaker', 'raisonnements'), { recursive: true });
  const file = path.join(folder, '.piecemaker', 'raisonnements', 'penalite.yaml');
  fs.writeFileSync(file, yamlOf(EXAMPLE_CODE.replace('`Sauf inexécution définitive`', '`sauf inexécution définitive`')));
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects(project_id TEXT PRIMARY KEY, project_path TEXT);');
  db.prepare('INSERT INTO projects VALUES(?,?)').run('fictif', folder);
  t.after(() => { db.close(); fs.rmSync(folder, { recursive: true, force: true }); });
  const service = createReasoningService(() => db, connectors());
  db.prepare('INSERT INTO pm_reasoning_programs VALUES(?,?,?,?,?)').run('fictif', 'penalite', 3, 'ancien format', JSON.stringify({ code: 'ancien format', questions: [] }));
  assert.equal((await service.read(folder)).code, '');
  const text = await service.command(folder, { commande: 'verifier' });
  assert.match(text, /^Raisonnement penalite \(\.piecemaker\/raisonnements\/penalite\.yaml\)\n\d+ erreur\(s\), \d+ manque\(s\)/);
  assert.match(fs.readFileSync(file, 'utf8'), /citation: Sauf inexécution définitive\n/);
  const issue = (await service.read(folder)).issues.find((entry) => entry.kind === 'manque')!;
  assert.equal((await service.dismiss(folder, issue.id)).dismissed.length, 1);
  assert.equal((await service.dismiss(folder, issue.id, true)).dismissed.length, 0);
  assert.equal((await service.rate(folder, 'pieces/06_mise_en_demeure.md', false)).reliability[0].reliable, false);
  await assert.rejects(service.command(folder, { commande: 'condition' }), /Commande : verifier/);
  const before = fs.readFileSync(file, 'utf8');
  const simulated = await service.simulate(folder, { grève_nationale: false, force_majeure: false, mise_en_demeure: true, retard_de_livraison: true });
  assert.equal(simulated.objectifs[0].statut, 'acquis');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  await assert.rejects(service.simulate(folder, { prix: 'cher' }), /faits/);
  fs.rmSync(file);
  await assert.rejects(service.verify(folder), /Aucun raisonnement : écris \.piecemaker\/raisonnements\/<nom>\.yaml/);
  fs.writeFileSync(path.join(folder, '.piecemaker', 'raisonnement.js'), EXAMPLE_CODE);
  await assert.rejects(service.verify(folder), /raisonnement\.js n’est plus lu : transcris-le en YAML dans \.piecemaker\/raisonnements\/<nom>\.yaml/);
  fs.rmSync(path.join(folder, '.piecemaker', 'raisonnement.js'));
  fs.writeFileSync(path.join(folder, '.piecemaker', 'raisonnement.yaml'), yamlOf(EXAMPLE_CODE));
  await assert.rejects(service.verify(folder), /raisonnement\.yaml n’est plus lu : déplace-le dans \.piecemaker\/raisonnements\/<nom>\.yaml/);
});

test('un dossier tient plusieurs raisonnements, chacun nommé par son fichier, vérifiés et suivis séparément', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'raisonnements-'));
  const directory = path.join(folder, '.piecemaker', 'raisonnements');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'penalite.yaml'), yamlOf(EXAMPLE_CODE));
  fs.writeFileSync(path.join(directory, 'retard.yaml'), yamlOf(EXAMPLE_CODE.replace('Obtenir de Société Beta SARL le paiement de la pénalité de retard', 'Établir le retard de Société Beta SARL')));
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects(project_id TEXT PRIMARY KEY, project_path TEXT);');
  db.prepare('INSERT INTO projects VALUES(?,?)').run('fictif', folder);
  t.after(() => { db.close(); fs.rmSync(folder, { recursive: true, force: true }); });
  const service = createReasoningService(() => db, connectors());
  await assert.rejects(service.verify(folder), /Plusieurs raisonnements dans ce dossier : précise lequel avec --raisonnement \(penalite, retard\)/);
  await assert.rejects(service.verify(folder, true, undefined, 'Pénalité'), /Nom de raisonnement invalide/);
  await assert.rejects(service.command(folder, { commande: 'verifier', raisonnement: 'absent' }), /Raisonnement introuvable : \.piecemaker\/raisonnements\/absent\.yaml \(raisonnements du dossier : penalite, retard\)/);
  assert.match(await service.command(folder, { commande: 'lister' }), /^penalite — \.piecemaker\/raisonnements\/penalite\.yaml — non vérifié\nretard — \.piecemaker\/raisonnements\/retard\.yaml — non vérifié$/);
  const first = await service.verify(folder, true, undefined, 'penalite');
  assert.equal(first.name, 'penalite');
  assert.deepEqual(first.raisonnements, ['penalite', 'retard']);
  const issue = first.issues.find((entry) => entry.kind === 'manque')!;
  await service.dismiss(folder, issue.id, false, 'penalite');
  const second = await service.verify(folder, true, undefined, 'retard');
  assert.equal(second.dismissed.length, 0);
  assert.equal((await service.read(folder)).name, 'retard');
  assert.equal((await service.read(folder, 'penalite')).dismissed.length, 1);
  assert.match(await service.command(folder, { commande: 'lister' }), /penalite — \.piecemaker\/raisonnements\/penalite\.yaml — \d+ erreur\(s\), \d+ manque\(s\), vérifié le \d{4}-\d{2}-\d{2}\n  Obtenir de Société Beta SARL le paiement de la pénalité de retard \(à établir\)\nretard — [^\n]*\n  Établir le retard de Société Beta SARL/);
});

test('une source porte son identifiant officiel et une décision remise en cause par un recours est signalée', async () => {
  const code = (source: string) => `{ objectifs: [{ objectif: \`Obtenir l’effet fictif\`, obtenir: 'effet' }], effet: { si: [{ fait: true, selon: [{ source: '${source}', citation: \`règle fictive\` }] }] } }`;
  const decision = (history?: SourceInfo['history']): Record<string, SourceInfo> => ({ JURITEXT000000000001: { kind: 'decision', title: 'Cour fictive, 1er janvier 2020', text: 'Attendu que la règle fictive s’applique.', ...(history ? { history } : {}) } });
  const run = (source: string, sources: Record<string, SourceInfo>) => verifyReasoning({ code: code(source), cwd: '/dossier-fictif', connectors: connectors(sources), reliability: new Map(), nature: () => null, persons: [], dismissed: new Set() });
  assert.match(texts(await run('Cass. com., 3 mai 2023', {}), 'erreur').join('\n'), /effet\.si\[0\]\.selon\[0\]\.source : source sans identifiant officiel : Cass\. com\., 3 mai 2023 ; indique son identifiant \(LEGIARTI… pour un article, JURITEXT… pour une décision judiciaire/);
  assert.match(texts(await run('CELEX:00000X0000', {}), 'manque').join('\n'), /source non vérifiable automatiquement : aucun connecteur pour CELEX:00000X0000/);
  assert.deepEqual(texts(await run('JURITEXT000000000001', decision({ statut: 'non remise en cause', details: [] })), 'erreur'), []);
  const quashed = await run('JURITEXT000000000001', decision({ statut: 'remise en cause', details: ['Recours JURITEXT000000000002 du 2021-03-04 (Cour de cassation) — Solution : Cassation'] }));
  assert.match(texts(quashed, 'erreur').join('\n'), /effet\.si\[0\]\.selon\[0\]\.source : décision remise en cause par un recours \(Recours JURITEXT000000000002 du 2021-03-04 \(Cour de cassation\) — Solution : Cassation\) : cite la décision rendue sur ce recours/);
  assert.match(texts(await run('JURITEXT000000000001', decision({ statut: 'à examiner', details: [] })), 'manque').join('\n'), /historique judiciaire à examiner : vérifie qu’aucun recours ne l’a remise en cause/);
});

test('le test se déroule ligne par ligne : sources, pièces, faits, termes, hypothèses, réponse', async () => {
  const seen: string[] = [];
  const result = await verifyReasoning({
    code: EXAMPLE_CODE, cwd: '/dossier-fictif', connectors: connectors(), reliability: new Map(), nature: () => null,
    persons: [], dismissed: new Set(), emit: (entry) => seen.push(`${entry.step}:${entry.status}`),
  });
  assert.ok(seen.indexOf('source:en cours') < seen.indexOf('source:ok'));
  assert.deepEqual([...new Set(result.log.map((entry) => entry.step))], ['source', 'pièce', 'fait', 'condition', 'essai', 'réponse']);
  assert.match(result.log.find((entry) => entry.key === 'fait:retard_de_livraison')!.text, /Prouvé par Bon de livraison \(fictif\) : « /);
  assert.match(result.log.find((entry) => entry.step === 'réponse')!.text, /En suspens : dépend de force majeure et grève nationale/);
});

test('seules les parties sociétés du dossier passent au registre et au BODACC', async () => {
  const checked: string[] = [];
  const result = await verifyReasoning({
    code: EXAMPLE_CODE, cwd: '/dossier-fictif', online: true,
    connectors: { ...connectors(), registry: async ({ name }) => { checked.push(String(name)); return { found: true, status: 'active' }; }, bodacc: async () => ['procédure collective : redressement judiciaire ouvert le 02/05/2025'] },
    reliability: new Map(), nature: () => null, dismissed: new Set(),
    persons: [
      { label: 'Société Beta SARL', kind: 'company', name: null, siren: '123456789', side: 'adversaire' },
      { label: 'Société Exemple SAS', kind: 'company', name: null, siren: null, side: 'client' },
      { label: 'Société Tiers SA', kind: 'company', name: null, siren: '987654321', side: 'tiers' },
    ],
  });
  assert.deepEqual(checked.sort(), ['Société Beta SARL', 'Société Exemple SAS']);
  assert.ok(result.issues.some((issue) => issue.avocat === 'Société Beta SARL : le BODACC signale procédure collective : redressement judiciaire ouvert le 02/05/2025.'));
  assert.ok(result.issues.some((issue) => issue.avocat?.startsWith('Société Exemple SAS : SIREN non renseigné')));
  assert.equal(result.log.find((entry) => entry.key === 'bodacc:Société Beta SARL')?.status, 'alerte');
});

const CESSION_SOURCES: Record<string, SourceInfo> = {
  'pieces/02_cession.md': { kind: 'piece', title: 'Cession de titres (fictive)', text: 'Article 1. Les délais se calculent de date à date. Article 7. La garantie est due deux ans à compter de la réalisation. Elle ne couvre pas un préjudice inférieur ou égal à 3.000 euros.' },
  'pieces/03_realisation.md': { kind: 'piece', title: 'Procès-verbal de réalisation (fictif)', text: 'Réalisation intervenue le 15/06/2022.' },
  'pieces/08_notification.md': { kind: 'piece', title: 'Notification de réclamation (fictive)', text: 'Notification du 10/02/2024 : dommage de 45.000 euros.' },
};
const CESSION_CODE = `{
  objectifs: [{ objectif: \`Obtenir une réduction de prix pour Société Exemple SAS\`, obtenir: 'réduction_due' }],
  valeurs: {
    date_de_réalisation: { valeur: '2022-06-15', preuve: [{ piece: 'pieces/03_realisation.md', citation: \`intervenue le 15/06/2022\` }] },
    date_de_notification: { valeur: '2024-02-10', preuve: [{ piece: 'pieces/08_notification.md', citation: \`Notification du 10/02/2024\` }] },
    montant_du_dommage: { valeur: 45000, preuve: [{ piece: 'pieces/08_notification.md', citation: \`dommage de 45.000 euros\` }] },
  },
  réduction_due: {
    si: [
      { notification_dans_la_garantie: true, delai: { de: 'date_de_réalisation', a: 'date_de_notification', au_plus: { ans: 2 } },
        selon: [{ source: 'pieces/02_cession.md', citation: \`deux ans à compter de la réalisation\`, vigueur: { debut: '2022-06-15', fin: null } }],
        decompte: 'décompte_de_la_garantie' },
      { dommage_au_dessus_du_seuil: true, montant: { valeur: 'montant_du_dommage', plus_de: 3000 },
        selon: [{ source: 'pieces/02_cession.md', citation: \`inférieur ou égal à 3.000 euros\`, vigueur: { debut: '2022-06-15', fin: null } }] },
    ],
  },
  décompte_de_la_garantie: {
    si: [{ délai_de_date_à_date: true, selon: [{ source: 'pieces/02_cession.md', citation: \`Les délais se calculent de date à date\`, vigueur: { debut: '2022-06-15', fin: null } }] }],
  },
  délai_de_date_à_date: { true: [{ preuve: [{ piece: 'pieces/02_cession.md', citation: \`Les délais se calculent de date à date\` }] }] },
  hypotheses: [
    { nom: \`notification le jour de l’échéance\`, faits: { délai_de_date_à_date: vrai, date_de_réalisation: '2022-06-15', date_de_notification: '2024-06-15', montant_du_dommage: 45000 }, attendu: { réduction_due: vrai } },
    { nom: \`notification tardive\`, faits: { délai_de_date_à_date: vrai, date_de_réalisation: '2022-06-15', date_de_notification: '2024-06-17', montant_du_dommage: 45000 }, attendu: { réduction_due: faux } },
    { nom: \`dommage égal au seuil\`, faits: { délai_de_date_à_date: vrai, date_de_réalisation: '2022-06-15', date_de_notification: '2023-09-10', montant_du_dommage: 3000 }, attendu: { réduction_due: faux } },
  ],
}`;
const cession = (code: string) => verifyReasoning({
  code, cwd: '/dossier-fictif', connectors: connectors(CESSION_SOURCES), reliability: new Map(), nature: () => null, persons: [], dismissed: new Set(),
});

test('un délai et un montant se calculent à partir des valeurs prouvées, et les hypothèses les rejouent', async () => {
  const result = await cession(CESSION_CODE);
  assert.deepEqual(texts(result, 'erreur'), []);
  assert.equal(at(result.annotated, 'objectifs[0].statut'), 'acquis');
  assert.deepEqual(at(result.annotated, 'réduction_due.si[0].calcul'), { depart: '2022-06-15', echeance: '2024-06-15', date_retenue: '2024-02-10' });
  assert.deepEqual(at(result.annotated, 'réduction_due.si[1].calcul'), { montant: 45000, seuil: 3000 });
  assert.equal(at(result.annotated, 'valeurs.montant_du_dommage.statut'), 'acquis');
  assert.equal(at(result.annotated, 'bilan.hypotheses'), '3/3');
  assert.match(result.log.find((entry) => entry.key === 'fait:notification_dans_la_garantie')!.text, /au plus 2 ans à compter du 15\/06\/2022 : échéance au 15\/06\/2024, date retenue 10\/02\/2024 → oui/);
  assert.doesNotMatch(texts(result, 'manque').join('\n'), /délai sans décompte/);
});

test('un délai sans décompte est un manque, sans que le système choisisse la règle ; le décompte est un sous-raisonnement qui conditionne le délai', async () => {
  const result = await cession(CESSION_CODE.replace(/\n {8}decompte: '[^']*' \},/, ' },').replace(/\n  décompte_de_la_garantie: \{[\s\S]*?\n  \},/, ''));
  assert.deepEqual(texts(result, 'erreur'), []);
  const issue = result.issues.find((entry) => entry.path === 'réduction_due.si[0].decompte')!;
  assert.equal(issue.kind, 'manque');
  assert.equal(issue.avocat, 'Notification dans la garantie : la règle sur laquelle se fonde le calcul du délai n’est pas mentionnée.');
  assert.ok(at(result.annotated, 'réduction_due.si[0].manques').some((text: string) => text.startsWith('délai sans décompte : ajoute decompte: \'décompte_de_notification_dans_la_garantie\'')));
  assert.equal(at(result.annotated, 'objectifs[0].statut'), 'acquis');
  const contradicted = await cession(CESSION_CODE.replace('délai_de_date_à_date: { true: [', 'délai_de_date_à_date: { false: ['));
  assert.equal(at(contradicted.annotated, 'décompte_de_la_garantie.statut'), 'exclu');
  assert.equal(at(contradicted.annotated, 'réduction_due.si[0].statut'), 'exclu');
});

test('une valeur sans pièce laisse le calcul en suspens et devient décisive ; un délai sans date retenue est une erreur', async () => {
  const unproven = await cession(CESSION_CODE.replace("date_de_notification: { valeur: '2024-02-10', preuve: [{ piece: 'pieces/08_notification.md', citation: `Notification du 10/02/2024` }] },", "date_de_notification: { valeur: '2024-02-10' },"));
  assert.equal(at(unproven.annotated, 'objectifs[0].statut'), 'à établir');
  assert.deepEqual(at(unproven.annotated, 'objectifs[0].decisifs'), ['notification_dans_la_garantie']);
  assert.match(texts(unproven, 'manque').join('\n'), /notification_dans_la_garantie décide de la réponse : renseigne date_de_notification dans valeurs, avec sa preuve/);
  assert.match(texts(await cession(CESSION_CODE.replace(", a: 'date_de_notification'", '')), 'erreur').join('\n'), /réduction_due\.si\[0\]\.delai : delai : \{ de: date de départ, a: date retenue,/);
});

test('les durées s’ajoutent au calendrier : fin de mois, année bissextile, jours ouvrés', () => {
  assert.equal(addDuration('2023-01-31', { unite: 'mois', nombre: 1 }), '2023-02-28');
  assert.equal(addDuration('2024-02-29', { unite: 'ans', nombre: 1 }), '2025-02-28');
  assert.equal(addDuration('2025-05-09', { unite: 'jours_ouvres', nombre: 1 }), '2025-05-12');
  assert.equal(addDuration('2025-05-09', { unite: 'jours', nombre: 30 }), '2025-06-08');
});

test('un délai ou un montant mal écrit, avec une preuve sur la condition ou appliqué à une valeur du mauvais type est une erreur', async () => {
  const errors = texts(await cession(CESSION_CODE
    .replace('au_plus: { ans: 2 }', 'au_plus: { semaines: 2 }')
    .replace("montant: { valeur: 'montant_du_dommage', plus_de: 3000 },", "montant: { valeur: 'date_de_réalisation', plus_de: 3000 }, preuve: [{ piece: 'pieces/08_notification.md', citation: `45.000 euros` }],")), 'erreur').join('\n');
  assert.match(errors, /réduction_due\.si\[0\]\.delai : delai : \{ de: date de départ/);
  assert.match(errors, /réduction_due\.si\[1\]\.preuve : preuve ne se place plus sur une condition de règle.*pour un délai ou un montant : dans valeurs/);
  assert.match(errors, /valeurs\.date_de_réalisation : date_de_réalisation sert à dommage_au_dessus_du_seuil : un nombre attendu/);
});

test('le raisonnement se qualifie drafting ou contentieux ; la qualification appelle la vérification de la validité ou de la prescription', async () => {
  assert.match(texts(await verify(EXAMPLE_CODE), 'manque').join('\n'), /qualification : raisonnement non qualifié/);
  const contractual = texts(await verify(EXAMPLE_CODE.replace('{\n  objectifs:', "{\n  qualification: 'drafting',\n  objectifs:")), 'manque').join('\n');
  assert.match(contractual, /objectifs\[0\] : drafting : vérifier la validité : ajoute validite: 'validité_de_…' sur l’objectif/);
  assert.doesNotMatch(contractual, /non qualifié|prescription/);
  const litigation = texts(await verify(EXAMPLE_CODE.replace('{\n  objectifs:', "{\n  qualification: 'contentieux',\n  objectifs:")), 'manque').join('\n');
  assert.match(litigation, /objectifs\[0\] : contentieux : vérifier la prescription : ajoute prescription:/);
  assert.doesNotMatch(litigation, /vérifier la validité/);
  const valid = await verify(EXAMPLE_CODE.replace('{\n  objectifs:', "{\n  qualification: 'drafting',\n  objectifs:").replace("obtenir: 'pénalité_encourue',", "obtenir: 'pénalité_encourue', validite: 'validité_du_contrat',").replace('\n  hypotheses:', "\n  validité_du_contrat: { sauf: [{ vice_du_consentement: true, selon: [{ source: 'pieces/01_contrat.md', citation: `En cas de retard de livraison` }] }] },\n  vice_du_consentement: { true: [{ preuve: [{ piece: 'pieces/06_mise_en_demeure.md', citation: `vous met en demeure` }] }] },\n  hypotheses:"));
  assert.doesNotMatch(texts(valid, 'manque').join('\n'), /vérifier la validité/);
  assert.deepEqual(texts(valid, 'erreur'), []);
  assert.equal(at(valid.annotated, 'validité_du_contrat.statut'), 'exclu');
  assert.equal(at(valid.annotated, 'objectifs[0].statut'), 'exclu');
  const advice = texts(await verify(EXAMPLE_CODE.replace('{\n  objectifs:', "{\n  qualification: 'consultation',\n  objectifs:")), 'manque').join('\n');
  assert.doesNotMatch(advice, /prescription/);
  assert.match(advice, /décide de la réponse/);
  assert.match(texts(await verify(EXAMPLE_CODE.replace('{\n  objectifs:', "{\n  qualification: 'pénal',\n  objectifs:")), 'erreur').join('\n'), /qualification : qualification : 'drafting', 'contentieux' ou 'consultation'/);
});

test('les contrôles portent un nom préfixé, désigné par leur emplacement ; le fichier revient dans l’ordre canonique', async () => {
  const errors = texts(await verify(EXAMPLE_CODE.replaceAll("applicabilite: 'applicabilité_de_l_article_1231_5'", "applicabilite: 'article_1231_5_applicable'")), 'erreur').join('\n');
  assert.match(errors, /applicabilite : le nom commence par « applicabilité » \(ex\. applicabilité_article_1231_5_applicable\)/);
  assert.match(errors, /applicabilité_de_l_article_1231_5 : applicabilité_de_l_article_1231_5 est un contrôle : désigne-le par applicabilite/);
  assert.match(texts(await verify(EXAMPLE_CODE.replace("au: 'date_de_conclusion_du_contrat' }, applicabilite", "au: 'date_de_conclusion_du_contrat' }, applicabilite: 'applicabilité_inconnue', autre")), 'erreur').join('\n'), /terme applicabilité_inconnue non défini/);
  const result = await verify(EXAMPLE_CODE);
  const keys = Object.keys(result.annotated as object);
  assert.deepEqual(keys.slice(0, 3), ['bilan', 'objectifs', 'pénalité_encourue']);
  assert.ok(keys.indexOf('applicabilité_de_l_article_1231_5') > keys.indexOf('grève'));
  assert.deepEqual(keys.slice(-2), ['valeurs', 'hypotheses']);
  assert.deepEqual(Object.keys(at(result.annotated, 'pénalité_encourue.si[0].selon[0]')).slice(0, 5), ['source', 'citation', 'vigueur', 'applicabilite', 'titre']);
  assert.equal(at(result.annotated, 'bilan.controles'), '1/5 établis');
});

test('en contrat, les faits sont des hypothèses : pas de manque de preuve, mais chaque question a son hypothèse, et les hypothèses reprennent les faits établis', async () => {
  const contractual = await verify(EXAMPLE_CODE.replace('{\n  objectifs:', "{\n  qualification: 'drafting',\n  objectifs:"));
  const manques = texts(contractual, 'manque').join('\n');
  assert.doesNotMatch(manques, /décide de la réponse/);
  assert.ok(at(contractual.annotated, 'objectifs[0].decisifs').length);
  assert.doesNotMatch(manques, /objectif sans hypothèse/);
  assert.match(texts(await verify(EXAMPLE_CODE.replace('{\n  objectifs:', "{\n  qualification: 'drafting',\n  objectifs:").replace(/\n  hypotheses: \[[\s\S]*?\n  \],/, '')), 'manque').join('\n'), /objectifs\[0\] : objectif sans hypothèse : ajoute dans hypotheses un cas dont attendu porte sur pénalité_encourue/);
  assert.match(texts(await verify(EXAMPLE_CODE), 'manque').join('\n'), /décide de la réponse/);
  const inherited = await verify(EXAMPLE_CODE.replace('faits: { retard_de_livraison: vrai, mise_en_demeure: vrai, grève_nationale: vrai }', 'faits: { grève_nationale: vrai }'));
  assert.equal(at(inherited.annotated, 'bilan.hypotheses'), '1/1');
  assert.match(texts(await verify(EXAMPLE_CODE.replace("obtenir: 'pénalité_encourue',", "obtenir: 'validité_du_contrat', validite: 'validité_du_contrat',")), 'erreur').join('\n'), /objectifs\[0\]\.validite : validite : l’objectif porte déjà sur ce contrôle/);
});

test('une clause n’a pas à porter sa vigueur ; le fichier est réécrit dans l’ordre canonique', async () => {
  assert.doesNotMatch(texts(await verify(EXAMPLE_CODE.replaceAll(", vigueur: { debut: '2024-01-15', fin: null }", '')), 'manque').join('\n'), /vigueur non renseignée/);
  const example = parseReasoningDocument(yamlOf(EXAMPLE_CODE)).value as Record<string, unknown>;
  const shuffled = printReasoningDocument({ hypotheses: example.hypotheses, ...example });
  assert.ok(shuffled.startsWith('hypotheses:'));
  const result = await verify(shuffled);
  assert.ok(result.code.indexOf('objectifs:') < result.code.indexOf('pénalité_encourue:'));
  assert.ok(result.code.indexOf('pénalité_encourue:') < result.code.indexOf('applicabilité_de_l_article_1231_5:'));
  assert.ok(result.code.lastIndexOf('hypotheses:') > result.code.indexOf('valeurs:'));
  assert.deepEqual(texts(await verify(result.code), 'erreur'), texts(result, 'erreur'));
});

test('une clause appelle le contrôle de sa validité, qui s’apprécie au regard d’un texte ; une clause qui renvoie à la loi réclame ce texte', async () => {
  const result = await verify(EXAMPLE_CODE);
  const manques = texts(result, 'manque').join('\n');
  assert.match(manques, /pénalité_stipulée\.si\[0\]\.selon\[0\]\.validite : validité de la clause non établie : ajoute validite: 'validité_de_la_clause_retard_de_livraison'/);
  const withValidity = EXAMPLE_CODE.replace("citation: `En cas de retard de livraison`, vigueur: { debut: '2024-01-15', fin: null } }] },", "citation: `En cas de retard de livraison`, vigueur: { debut: '2024-01-15', fin: null }, validite: 'validité_de_la_clause_pénale' }] },").replace('\n  hypotheses:', "\n  validité_de_la_clause_pénale: { sauf: [{ pénalité_manifestement_excessive: true, selon: [{ source: 'pieces/01_contrat.md', citation: `ainsi que les grèves` }] }] },\n  pénalité_manifestement_excessive: { true: [{ preuve: [{ piece: 'pieces/07_courriel.md', citation: `mouvement limité à notre atelier` }] }] },\n  hypotheses:");
  const valid = await verify(withValidity);
  assert.deepEqual(texts(valid, 'erreur'), []);
  assert.match(texts(valid, 'manque').join('\n'), /validité_de_la_clause_pénale : la validité s’apprécie au regard du droit applicable : cite dans ce terme le texte qui la fonde/);
  assert.equal(at(valid.annotated, 'validité_de_la_clause_pénale.statut'), 'exclu');
  assert.equal(at(valid.annotated, 'pénalité_stipulée.si[0].statut'), 'exclu');
  assert.doesNotMatch(texts(valid, 'manque').join('\n'), /validité_de_la_clause_pénale\.sauf\[0\]\.selon\[0\]\.validite/);
  const sourced = await verify(withValidity.replace("selon: [{ source: 'pieces/01_contrat.md', citation: `ainsi que les grèves` }] }] },", "selon: [{ source: 'LEGIARTI000000000005', citation: `Sauf inexécution définitive`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_conclusion_du_contrat' } }] }] },"));
  assert.doesNotMatch(texts(sourced, 'manque').join('\n'), /validité_de_la_clause_pénale : la validité s’apprécie/);
  const referring = await verifyReasoning({
    code: EXAMPLE_CODE.replace('citation: `En cas de retard de livraison`', 'citation: `conformément à l’article 1231-5 du Code civil, en cas de retard`'), cwd: '/dossier-fictif',
    connectors: connectors({ ...EXAMPLE_SOURCES, 'pieces/01_contrat.md': { ...EXAMPLE_SOURCES['pieces/01_contrat.md'], text: `${EXAMPLE_SOURCES['pieces/01_contrat.md'].text} Article 9. Pénalité conformément à l’article 1231-5 du Code civil, en cas de retard.` } }),
    reliability: new Map(), nature: () => null, persons: [], dismissed: new Set(),
  });
  assert.match(texts(referring, 'manque').join('\n'), /pénalité_stipulée\.si\[0\]\.selon\[0\] : la clause renvoie à un texte de loi : ajoute ce texte à selon/);
  assert.doesNotMatch(manques, /la clause renvoie à un texte de loi/);
});

test('les données des calculs sont déclarées dans valeurs, prouvées ou laissées à null ; un seuil en dur est signalé', async () => {
  const undeclared = texts(await cession(CESSION_CODE.replace(/\n    date_de_notification: \{[^\n]*\},/, '')), 'manque').join('\n');
  assert.match(undeclared, /réduction_due\.si\[0\] : date_de_notification n’est pas déclarée : ajoute valeurs: \{ date_de_notification: \{ valeur, preuve \} \} \(valeur: null si le dossier ne la fixe pas\)/);
  const blank = await cession(CESSION_CODE.replace(/date_de_notification: \{[^\n]*\},/, 'date_de_notification: { valeur: null },'));
  assert.deepEqual(texts(blank, 'erreur'), []);
  assert.doesNotMatch(texts(blank, 'manque').join('\n'), /date_de_notification n’est pas déclarée|valeur sans preuve/);
  assert.match(texts(await cession(CESSION_CODE.replace(/date_de_notification: \{ valeur: '2024-02-10', preuve: \[[^\n]*\] \},/, "date_de_notification: { valeur: '2024-02-10' },")), 'manque').join('\n'), /valeurs\.date_de_notification : valeur sans preuve/);
  assert.match(texts(await cession(CESSION_CODE), 'manque').join('\n'), /réduction_due\.si\[1\]\.montant : seuil écrit en dur \(3000\)/);
});

test('une donnée manquante utilisée à plusieurs endroits forme un seul manque, levé partout par sa déclaration', async () => {
  const twice = CESSION_CODE.replace("        decompte: 'décompte_de_la_garantie' },", "        decompte: 'décompte_de_la_garantie' },\n      { notification_dans_les_trois_ans: true, delai: { de: 'date_de_réalisation', a: 'date_de_notification', au_plus: { ans: 3 } },\n        selon: [{ source: 'pieces/02_cession.md', citation: `deux ans à compter de la réalisation`, vigueur: { debut: '2022-06-15', fin: null } }],\n        decompte: 'décompte_de_la_garantie' },");
  assert.notEqual(twice, CESSION_CODE);
  const result = await cession(twice.replace(/\n    date_de_notification: \{[^\n]*\},/, ''));
  const undeclared = result.issues.filter((issue) => issue.text.startsWith('date_de_notification n’est pas déclarée'));
  assert.equal(undeclared.length, 1);
  assert.equal(undeclared[0].path, 'réduction_due.si[0]');
  assert.deepEqual(undeclared[0].ailleurs?.map((other) => other.path), ['réduction_due.si[1]']);
  assert.match(describeReasoning(result), /même cause, aussi : réduction_due › si\[1\] \(ligne \d+\)/);
  assert.doesNotMatch(texts(await cession(twice), 'manque').join('\n'), /date_de_notification n’est pas déclarée/);
});

test('une clause a son propre contrôle de validité ; une clause citée pour l’applicabilité n’en réclame pas', async () => {
  const shared = EXAMPLE_CODE.replace('{\n  objectifs:', "{\n  qualification: 'drafting',\n  objectifs:").replace("obtenir: 'pénalité_encourue',", "obtenir: 'pénalité_encourue', validite: 'validité_du_contrat',").replace("citation: `En cas de retard de livraison`, vigueur: { debut: '2024-01-15', fin: null } }] },", "citation: `En cas de retard de livraison`, vigueur: { debut: '2024-01-15', fin: null }, validite: 'validité_du_contrat' }] },").replace('\n  hypotheses:', "\n  validité_du_contrat: { si: [{ contrat_signé: true, selon: [{ source: 'LEGIARTI000000000005', citation: `Sauf inexécution définitive`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_conclusion_du_contrat' } }] }] },\n  hypotheses:");
  assert.match(texts(await verify(shared), 'erreur').join('\n'), /pénalité_stipulée\.si\[0\]\.selon\[0\]\.validite : validite : validité_du_contrat est le contrôle de validité de l’acte ; une clause a son propre contrôle/);
  const governed = withRoots(EXAMPLE_CODE.replace("citation: `Lorsque le contrat stipule une pénalité`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_conclusion_du_contrat' } }] },", "citation: `Lorsque le contrat stipule une pénalité`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_conclusion_du_contrat' } }] },\n      { droit_français_choisi: true, selon: [{ source: 'pieces/01_contrat.md', citation: `Article 1. Grève` }] },"), "  droit_français_choisi: { true: [{ preuve: [{ piece: 'pieces/01_contrat.md', citation: `Article 1. Grève` }] }] },");
  assert.notEqual(governed, EXAMPLE_CODE);
  const result = await verify(governed);
  assert.deepEqual(texts(result, 'erreur'), []);
  assert.doesNotMatch(texts(result, 'manque').join('\n'), /applicabilité_de_l_article_1231_5\.si\[1\]\.selon\[0\]\.validite/);
});

test('drafting : valeur laissée en blanc, renvois, stipulations contradictoires et formules', async () => {
  const draft = (code: string) => verifyReasoning({
    code: code.replace('{\n  objectifs:', "{\n  qualification: 'drafting',\n  objectifs:"), cwd: '/dossier-fictif',
    connectors: connectors({ ...EXAMPLE_SOURCES, 'pieces/01_contrat.md': { ...EXAMPLE_SOURCES['pieces/01_contrat.md'], text: `${EXAMPLE_SOURCES['pieces/01_contrat.md'].text} Article 9. Prix : [●] euros. Article 10. Aucune pénalité n'est due.` }, 'pieces/02_bareme.md': { kind: 'piece', title: 'Barème (fictif)', text: 'Pénalité de 100 euros par jour.' } }),
    reliability: new Map(), nature: () => null, persons: [], dismissed: new Set(),
  });
  const blanks = await draft(EXAMPLE_CODE.replace("citation: `En cas de retard de livraison`,", "citation: `Prix : [●] euros`,").replace("date_de_conclusion_du_contrat: { valeur: '2024-01-15',", "prix_unitaire: { valeur: null },\n    date_de_conclusion_du_contrat: { valeur: '2024-01-15',"));
  const manques = texts(blanks, 'manque').join('\n');
  assert.doesNotMatch(manques, /pénalité_stipulée\.si\[0\]\.selon\[0\] :/);
  assert.doesNotMatch(manques, /prix_unitaire/);
  const referred = await draft(EXAMPLE_CODE.replace("citation: `En cas de retard de livraison`, vigueur: { debut: '2024-01-15', fin: null } }] },", "citation: `En cas de retard de livraison`, vigueur: { debut: '2024-01-15', fin: null }, renvoi: [{ piece: 'pieces/02_bareme.md', citation: `100 euros par jour` }, { piece: 'pieces/09_annexe_absente.md' }] }] },").replace("citation: `Livré le 14/06/2025` }] }] },", "citation: `Livré le 14/06/2025` }] }], false: [{ preuve: [{ piece: 'pieces/01_contrat.md', citation: `Aucune pénalité n'est due` }] }] },"));
  assert.deepEqual(texts(referred, 'erreur'), []);
  const notes = texts(referred, 'manque').join('\n');
  assert.doesNotMatch(notes, /renvoi\[0\]/);
  assert.match(notes, /renvoi\[1\] : le projet renvoie à un élément absent du dossier \(pieces\/09_annexe_absente\.md\)/);
  assert.match(notes, /retard_de_livraison : retard_de_livraison : fondements contraires, à trancher/);
  assert.equal(at(referred.annotated, 'pénalité_stipulée.si[0].statut'), 'disputé');
  assert.equal(at(referred.annotated, 'retard_de_livraison.statut'), 'disputé');
  const litigation = await verify(EXAMPLE_CODE.replace('{\n  objectifs:', "{\n  qualification: 'contentieux',\n  objectifs:"));
  assert.doesNotMatch(texts(litigation, 'manque').join('\n'), /laissée en blanc/);
  const priced = await cession(CESSION_CODE.replace("    montant_du_dommage:", "    valeur_d_entreprise: { valeur: 50000, preuve: [{ piece: 'pieces/08_notification.md', citation: `dommage de 45.000 euros` }] },\n    dette_nette: { valeur: 5000, preuve: [{ piece: 'pieces/08_notification.md', citation: `dommage de 45.000 euros` }] },\n    prix_calculé: { formule: { produit: [0.9, { difference: ['valeur_d_entreprise', 'dette_nette'] }] } },\n    prix_stipulé: { valeur: 41000, preuve: [{ piece: 'pieces/08_notification.md', citation: `dommage de 45.000 euros` }], formule: { produit: [0.9, { difference: ['valeur_d_entreprise', 'dette_nette'] }] } },\n    montant_du_dommage:"));
  assert.deepEqual(texts(priced, 'erreur'), []);
  assert.equal(at(priced.annotated, 'valeurs.prix_calculé.calcul'), 40500);
  assert.match(texts(priced, 'manque').join('\n'), /valeurs\.prix_stipulé : montant stipulé \(41000\) différent du calcul \(40500\) : à rectifier/);
  assert.match(texts(await cession(CESSION_CODE.replace("    montant_du_dommage:", "    boucle: { formule: { somme: ['boucle', 1] } },\n    montant_du_dommage:")), 'erreur').join('\n'), /valeurs\.boucle\.formule : boucle se calcule à partir d’elle-même/);
});

const FISCAL_SOURCES: Record<string, SourceInfo> = {
  LEGIARTI000000000101: { kind: 'texte', title: 'Code général des impôts fictif, article 150', text: 'Les présentes dispositions s’appliquent aux cessions de titres par les personnes physiques. Le gain net est imposé au taux de 12,8 %. Lorsque le gain excède 50 000 euros, une contribution de 3 % s’applique à la fraction excédant ce montant.', validity: { from: '2018-01-01', to: null } },
  LEGIARTI000000000102: { kind: 'texte', title: 'Code civil fictif, article 1128', text: 'Sont nécessaires à la validité d’un contrat le consentement des parties, leur capacité de contracter et un contenu licite et certain.', validity: { from: '2016-10-01', to: null } },
  'pieces/projet_cession.md': { kind: 'piece', title: 'Projet de cession (fictif)', text: 'Fait le 01/03/2026. Jean Dupont, personne physique, cède ses titres de Société Exemple SAS. Prix : [●] euros. Les titres ont été acquis pour 100 000 euros. Si le prix excède le seuil de 150 000 euros, une réduction est consentie.' },
};
const FISCAL_CODE = `{
  qualification: 'drafting',
  objectifs: [{ objectif: \`Payer le moins d’impôt possible sur la cession de Jean Dupont\`, réduire: 'impôt_dû', validite: 'validité_de_la_cession' }],
  validité_de_la_cession: { si: [{ consentement_des_parties: true, selon: [{ source: 'LEGIARTI000000000102', citation: \`le consentement des parties\`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_cession' }, applicabilite: 'applicabilité_de_l_article_1128' }] }] },
  applicabilité_de_l_article_1128: { si: [{ contrat_de_cession: true, selon: [{ source: 'LEGIARTI000000000102', citation: \`la validité d’un contrat\`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_cession' } }] }] },
  contrat_de_cession: { true: [{ preuve: [{ piece: 'pieces/projet_cession.md', citation: \`cède ses titres\` }] }] },
  applicabilité_de_l_article_150: { si: [{ cession_par_une_personne_physique: true, selon: [{ source: 'LEGIARTI000000000101', citation: \`cessions de titres par les personnes physiques\`, vigueur: { debut: '2018-01-01', fin: null, au: 'date_de_cession' } }] }] },
  cession_par_une_personne_physique: { true: [{ preuve: [{ piece: 'pieces/projet_cession.md', citation: \`Jean Dupont, personne physique\` }] }] },
  valeurs: {
    date_de_cession: { valeur: '2026-03-01', preuve: [{ piece: 'pieces/projet_cession.md', citation: \`Fait le 01/03/2026\` }] },
    prix_de_cession: { valeur: null },
    prix_d_acquisition: { valeur: 100000, preuve: [{ piece: 'pieces/projet_cession.md', citation: \`acquis pour 100 000 euros\` }] },
    gain_net: { formule: { difference: ['prix_de_cession', 'prix_d_acquisition'] } },
    taux_forfaitaire: { valeur: 0.128, selon: [{ source: 'LEGIARTI000000000101', citation: \`imposé au taux de 12,8 %\`, vigueur: { debut: '2018-01-01', fin: null, au: 'date_de_cession' }, applicabilite: 'applicabilité_de_l_article_150' }] },
    impôt_dû: { formule: { arrondi: [{ somme: [{ produit: ['gain_net', 'taux_forfaitaire'] }, { bareme: { assiette: 'gain_net', tranches: [{ jusqu_a: 50000, taux: 0 }, { taux: 0.03 }] } }] }, 0] },
      selon: [{ source: 'LEGIARTI000000000101', citation: \`une contribution de 3 %\`, vigueur: { debut: '2018-01-01', fin: null, au: 'date_de_cession' }, applicabilite: 'applicabilité_de_l_article_150' }] },
  },
  hypotheses: [{ nom: \`prix de 200 000 euros\`, faits: { prix_de_cession: 200000 }, attendu: { impôt_dû: 14300 } }],
}`;
const fiscal = (code: string, simulation?: Record<string, number>) => verifyReasoning({
  code, cwd: '/dossier-fictif', connectors: connectors(FISCAL_SOURCES),
  reliability: new Map(), nature: () => null, persons: [], dismissed: new Set(), ...(simulation ? { simulation } : {}),
});

test('les formules couvrent barème par tranches, minimum, maximum, arrondi et montant conditionnel', () => {
  const lookup = (name: string) => ({ base: 120000, plafond: 30000 } as Record<string, number>)[name] ?? null;
  assert.equal(evaluate({ operation: 'bareme', assiette: 'base', tranches: [{ jusqu_a: 10000, taux: 0 }, { jusqu_a: 100000, taux: 0.1 }, { jusqu_a: null, taux: 0.2 }] }, lookup), 13000);
  assert.equal(evaluate({ operation: 'minimum', termes: [{ operation: 'produit', termes: ['base', 0.3] }, 'plafond'] }, lookup), 30000);
  assert.equal(evaluate({ operation: 'maximum', termes: [0, { operation: 'difference', termes: ['plafond', 'base'] }] }, lookup), 0);
  assert.equal(evaluate({ operation: 'arrondi', termes: [1234.567, 1] }, lookup), 1234.6);
  const regime = { operation: 'si', condition: 'option_pour_le_barème', alors: { operation: 'produit', termes: ['base', 0.3] }, sinon: { operation: 'produit', termes: ['base', 0.128] } } satisfies Formula;
  assert.equal(evaluate(regime, lookup, () => true), 36000);
  assert.equal(evaluate(regime, lookup, () => false), 15360);
  assert.equal(evaluate(regime, lookup, () => null), null);
});

test('une question peut appeler un montant : le taux se source par un texte applicable, le prix en blanc se joue en hypothèses et en simulation', async () => {
  const result = await fiscal(FISCAL_CODE);
  assert.deepEqual(texts(result, 'erreur'), []);
  assert.equal(at(result.annotated, 'valeurs.taux_forfaitaire.statut'), 'acquis');
  assert.equal(at(result.annotated, 'valeurs.taux_forfaitaire.selon[0].en_vigueur'), true);
  assert.equal(at(result.annotated, 'objectifs[0].statut'), 'à établir');
  assert.equal(at(result.annotated, 'objectifs[0].montant_calcule'), null);
  assert.equal(at(result.annotated, 'bilan.hypotheses'), '1/1');
  const manques = texts(result, 'manque').join('\n');
  assert.doesNotMatch(manques, /prix_de_cession|nombres écrits|taux_forfaitaire|applicabilité_de_l_article_150/);
  const alone = await fiscal(FISCAL_CODE.replace(/ {2}hypotheses: \[[^\n]*\],\n/, ''));
  assert.match(texts(alone, 'manque').join('\n'), /valeurs\.prix_de_cession : impôt_dû dépend de prix_de_cession, que le projet ne fixe pas : fixe-la dans valeurs, ou ajoute une hypothèse/);
  const wrong = await fiscal(FISCAL_CODE.replace('attendu: { impôt_dû: 14300 }', 'attendu: { impôt_dû: 14000 }'));
  assert.match(texts(wrong, 'erreur').join('\n'), /hypotheses\[0\] : hypothèse non conforme : obtenu impôt_dû = 14300/);
  const hypothetical = await fiscal(FISCAL_CODE.replace(/\n  cession_par_une_personne_physique: \{[^\n]*\},/, '').replace('faits: { prix_de_cession: 200000 }', 'faits: { prix_de_cession: 200000, cession_par_une_personne_physique: vrai }'));
  assert.equal(at(hypothetical.annotated, 'valeurs.taux_forfaitaire.statut'), 'à établir');
  assert.deepEqual(texts(hypothetical, 'erreur'), []);
  const simulated = await fiscal(FISCAL_CODE, { prix_de_cession: 300000 });
  assert.equal(simulated.simulation?.objectifs[0].montant, 30100);
  assert.equal(simulated.simulation?.valeurs.gain_net, 200000);
  const fixed = await fiscal(FISCAL_CODE.replace('prix_de_cession: { valeur: null },', "prix_de_cession: { valeur: 200000, preuve: [{ piece: 'pieces/projet_cession.md', citation: `cède ses titres` }] },"));
  assert.equal(at(fixed.annotated, 'objectifs[0].montant_calcule'), 14300);
  const unsourced = await fiscal(FISCAL_CODE.replace(", applicabilite: 'applicabilité_de_l_article_150' }] },\n    impôt_dû", " }] },\n    impôt_dû").replace(/\n {6}selon: \[\{ source: 'LEGIARTI000000000101', citation: `une contribution de 3 %`[^\n]*\] \},/, ' },'));
  const gaps = texts(unsourced, 'manque').join('\n');
  assert.match(gaps, /valeurs\.taux_forfaitaire\.selon\[0\]\.applicabilite : applicabilité non établie/);
  assert.match(gaps, /valeurs\.impôt_dû : nombres écrits dans la formule \(50000, 0, 0\.03\)/);
  const misplaced = await fiscal(FISCAL_CODE.replace("taux_forfaitaire: { valeur: 0.128, selon: [{ source: 'LEGIARTI000000000101', citation: `imposé au taux de 12,8 %`", "taux_forfaitaire: { valeur: 0.128, selon: [{ source: 'pieces/projet_cession.md', citation: `Prix : [●] euros`"));
  assert.match(texts(misplaced, 'erreur').join('\n'), /valeurs\.taux_forfaitaire\.selon\[0\]\.source : pieces\/projet_cession\.md est une pièce/);
});

test('drafting : une valeur laissée ouverte n’est un manque que si la réponse en dépend, et des hypothèses qui montrent la bascule le lèvent', async () => {
  const code = (essais: string) => `{
  qualification: 'drafting',
  objectifs: [{ objectif: \`Obtenir une réduction de prix\`, obtenir: 'réduction_due', validite: 'validité_de_la_cession' }],
  réduction_due: { si: [{ prix_supérieur_au_seuil: true, montant: { valeur: 'prix_de_cession', plus_de: 'seuil_de_réduction' }, selon: [{ source: 'pieces/projet_cession.md', citation: \`Si le prix excède le seuil\` }] }] },
  validité_de_la_cession: { si: [{ consentement_des_parties: true, selon: [{ source: 'LEGIARTI000000000102', citation: \`le consentement des parties\`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_cession' } }] }] },
  valeurs: {
    date_de_cession: { valeur: '2026-03-01', preuve: [{ piece: 'pieces/projet_cession.md', citation: \`Fait le 01/03/2026\` }] },
    prix_de_cession: { valeur: null },
    seuil_de_réduction: { valeur: 150000, preuve: [{ piece: 'pieces/projet_cession.md', citation: \`seuil de 150 000 euros\` }] },
    nom_du_notaire: { valeur: null },
  },
  hypotheses: [${essais}],
}`;
  const low = '{ nom: `prix bas`, faits: { prix_de_cession: 100000 }, attendu: { réduction_due: faux } }';
  const high = '{ nom: `prix haut`, faits: { prix_de_cession: 200000 }, attendu: { réduction_due: vrai } }';
  const once = await fiscal(code(low));
  const gaps = texts(once, 'manque').join('\n');
  assert.match(gaps, /réduction_due\.si\[0\] : prix_supérieur_au_seuil décide de la réponse et dépend de prix_de_cession, que le projet ne fixe pas/);
  assert.doesNotMatch(gaps, /nom_du_notaire/);
  const both = await fiscal(code(`${low}, ${high}`));
  assert.deepEqual(texts(both, 'erreur'), []);
  assert.doesNotMatch(texts(both, 'manque').join('\n'), /prix_de_cession/);
});

test('consultation : des hypothèses lèvent le manque d’une valeur ouverte, pas celui d’un fait décisif sans pièce ; l’ancienne clé essais est refusée', async () => {
  const consult = (code: string) => fiscal(code.replace("qualification: 'drafting'", "qualification: 'consultation'"));
  const covered = await consult(FISCAL_CODE);
  assert.doesNotMatch(texts(covered, 'manque').join('\n'), /dépend de prix_de_cession/);
  const bare = await consult(FISCAL_CODE.replace(/ {2}hypotheses: \[[^\n]*\],\n/, ''));
  assert.match(texts(bare, 'manque').join('\n'), /valeurs\.prix_de_cession : impôt_dû dépend de prix_de_cession : renseigne-la dans valeurs, avec sa preuve \(pièce\) ou sa source \(selon : texte\), ou ajoute une hypothèse/);
  assert.match(texts(await fiscal(FISCAL_CODE.replace('  hypotheses: [', '  essais: [')), 'erreur').join('\n'), /essais : la clé essais s’appelle hypotheses/);
});

test('un objectif oriente le raisonnement : le vérificateur désigne ce qui y fait obstacle et les objectifs en tension', async () => {
  const excused = withRoots(EXAMPLE_CODE, "  grève_nationale: { true: [{ preuve: [{ piece: 'pieces/07_courriel.md', citation: `mouvement limité à notre atelier` }] }] },");
  const sought = await verify(excused);
  assert.equal(at(sought.annotated, 'objectifs[0].atteint'), false);
  assert.ok(at(sought.annotated, 'objectifs[0].obstacles').includes('grève_nationale'));
  const gaps = texts(sought, 'manque').join('\n');
  assert.match(gaps, /grève\.si\[0\]\.l_une\[0\] : grève_nationale fait obstacle à l’objectif « Obtenir de Société Beta SARL le paiement de la pénalité de retard » : conteste-le \(une pièce sous false\)/);
  assert.match(gaps, /pénalité_stipulée\.sauf\[0\] : la source de force_majeure_contractuelle fait obstacle à l’objectif/);
  const avoided = await verify(excused.replace("obtenir: 'pénalité_encourue'", "écarter: 'pénalité_encourue'"));
  assert.equal(at(avoided.annotated, 'objectifs[0].atteint'), true);
  assert.doesNotMatch(texts(avoided, 'manque').join('\n'), /objectif/);
  assert.match(texts(await verify(EXAMPLE_CODE.replace("obtenir: 'pénalité_encourue'", "réduire: 'pénalité_encourue'")), 'erreur').join('\n'), /objectifs\[0\]\.réduire : pénalité_encourue est un terme vrai\/faux : utilise obtenir ou écarter/);
  assert.match(texts(await verify(EXAMPLE_CODE.replace("obtenir: 'pénalité_encourue',", "obtenir: 'pénalité_encourue', écarter: 'grève',")), 'erreur').join('\n'), /objectifs\[0\] : un seul verbe/);
  const legacy = texts(await verify(EXAMPLE_CODE.replace('objectifs: [', 'questions: [')), 'erreur').join('\n');
  assert.match(legacy, /questions : la clé questions s’appelle objectifs/);
  assert.match(texts(await verify(EXAMPLE_CODE.replace("obtenir: 'pénalité_encourue',", "obtenir: 'pénalité_encourue', reponse: 'pénalité_encourue',")), 'erreur').join('\n'), /objectifs\[0\]\.reponse : reponse est remplacée par le verbe/);

  const tension = await fiscal(`{
  qualification: 'consultation',
  objectifs: [
    { objectif: \`Payer le moins d’impôt possible\`, réduire: 'impôt_dû' },
    { objectif: \`Rester dirigeant de Société Exemple SAS\`, obtenir: 'qualité_de_dirigeant' },
  ],
  qualité_de_dirigeant: { si: [{ mandat_social: true, selon: [{ source: 'pieces/projet_cession.md', citation: \`cède ses titres\` }] }] },
  mandat_social: { true: [{ preuve: [{ piece: 'pieces/projet_cession.md', citation: \`Jean Dupont, personne physique\` }] }] },
  valeurs: {
    gain: { valeur: 100000, preuve: [{ piece: 'pieces/projet_cession.md', citation: \`acquis pour 100 000 euros\` }] },
    impôt_dû: { formule: { si: 'mandat_social', alors: { produit: ['gain', 0.3] }, sinon: { produit: ['gain', 0.128] } } },
  },
}`);
  assert.deepEqual(texts(tension, 'erreur'), []);
  assert.match(texts(tension, 'manque').join('\n'), /qualité_de_dirigeant\.si\[0\] : mandat_social fait obstacle à l’objectif « Payer le moins d’impôt possible » : conteste-le .* ; en tension avec l’objectif « Rester dirigeant de Société Exemple SAS » : à arbitrer/);
  assert.equal(at(tension.annotated, 'objectifs[1].atteint'), true);
});

const DISPUTED = (code: string) => code.replace("citation: `Livré le 14/06/2025` }] }] },", "citation: `Livré le 14/06/2025` }] }], false: [{ preuve: [{ piece: 'pieces/07_courriel.md', citation: `a duré deux jours` }] }] },");

test('un fait prouvé sous true et sous false est disputé : statut, manque automatique et doute propagé', async () => {
  const result = await verify(DISPUTED(EXAMPLE_CODE));
  assert.deepEqual(texts(result, 'erreur'), []);
  assert.equal(at(result.annotated, 'retard_de_livraison.statut'), 'disputé');
  assert.equal(at(result.annotated, 'retard_de_livraison.true[0].statut'), 'acquis');
  assert.equal(at(result.annotated, 'retard_de_livraison.false[0].statut'), 'acquis');
  assert.equal(at(result.annotated, 'pénalité_stipulée.si[0].statut'), 'disputé');
  assert.equal(at(result.annotated, 'objectifs[0].statut'), 'à établir');
  assert.ok(at(result.annotated, 'objectifs[0].decisifs').includes('retard_de_livraison'));
  const issue = result.issues.find((entry) => entry.text === 'retard_de_livraison : fondements contraires, à trancher')!;
  assert.equal(issue.kind, 'manque');
  assert.equal(issue.path, 'retard_de_livraison');
  assert.equal(issue.avocat, 'Retard de livraison : des fondements contraires sont établis, à trancher.');
  assert.doesNotMatch(texts(result, 'manque').join('\n'), /retard_de_livraison décide de la réponse/);
  assert.match(result.log.find((entry) => entry.key === 'fait:retard_de_livraison')!.text, /^Disputé/);
  assert.deepEqual(texts(await verify(EXAMPLE_CODE), 'manque').filter((text) => text.includes('fondements contraires')), []);
});

const LAW = (settled: string) => `{
  qualification: 'consultation',
  objectifs: [{ objectif: \`Obtenir un effet fictif\`, obtenir: 'effet_fictif' }],
  valeurs: {
    date_de_conclusion_du_contrat: { valeur: '2024-01-15', preuve: [{ piece: 'pieces/01_contrat.md', citation: \`Fait le 15/01/2024\` }] },
  },
  effet_fictif: {
    si: [
      { question_de_droit: true,
        selon: [{ source: 'LEGIARTI000000000005', citation: \`Lorsque le contrat stipule une pénalité\`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_conclusion_du_contrat' } }] },
    ],
  },
  question_de_droit: {
    true: [{ selon: [{ source: 'LEGIARTI000000000005', citation: \`Lorsque le contrat stipule une pénalité\`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_conclusion_du_contrat' } }] }],
    false: [{ selon: [{ source: 'LEGIARTI000000000005', citation: \`Sauf inexécution définitive\`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_conclusion_du_contrat' } }], si: [{ fait_incertain: true }] }],
  },
  fait_incertain: ${settled},
}`;
const BOTH = "{ true: [{ preuve: [{ piece: 'pieces/05_bon_de_livraison.md', citation: `Livré le 14/06/2025` }] }], false: [{ preuve: [{ piece: 'pieces/07_courriel.md', citation: `a duré deux jours` }] }] }";

test('une question de droit dont un fondement false dépend d’une condition disputée reste incertaine', async () => {
  const doubtful = await verify(LAW(BOTH));
  assert.deepEqual(texts(doubtful, 'erreur'), []);
  assert.equal(at(doubtful.annotated, 'fait_incertain.statut'), 'disputé');
  assert.equal(at(doubtful.annotated, 'question_de_droit.true[0].statut'), 'acquis');
  assert.equal(at(doubtful.annotated, 'question_de_droit.false[0].statut'), 'à établir');
  assert.equal(at(doubtful.annotated, 'question_de_droit.statut'), 'à établir');
  assert.equal(at(doubtful.annotated, 'effet_fictif.statut'), 'à établir');
  assert.equal(at(doubtful.annotated, 'objectifs[0].statut'), 'à établir');
  assert.doesNotMatch(texts(doubtful, 'manque').join('\n'), /question_de_droit : fondements contraires/);
  const refuted = await verify(LAW("{ false: [{ preuve: [{ piece: 'pieces/07_courriel.md', citation: `a duré deux jours` }] }] }"));
  assert.equal(at(refuted.annotated, 'question_de_droit.false[0].statut'), 'exclu');
  assert.equal(at(refuted.annotated, 'question_de_droit.statut'), 'acquis');
  assert.equal(at(refuted.annotated, 'objectifs[0].statut'), 'acquis');
  const opposed = await verify(LAW("{ true: [{ preuve: [{ piece: 'pieces/05_bon_de_livraison.md', citation: `Livré le 14/06/2025` }] }] }"));
  assert.equal(at(opposed.annotated, 'question_de_droit.statut'), 'disputé');
  assert.ok(opposed.issues.some((issue) => issue.kind === 'manque' && issue.text === 'question_de_droit : fondements contraires, à trancher'));
});

const VOTE = (approval: string) => `{
  qualification: 'consultation',
  objectifs: [{ objectif: \`Obtenir le versement de l’indemnité\`, obtenir: 'indemnité_exigible' }],
  valeurs: {
    date_de_conclusion_du_contrat: { valeur: '2024-01-15', preuve: [{ piece: 'pieces/01_contrat.md', citation: \`Fait le 15/01/2024\` }] },
  },
  indemnité_exigible: {
    si: [
      { l_une: [{ indemnité_soumise_au_vote_ex_post: false }, { approbation_ex_post_obtenue: true }],
        selon: [{ source: 'LEGIARTI000000000005', citation: \`Lorsque le contrat stipule une pénalité\`, vigueur: { debut: '2016-10-01', fin: null, au: 'date_de_conclusion_du_contrat' } }] },
    ],
  },
  indemnité_soumise_au_vote_ex_post: ${BOTH},
  approbation_ex_post_obtenue: { ${approval}: [{ preuve: [{ piece: 'pieces/06_mise_en_demeure.md', citation: \`vous met en demeure\` }] }] },
  hypotheses: [
    { nom: \`soumise au vote\`, faits: { indemnité_soumise_au_vote_ex_post: vrai }, attendu: { indemnité_exigible: faux } },
    { nom: \`hors du champ du vote\`, faits: { indemnité_soumise_au_vote_ex_post: faux }, attendu: { indemnité_exigible: vrai } },
  ],
}`;

test('une alternative entre une question disputée et une approbation établie fausse laisse l’objectif en suspens, la question est décisive et les hypothèses la font basculer', async () => {
  const result = await verify(VOTE('false'));
  assert.deepEqual(texts(result, 'erreur'), []);
  assert.equal(at(result.annotated, 'approbation_ex_post_obtenue.statut'), 'exclu');
  assert.equal(at(result.annotated, 'indemnité_soumise_au_vote_ex_post.statut'), 'disputé');
  assert.equal(at(result.annotated, 'indemnité_exigible.si[0].l_une[0].statut'), 'disputé');
  assert.equal(at(result.annotated, 'indemnité_exigible.si[0].l_une[1].statut'), 'exclu');
  assert.equal(at(result.annotated, 'objectifs[0].statut'), 'à établir');
  assert.deepEqual(at(result.annotated, 'objectifs[0].decisifs'), ['indemnité_soumise_au_vote_ex_post']);
  assert.equal(at(result.annotated, 'indemnité_exigible.si[0].l_une[0].decisif'), true);
  assert.equal(at(result.annotated, 'bilan.hypotheses'), '2/2');
  assert.ok(result.issues.some((issue) => issue.kind === 'manque' && issue.text === 'indemnité_soumise_au_vote_ex_post : fondements contraires, à trancher'));
  const approved = await verify(VOTE('true'));
  assert.equal(at(approved.annotated, 'objectifs[0].statut'), 'acquis');
  assert.equal(at(approved.annotated, 'objectifs[0].decisifs'), undefined);
  const simulated = await verifyReasoning({ code: VOTE('false'), cwd: '/dossier-fictif', connectors: connectors(), reliability: new Map(), nature: () => null, persons: [], dismissed: new Set(), simulation: { indemnité_soumise_au_vote_ex_post: false } });
  assert.equal(simulated.simulation?.objectifs[0].statut, 'acquis');
  const inverse = await verifyReasoning({ code: VOTE('false'), cwd: '/dossier-fictif', connectors: connectors(), reliability: new Map(), nature: () => null, persons: [], dismissed: new Set(), simulation: { indemnité_soumise_au_vote_ex_post: true } });
  assert.equal(inverse.simulation?.objectifs[0].statut, 'exclu');
  const wrong = await verify(VOTE('false').replace('attendu: { indemnité_exigible: vrai }', 'attendu: { indemnité_exigible: faux }'));
  assert.match(texts(wrong, 'erreur').join('\n'), /hypotheses\[1\] : hypothèse non conforme : obtenu indemnité_exigible = vrai/);
});

test('les anciennes écritures sont des erreurs de migration qui disent où écrire', async () => {
  const errors = async (code: string) => texts(await verify(code), 'erreur').join('\n');
  assert.match(await errors(EXAMPLE_CODE.replace('{ force_majeure: true }', "{ force_majeure: true, contredit: [{ piece: 'pieces/07_courriel.md', citation: `a duré deux jours` }] }")), /contredit n’existe plus : écris la pièce en preuve sous nom: \{ false: \[\{ preuve/);
  assert.match(await errors(EXAMPLE_CODE.replace("citation: `En cas de retard de livraison`, vigueur: { debut: '2024-01-15', fin: null } }]", "citation: `En cas de retard de livraison`, vigueur: { debut: '2024-01-15', fin: null }, contredit: [{ piece: 'pieces/01_contrat.md', citation: `Aucune pénalité n'est due` }] }]")), /selon\[0\]\.contredit : contredit n’existe plus.*deux fondements de valeurs opposées/);
  assert.match(await errors(EXAMPLE_CODE.replace('{ pénalité_stipulée: true,', "{ condition: 'pénalité_stipulée',")), /pénalité_encourue\.si\[0\]\.condition : condition: nom n’existe plus : écris pénalité_stipulée: true \(ou pénalité_stipulée: false\)/);
  assert.match(await errors(EXAMPLE_CODE.replace('{ pénalité_stipulée: true,', "{ pénalité_stipulée: true, preuve: [{ piece: 'pieces/01_contrat.md', citation: `une pénalité est due` }],")), /pénalité_encourue\.si\[0\]\.preuve : preuve ne se place plus sur une condition de règle : place-la sous la valeur qu’elle établit, à la racine/);
  assert.match(await errors(EXAMPLE_CODE.replace('{ pénalité_stipulée: true,', "{ pénalité_stipulée: `oui`,")), /pénalité_encourue\.si\[0\]\.pénalité_stipulée : pénalité_stipulée : true ou false attendu/);
  assert.match(await errors(EXAMPLE_CODE.replace('{ pénalité_stipulée: true,', "{ pénalité_stipulée: null,")), /pénalité_stipulée : true ou false attendu/);
  assert.match(await errors(EXAMPLE_CODE.replace('{ pénalité_stipulée: true,', '{ pénalité_stipulée: true, autre_condition: true,')), /exactement une clé nom: true\|false \(trouvé : pénalité_stipulée, autre_condition\)/);
  assert.match(await errors(EXAMPLE_CODE.replace('{ pénalité_stipulée: true,', '{')), /pénalité_encourue\.si\[0\] : condition : - nom de la condition: true/);
  assert.match(await errors(EXAMPLE_CODE.replace("mise_en_demeure: { true: [{ preuve", "mise_en_demeure: { si: [], true: [{ preuve")), /mise_en_demeure mêle si\/sauf et true\/false/);
  assert.match(await errors(EXAMPLE_CODE.replace("mise_en_demeure: { true: [{ preuve: [{ piece: 'pieces/06_mise_en_demeure.md', citation: `vous met en demeure` }] }] },", "mise_en_demeure: { true: [{ si: [{ retard_de_livraison: vrai }] }] },")), /mise_en_demeure\.true\[0\] : fondement : \{ preuve/);
  assert.match(await errors(EXAMPLE_CODE.replace("mise_en_demeure: { true: [{ preuve", "mise_en_demeure: { true: [{ contredit: [], preuve")), /mise_en_demeure\.true\[0\]\.contredit : contredit n’existe plus/);
  assert.match(await errors(EXAMPLE_CODE.replace("date_de_conclusion_du_contrat: { valeur: '2024-01-15',", "date_de_conclusion_du_contrat: { valeur: '2024-01-15', contredit: [],")), /valeurs\.date_de_conclusion_du_contrat\.contredit : contredit n’existe plus/);
  const rewritten = await verify(EXAMPLE_CODE);
  assert.doesNotMatch(rewritten.code, /contredit|condition:/);
});
