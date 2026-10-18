import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import type { ReasoningSource } from '../../../../shared/piecemaker-reasoning.js';
import { parseCatala, printCatala } from '../catala.js';
import { evaluateReasoning } from '../evaluate.js';
import { createReasoningService, reasoningExample } from '../program.js';
import type { TurnSource } from '../program.js';

function fixture(t: test.TestContext, folder = '/dossier-fictif') {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE projects(project_id TEXT PRIMARY KEY, project_path TEXT);');
  db.prepare('INSERT INTO projects VALUES(?,?)').run('example', folder);
  const service = createReasoningService(() => db);
  t.after(() => db.close());
  return { db, service };
}

const article: ReasoningSource = { id: 'sart0001', kind: 'article', document: 'article:LEGIARTI000000000001', title: 'Code fictif, article 1', excerpt: 'Texte fictif.', token: '', verified: true, repaired: false, validity: { from: '2020-01-01', to: null } };
const decision: ReasoningSource = { id: 'sjur0001', kind: 'case', document: 'case:JURITEXT000000000001', title: 'Cass. fictive', excerpt: 'Motif fictif.', token: '', verified: true, repaired: false, history: { status: 'non remise en cause', lines: [] } };
const doctrine: ReasoningSource = { id: 'sdoc0001', kind: 'document', document: 'document:doctrine/note.md', title: 'Note fictive', excerpt: 'Opinion fictive.', token: '', verified: true, repaired: false };
const piece: ReasoningSource = { id: 'spie0001', kind: 'document', document: 'document:pieces/pv.md', title: 'PV fictif', excerpt: 'Approuvé.', token: '', verified: true, repaired: false };

const code = (dossier: string, ruleSources = 'sart0001') => `#[question = "Le versement est-il dû ?"]
#[date_de_référence = date_acte]
déclaration champ d'application Q:
  entrée date_acte contenu date
  entrée approuve contenu booléen
  interne approbation condition
  résultat du condition
champ d'application Q:
  #[libellé = "Approbation"] #[selon = ${ruleSources}]
  règle approbation sous condition approuve conséquence rempli
  #[selon = sart0001]
  règle du sous condition approbation conséquence rempli
déclaration champ d'application Dossier:
  q champ Q
champ d'application Dossier:
${dossier}`;

const facts = `  #[selon = spie0001] #[force = acte_sous_seing_privé]
  définition q.date_acte égal à |2024-03-01|
  #[selon = spie0001] #[force = acte_sous_seing_privé] #[appréciation = "PV signé"]
  définition q.approuve égal à vrai
`;

const run = (text: string, sources: ReasoningSource[] = [article, decision, doctrine, piece]) => evaluateReasoning(parseCatala(text), new Map(sources.map((source) => [source.id, source])), new Map());

test('le code Catala se réimprime à l’identique après analyse', () => {
  const printed = printCatala(parseCatala(code(facts)));
  assert.equal(printCatala(parseCatala(printed)), printed);
  assert.match(printed, /règle approbation sous condition approuve conséquence rempli/);
  const expression = printCatala(parseCatala("déclaration champ d'application A:\n  entrée x contenu entier\n  interne y contenu booléen\nchamp d'application A:\n  définition y égal à non (x > 2 et x < 5) ou x = 1\n"));
  assert.match(expression, /définition y égal à non \(x > 2 et x < 5\) ou x = 1/);
});

test('une question complète, en vigueur et prouvée par pièces, est remplie', () => {
  const result = run(code(facts));
  const question = result.questions[0];
  assert.equal(question.valid, true, question.issues.join(' '));
  assert.equal(question.status, 'remplie');
  assert.deepEqual(question.vigueur, [{ source: 'sart0001', date: '2024-03-01', inForce: true }]);
  assert.equal(result.conditions.find((condition) => condition.id === 'Q.approbation')!.strength, 'loi');
  assert.equal(result.facts.find((fact) => fact.id === 'Q.approuve')!.status, 'établi');
});

test('un article non en vigueur à la date de référence rend la condition non remplie', () => {
  const result = run(code(facts.replace('2024-03-01', '2019-06-01')));
  const condition = result.conditions.find((entry) => entry.id === 'Q.approbation')!;
  assert.equal(condition.status, 'non remplie');
  assert.match(condition.issues.join(' '), /non en vigueur au 2019-06-01/);
});

test('un fait sans pièce reste non établi et rend la question indéterminée', () => {
  const result = run(code(facts.split('\n').slice(0, 2).join('\n')));
  const fact = result.facts.find((entry) => entry.id === 'Q.approuve')!;
  assert.equal(fact.status, 'non établi');
  assert.match(fact.issues.join(' '), /Pièce à rechercher/);
  assert.equal(result.questions[0].status, 'indéterminée');
});

test('une pièce sans valeur probante ou un extrait introuvable n’établit pas le fait', () => {
  assert.equal(run(code(facts.replace('#[force = acte_sous_seing_privé] #[appréciation', '#[force = sans_valeur] #[appréciation'))).facts.find((fact) => fact.id === 'Q.approuve')!.status, 'non établi');
  const unverified = run(code(facts), [article, { ...piece, verified: false }]).facts.find((fact) => fact.id === 'Q.approuve')!;
  assert.equal(unverified.status, 'non établi');
  assert.match(unverified.issues.join(' '), /Extrait introuvable/);
});

test('une décision remise en cause ne fonde plus la condition ; la doctrine seule est signalée', () => {
  const blocked = run(code(facts, 'sjur0001'), [article, { ...decision, history: { status: 'remise en cause', lines: ['Recours fictif'] } }, piece]);
  assert.equal(blocked.conditions.find((entry) => entry.id === 'Q.approbation')!.status, 'bloquée');
  assert.equal(blocked.questions[0].status, 'bloquée');
  const weak = run(code(facts, 'sdoc0001')).conditions.find((entry) => entry.id === 'Q.approbation')!;
  assert.equal(weak.strength, 'doctrine');
  assert.match(weak.issues.join(' '), /seule doctrine/);
  assert.equal(run(code(facts, 'sjur0001, sdoc0001')).conditions.find((entry) => entry.id === 'Q.approbation')!.strength, 'jurisprudence');
});

test('une question sans date de référence ni condition fondée est incomplète', () => {
  const result = run("#[question = \"Q ?\"]\ndéclaration champ d'application Q:\n  entrée a contenu booléen\n  résultat r condition\nchamp d'application Q:\n  règle r sous condition a conséquence rempli\n");
  assert.equal(result.questions[0].valid, false);
  assert.match(result.questions[0].issues.join(' '), /Date de référence/);
  assert.match(result.questions[0].issues.join(' '), /Au moins une condition fondée/);
});

test('une exception applicable l’emporte sur la règle de base', () => {
  const text = code(facts).replace('  #[selon = sart0001]\n  règle du', '  #[selon = sart0001]\n  exception base règle du sous condition date_acte < |2025-01-01| conséquence non rempli\n  #[selon = sart0001]\n  étiquette base règle du');
  assert.equal(run(text).questions[0].status, 'non remplie');
  assert.equal(run(text.replace('2024-03-01', '2025-03-01')).questions[0].status, 'remplie');
});

test('les dates et durées se calculent au même quantième', () => {
  const text = "#[date_de_référence = d]\ndéclaration champ d'application A:\n  entrée d contenu date\n  interne fin contenu date\n  interne ok condition\nchamp d'application A:\n  #[selon = sart0001]\n  définition fin égal à d + 1 mois\n  #[selon = sart0001]\n  règle ok sous condition fin = |2024-02-29| conséquence rempli\ndéclaration champ d'application Dossier:\n  a champ A\nchamp d'application Dossier:\n  #[selon = spie0001] #[force = indice]\n  définition a.d égal à |2024-01-31|\n";
  assert.equal(run(text).conditions.find((entry) => entry.id === 'A.ok')!.value, true);
});

test('le service réécrit les références, verrouille les éléments validés et garde l’appréciation de l’avocat', (t) => {
  const { db, service } = fixture(t);
  const turnSources: TurnSource[] = [{ ...article, ref: 1 }, { ...piece, ref: 2 }];
  const numbered = code(facts.replaceAll('spie0001', '2'), '1').replaceAll('sart0001', '1');
  const summary = service.ingest({ cwd: '/dossier-fictif', sessionId: 's', turnId: 't1', code: numbered, sources: turnSources });
  assert.match(summary, /Q : remplie/);
  const first = service.read('/dossier-fictif');
  assert.match(first.code, /#\[selon = sart0001\]/);
  assert.equal(service.ingest({ cwd: '/dossier-fictif', sessionId: 's', turnId: 't1', code: numbered, sources: turnSources }), '');

  service.review('/dossier-fictif', 'Q.approbation', 'validé', 'Conforme au texte');
  const altered = first.code.replace('règle approbation sous condition approuve', 'règle approbation sous condition non approuve');
  const note = service.ingest({ cwd: '/dossier-fictif', sessionId: 's', turnId: 't2', code: altered, sources: [] });
  assert.match(note, /Modification ignorée : Q\.approbation/);
  assert.match(service.read('/dossier-fictif').code, /règle approbation sous condition approuve conséquence/);

  service.appreciate('/dossier-fictif', 'Q.approuve', { value: false, force: 'indice', appreciation: 'Signature contestable' });
  const row = db.prepare("SELECT status, author, value_json, force FROM pm_reasoning_items WHERE item_id='Q.approuve'").get() as Record<string, string>;
  assert.deepEqual(row, { status: 'validé', author: 'avocat', value_json: 'false', force: 'indice' });
  assert.equal(service.read('/dossier-fictif').questions[0].status, 'non remplie');
  service.ingest({ cwd: '/dossier-fictif', sessionId: 's', turnId: 't3', code: service.read('/dossier-fictif').code.replace('égal à faux', 'égal à vrai'), sources: [] });
  assert.equal(service.read('/dossier-fictif').facts.find((fact) => fact.id === 'Q.approuve')!.value, false);

  service.review('/dossier-fictif', 'Q.approuve', null);
  assert.equal((db.prepare("SELECT author FROM pm_reasoning_items WHERE item_id='Q.approuve'").get() as { author: string }).author, 'ia');
});

test('un code illisible est refusé et le raisonnement précédent conservé', (t) => {
  const { service } = fixture(t);
  service.ingest({ cwd: '/dossier-fictif', sessionId: 's', turnId: 't1', code: code(facts), sources: [] });
  assert.match(service.ingest({ cwd: '/dossier-fictif', sessionId: 's', turnId: 't2', code: 'règle sans champ', sources: [] }), /Raisonnement non appliqué : Ligne 1/);
  assert.equal(service.read('/dossier-fictif').revision, 1);
});

test('l’exemple fictif décrit une condition sans fondement et un fait sans pièce', () => {
  const example = reasoningExample();
  assert.equal(example.questions[0].status, 'bloquée');
  assert.match(example.conditions.find((entry) => entry.id === 'Indemnite.approbation_ex_post')!.issues.join(' '), /Fondement manquant/);
  assert.equal(example.facts.find((entry) => entry.id === 'Indemnite.societe_cotee')!.status, 'non établi');
});
