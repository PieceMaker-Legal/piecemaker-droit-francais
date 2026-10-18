import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { EXAMPLE_CODE, EXAMPLE_SOURCES, createReasoningService, describeReasoning, verifyReasoning } from '../program.js';
import type { ReasoningConnectors, SourceInfo } from '../program.js';
import { parseLiteral } from '../format.js';

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
  assert.equal(at(result.annotated, 'questions[0].statut'), 'à établir');
  assert.deepEqual(at(result.annotated, 'questions[0].decisifs'), ['force_majeure', 'greve_nationale']);
  assert.deepEqual(at(result.annotated, 'questions[0].personnes'), ['Société Beta SARL']);
  assert.equal(at(result.annotated, 'penalite_stipulee.si[0].statut'), 'acquis');
  assert.equal(at(result.annotated, 'greve.si[0].l_une[1].statut'), 'exclu');
  assert.equal(at(result.annotated, 'force_majeure_contractuelle.si[0].l_une[0].decisif'), true);
  assert.equal(at(result.annotated, 'bilan.essais'), '1/1');
  assert.equal(at(result.annotated, 'penalite_encourue.si[0].selon[0].titre'), 'Code civil fictif, article 1231-5');
  assert.equal(at(result.annotated, 'penalite_encourue.si[0].selon[0].en_vigueur'), true);
  assert.match(describeReasoning(result), /decisifs: \[`force_majeure`, `greve_nationale`\]/);
});

test('toutes les feuilles établies : la réponse est acquise ; la preuve de l’exception l’exclut', async () => {
  const closed = EXAMPLE_CODE
    .replace("{ condition: 'force_majeure' }", "{ condition: 'force_majeure', contredit: [{ piece: 'pieces/07_courriel.md', citation: `a duré deux jours` }] }")
    .replace("{ condition: 'greve_nationale' }", "{ condition: 'greve_nationale', contredit: [{ piece: 'pieces/07_courriel.md', citation: `mouvement limité à notre atelier` }] }");
  assert.equal(at((await verify(closed)).annotated, 'questions[0].statut'), 'acquis');
  const excused = EXAMPLE_CODE.replace("{ condition: 'greve_nationale' }", "{ condition: 'greve_nationale', preuve: [{ piece: 'pieces/07_courriel.md', citation: `mouvement limité à notre atelier` }] }");
  assert.equal(at((await verify(excused)).annotated, 'questions[0].statut'), 'exclu');
});

test('une citation à la ponctuation près est validée et remplacée par l’original ; une citation fausse est une erreur', async () => {
  const comma = await verify(EXAMPLE_CODE.replace('`Sauf inexécution définitive`', '`Sauf, inexécution définitive`'));
  assert.equal(at(comma.annotated, 'penalite_encourue.si[1].selon[0].corrigee'), true);
  assert.equal(at(comma.annotated, 'penalite_encourue.si[1].selon[0].citation'), 'Sauf inexécution définitive');
  assert.match(comma.code, /`Sauf inexécution définitive`/);
  const wrong = await verify(EXAMPLE_CODE.replace('`Sauf inexécution définitive`', '`Sauf exécution partielle`'));
  assert.match(texts(wrong, 'erreur').join('\n'), /penalite_encourue\.si\[1\]\.selon\[0\] : citation introuvable/);
});

test('la vigueur est une condition : absente c’est un manque, fausse une erreur, dépassée la condition est exclue', async () => {
  const missing = await verify(EXAMPLE_CODE.replace("débiteur est mis en demeure`, vigueur: { debut: '2016-10-01', fin: null }", 'débiteur est mis en demeure`'));
  assert.match(texts(missing, 'manque').join('\n'), /penalite_encourue\.si\[0\]\.selon\[0\]\.vigueur : vigueur non renseignée.*debut '2016-10-01'/);
  assert.deepEqual(texts(missing, 'erreur'), []);
  const differs = await verify(EXAMPLE_CODE.replace("débiteur est mis en demeure`, vigueur: { debut: '2016-10-01'", "débiteur est mis en demeure`, vigueur: { debut: '2016-02-10'"));
  assert.match(texts(differs, 'erreur').join('\n'), /vigueur différente de la version citée : debut '2016-10-01'/);
  const late = await verify(EXAMPLE_CODE.replace("valeur: '2025-06-14'", "valeur: '2015-06-14'"));
  assert.equal(at(late.annotated, 'questions[0].statut'), 'exclu');
  assert.match(texts(late, 'erreur').join('\n'), /n’est en vigueur à la date d’application/);
});

test('une condition sans source, un terme non défini, une boucle et un essai non conforme sont des erreurs', async () => {
  const errors = texts(await verify(`{
    questions: [{ question: \`Question fictive ?\`, reponse: 'a' }, { question: \`Autre ?\`, reponse: 'absent' }],
    a: { si: [{ condition: 'b', selon: [{ source: 'LEGIARTI000000000005', citation: \`Sauf inexécution définitive\` }] }, { condition: 'c' }] },
    b: { si: [{ condition: 'a', selon: [{ source: 'LEGIARTI000000000005', citation: \`Sauf inexécution définitive\` }] }] },
    essais: [{ nom: \`faux\`, faits: { c: vrai }, attendu: { c: faux } }],
  }`), 'erreur').join('\n');
  assert.match(errors, /a\.si\[1\]\.selon : condition sans source/);
  assert.match(errors, /questions\[1\]\.reponse : terme absent non défini/);
  assert.match(errors, /boucle : a → b → a/);
});

test('un essai rejoue le droit seul et signale un résultat contraire à l’attendu', async () => {
  const result = await verify(EXAMPLE_CODE.replace('attendu: { penalite_encourue: faux }', 'attendu: { penalite_encourue: vrai }'));
  assert.equal(at(result.annotated, 'essais[0].conforme'), false);
  assert.match(texts(result, 'erreur').join('\n'), /essais\[0\] : essai non conforme : obtenu penalite_encourue = faux/);
});

test('une source d’un autre droit est acceptée mais signalée comme non vérifiable', async () => {
  const result = await verify(EXAMPLE_CODE.replace("source: 'LEGIARTI000000000005', citation: `Sauf inexécution définitive`", "source: 'CELEX:00000X0000', citation: `Sauf inexécution définitive`"));
  assert.match(texts(result, 'manque').join('\n'), /source non vérifiable automatiquement : aucun connecteur pour CELEX:00000X0000/);
  assert.deepEqual(texts(result, 'erreur'), []);
});

test('une pièce non fiable ne prouve rien ; une pièce non évaluée est signalée', async () => {
  const result = await verify(EXAMPLE_CODE, { reliability: new Map([['pieces/06_mise_en_demeure.md', false]]) });
  assert.equal(at(result.annotated, 'penalite_encourue.si[1].l_une[0].statut'), 'à établir');
  assert.equal(at(result.annotated, 'penalite_encourue.si[1].l_une[0].preuve[0].fiable'), false);
  assert.ok(!at(result.annotated, 'bilan.pieces_a_evaluer_par_l_avocat').includes('pieces/06_mise_en_demeure.md'));
  assert.ok(at(result.annotated, 'bilan.pieces_a_evaluer_par_l_avocat').includes('pieces/07_courriel.md'));
});

test('une alerte écartée par l’avocat n’est plus émise, et revient si l’élément change', async () => {
  const first = await verify(EXAMPLE_CODE);
  const target = first.issues.find((issue) => issue.text.startsWith('force_majeure décide'))!;
  const dismissed = await verify(EXAMPLE_CODE, { dismissed: new Set([target.id]) });
  assert.equal(at(dismissed.annotated, 'bilan.ecartees'), 1);
  assert.equal(at(dismissed.annotated, 'force_majeure_contractuelle.si[0].l_une[0].manques'), undefined);
  const changed = await verify(EXAMPLE_CODE.replace("condition: 'force_majeure' }", "condition: 'cas_de_force_majeure' }"), { dismissed: new Set([target.id]) });
  assert.equal(at(changed.annotated, 'bilan.ecartees'), 0);
});

test('le service lit le fichier du dossier, corrige les citations, enregistre les décisions de l’avocat', async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'raisonnement-'));
  fs.mkdirSync(path.join(folder, '.piecemaker'));
  const file = path.join(folder, '.piecemaker', 'raisonnement.js');
  fs.writeFileSync(file, EXAMPLE_CODE.replace('`Sauf inexécution définitive`', '`sauf inexécution définitive`'));
  const db = new Database(':memory:');
  db.exec('CREATE TABLE projects(project_id TEXT PRIMARY KEY, project_path TEXT);');
  db.prepare('INSERT INTO projects VALUES(?,?)').run('fictif', folder);
  t.after(() => { db.close(); fs.rmSync(folder, { recursive: true, force: true }); });
  const service = createReasoningService(() => db, connectors());
  db.prepare('INSERT INTO pm_reasoning_programs VALUES(?,?,?,?)').run('fictif', 3, 'ancien format', JSON.stringify({ code: 'ancien format', questions: [] }));
  assert.equal(service.read(folder).code, '');
  const text = await service.command(folder, { commande: 'verifier' });
  assert.match(text, /^\{\n {2}bilan: \{/);
  assert.match(fs.readFileSync(file, 'utf8'), /`Sauf inexécution définitive`/);
  const issue = service.read(folder).issues.find((entry) => entry.kind === 'manque')!;
  assert.equal((await service.dismiss(folder, issue.id)).dismissed.length, 1);
  assert.equal((await service.dismiss(folder, issue.id, true)).dismissed.length, 0);
  assert.equal((await service.rate(folder, 'pieces/06_mise_en_demeure.md', false)).reliability[0].reliable, false);
  await assert.rejects(service.command(folder, { commande: 'condition' }), /Commande : verifier/);
  fs.rmSync(file);
  await assert.rejects(service.verify(folder), /Aucun raisonnement/);
});

test('le test se déroule ligne par ligne : sources, pièces, faits, termes, essais, réponse', async () => {
  const seen: string[] = [];
  const result = await verifyReasoning({
    code: EXAMPLE_CODE, cwd: '/dossier-fictif', connectors: connectors(), reliability: new Map(), nature: () => null,
    persons: [], dismissed: new Set(), emit: (entry) => seen.push(`${entry.step}:${entry.status}`),
  });
  assert.ok(seen.indexOf('source:en cours') < seen.indexOf('source:ok'));
  assert.deepEqual([...new Set(result.log.map((entry) => entry.step))], ['source', 'pièce', 'fait', 'condition', 'essai', 'réponse']);
  assert.match(result.log.find((entry) => entry.key === 'fait:retard_de_livraison')!.text, /Prouvé par Bon de livraison \(fictif\)/);
  assert.match(result.log.find((entry) => entry.step === 'réponse')!.text, /Réponse : à établir · reste à établir : force majeure, greve nationale/);
});
