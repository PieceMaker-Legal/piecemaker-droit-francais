import assert from 'node:assert/strict';
import test from 'node:test';

import Database from 'better-sqlite3';

import { createReasoningService, reasoningExample } from '../program.js';
import { evaluateProgram } from '../engine.js';

function fixture(t: test.TestContext, folder = '/dossier-fictif') {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE projects(project_id TEXT PRIMARY KEY, project_path TEXT);');
  db.prepare('INSERT INTO projects VALUES(?,?)').run('example', folder);
  const service = createReasoningService(() => db);
  t.after(() => db.close());
  return { db, service };
}

const block = (program: object) => `<CITATIONS>${JSON.stringify([{ kind: 'program', version: 1, ...program }])}</CITATIONS>`;
const fact = { id: 'F1', kind: 'fact', label: 'Valeur déclarée', value: 10, citations: [1] };
const source = { id: 'src_1', ref: 1, quoteIndex: 0, token: 'a'.repeat(64), document: 'document:piece.md', title: 'Pièce fictive', excerpt: 'Valeur déclarée dix.', hash: 'v1', verified: true, repaired: false };

test('une donnée contestée reste inconnue et les scénarios produisent des résultats distincts', () => {
  const snapshot = reasoningExample();
  const base = snapshot.evaluations[0].results.find((row) => row.id === 'C_solde')!;
  assert.equal(base.status, 'unknown');
  assert.deepEqual(base.missing, ['F_versement']);
  const retained = snapshot.evaluations[1].results.find((row) => row.id === 'C_solde')!;
  assert.equal(retained.value, 800000);
  assert.deepEqual(retained.assumptions, ['F_versement']);
  assert.equal(snapshot.evaluations[2].results.find((row) => row.id === 'C_solde')!.value, 1200000);
  assert.ok(snapshot.evaluations.flatMap((row) => row.tests).every((row) => row.passed));
});

test('un résultat ne peut pas utiliser une source manquante, recalée ou remplacée', () => {
  for (const mutation of ['missing', 'repaired', 'stale', 'unverified']) {
    const program = reasoningExample().program;
    if (mutation === 'missing') program.sources = [];
    if (mutation === 'repaired') program.sources[0].repaired = true;
    if (mutation === 'stale') program.sources[0].stale = true;
    if (mutation === 'unverified') program.sources[0].verified = false;
    assert.equal(evaluateProgram(program)[1].results.find((row) => row.id === 'C_solde')!.status, 'blocked');
  }
});

test('cycles, divisions par zéro et opérations mal typées sont des erreurs explicites', () => {
  const program = reasoningExample().program;
  program.nodes.push({ id: 'C_cycle', label: 'Cycle', kind: 'calculation', sources: [], expression: { ref: 'C_cycle' } });
  program.nodes.push({ id: 'C_division', label: 'Division', kind: 'calculation', sources: [], expression: { op: 'divide', args: [12, 0] } });
  program.nodes.push({ id: 'C_type', label: 'Type incorrect', kind: 'calculation', sources: [], expression: { op: 'add', args: [12, 'douze'] } });
  const results = evaluateProgram(program)[0].results;
  for (const id of ['C_cycle', 'C_division', 'C_type']) assert.equal(results.find((row) => row.id === id)!.status, 'error');
});

test('if ne dépend que de sa branche active et ne transforme pas inconnu en faux', () => {
  const program = reasoningExample().program;
  program.nodes.push({ id: 'C_if', label: 'Branche active', kind: 'calculation', sources: [], expression: { op: 'if', args: [true, 42, { ref: 'F_absent' }] } });
  program.nodes.push({ id: 'C_null', label: 'Condition inconnue', kind: 'calculation', sources: [], expression: { op: 'if', args: [null, 42, 0] } });
  const results = evaluateProgram(program)[0].results;
  assert.equal(results.find((row) => row.id === 'C_if')!.value, 42);
  assert.equal(results.find((row) => row.id === 'C_null')!.status, 'unknown');
});

test('une hypothèse peut fixer un fait, jamais écraser un calcul', () => {
  const program = reasoningExample().program;
  program.scenarios.push({ id: 'invalid', label: 'Invalide', assumptions: { C_solde: 0 } });
  assert.throws(() => evaluateProgram(program), /fait existant/);
});

test('ingestion atomique et idempotente, récupération complète SQL et contexte du tour suivant', (t) => {
  const { service, db } = fixture(t);
  const input = { cwd: '/dossier-fictif', sessionId: 'session', block: block({ nodes: [fact] }), sources: [source] };
  assert.match(service.ingest(input), /révision 1/);
  assert.equal(service.ingest(input), '');
  assert.equal(service.read(input.cwd).revision, 1);
  assert.equal((db.prepare('SELECT status FROM pm_reasoning_results WHERE project_id=?').get('example') as { status: string }).status, 'known');
  assert.match(service.context(input.cwd), /F1/);
  const malformed = block({ nodes: [{ ...fact, kind: 'calculation', expression: { op: 'eval', args: ['arbitrary'] } }] });
  assert.match(service.ingest({ ...input, block: malformed }), /non appliqué/);
  assert.equal(service.read(input.cwd).program.nodes[0].value, 10);
  assert.equal(service.read(input.cwd).revision, 1);
});

test('un changement de source invalide les dépendances et enregistre le changement de résultat', (t) => {
  const { service } = fixture(t);
  const first = { cwd: '/dossier-fictif', sessionId: 's', block: block({ nodes: [fact] }), sources: [source] };
  service.ingest(first);
  service.ingest({ ...first, block: block({ nodes: [] }), sources: [{ ...source, id: 'src_2', hash: 'v2' }] });
  const next = service.read(first.cwd);
  assert.equal(next.evaluations[0].results[0].status, 'blocked');
  assert.equal(next.changes[0].id, 'F1');
  assert.equal(next.program.sources.find((row) => row.id === 'src_1')!.stale, true);
});

test('les références de citation appartiennent au tour et ne se résolvent pas vers un ancien numéro', (t) => {
  const { service } = fixture(t);
  service.ingest({ cwd: '/dossier-fictif', sessionId: 's', block: block({ nodes: [fact] }), sources: [source] });
  service.ingest({ cwd: '/dossier-fictif', sessionId: 's', block: block({ nodes: [{ ...fact, id: 'F2' }] }), sources: [] });
  assert.equal(service.read('/dossier-fictif').evaluations[0].results.find((row) => row.id === 'F2')!.status, 'blocked');
});

test('reciter exactement un passage recalé ne valide pas une ancienne interprétation sans réémission du nœud', (t) => {
  const { service } = fixture(t);
  const first = { cwd: '/dossier-fictif', sessionId: 's', block: block({ nodes: [fact] }), sources: [{ ...source, repaired: true }] };
  service.ingest(first);
  service.ingest({ ...first, block: block({ nodes: [] }), sources: [source] });
  assert.equal(service.read(first.cwd).evaluations[0].results[0].status, 'blocked');
  service.ingest({ ...first, sessionId: 's2', sources: [source] });
  assert.equal(service.read(first.cwd).evaluations[0].results[0].status, 'known');
});

test('un changement peut retirer explicitement un scénario, un test et un nœud', (t) => {
  const { service } = fixture(t);
  const first = { cwd: '/dossier-fictif', sessionId: 's', sources: [source], block: block({ nodes: [fact], scenarios: [{ id: 'S1', label: 'Variante', assumptions: { F1: 1 } }], tests: [{ id: 'T1', label: 'Attente', target: 'F1', expected: { status: 'known', value: 10 } }] }) };
  service.ingest(first);
  service.ingest({ ...first, block: block({ remove: ['S1', 'T1', 'F1'] }), sources: [] });
  const snapshot = service.read(first.cwd);
  assert.equal(snapshot.program.nodes.length, 0);
  assert.equal(snapshot.program.scenarios.length, 0);
  assert.equal(snapshot.program.tests.length, 0);
});

test('deux tours réels avec le même bloc sont distincts et peuvent rétablir une définition antérieure', (t) => {
  const { service } = fixture(t);
  const input = { cwd: '/dossier-fictif', sessionId: 's', sources: [source], block: block({ nodes: [fact] }) };
  service.ingest({ ...input, turnId: 'tour1' });
  service.ingest({ ...input, turnId: 'tour2', block: block({ nodes: [{ ...fact, value: 20 }] }) });
  service.ingest({ ...input, turnId: 'tour3' });
  assert.equal(service.read(input.cwd).revision, 3);
  assert.equal(service.read(input.cwd).program.nodes[0].value, 10);
  assert.equal(service.ingest({ ...input, turnId: 'tour3' }), '');
});

test('un premier rejet est renvoyé au modèle et le dernier nœud non sourcé peut être supprimé', (t) => {
  const { service } = fixture(t);
  const input = { cwd: '/dossier-fictif', sessionId: 's', sources: [], block: block({ version: 2 }) };
  service.ingest(input);
  assert.match(service.context(input.cwd), /Version de programme non prise en charge/);
  service.ingest({ ...input, block: block({ nodes: [{ id: 'F1', kind: 'fact', label: 'Inconnu', state: 'unknown' }] }) });
  service.ingest({ ...input, block: block({ remove: ['F1'] }) });
  assert.equal(service.read(input.cwd).program.nodes.length, 0);
  assert.equal(service.read(input.cwd).revision, 2);
});
