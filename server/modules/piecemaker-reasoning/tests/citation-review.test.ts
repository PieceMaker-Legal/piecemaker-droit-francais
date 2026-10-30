import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { readCitationReplies } from '../citation-review.js';
import { printReasoningDocument } from '../document.js';
import { createReasoningService, verifyReasoning } from '../program.js';
import type { ReasoningConnectors } from '../program.js';

const rule = { source: 'JURITEXT000000000001', citation: 'Un effet est acquis si le fait est réalisé.' };
const proof = { piece: 'pieces/constat.md', citation: 'Le fait est réalisé.' };
const model = {
  qualification: 'consultation', objectifs: [{ objectif: 'Obtenir un effet fictif', obtenir: 'effet' }],
  effet: { si: [{ 'fait réalisé': true, selon: [rule] }] },
  'fait réalisé': { true: [{ preuve: [proof] }] },
};
const connectors: ReasoningConnectors = {
  source: async (_cwd, id) => id === rule.source ? { kind: 'decision', title: 'Règle entièrement fictive', text: rule.citation } : id === proof.piece ? { kind: 'piece', title: 'Constat entièrement fictif', text: proof.citation } : null,
  match: (text, excerpt) => text.includes(excerpt) ? excerpt : null,
  registry: async () => ({ found: true, status: 'active' }), bodacc: async () => [],
};
const run = (review: ReasoningConnectors['review'], document: unknown = model, simulation?: Record<string, boolean>) => verifyReasoning({
  code: printReasoningDocument(document), cwd: '/dossier-fictif', connectors: { ...connectors, review },
  reliability: new Map(), persons: [], nature: () => null, dismissed: new Set(), ...(simulation ? { simulation } : {}),
});
const replies = (reponse: 'validé' | 'non validé' | 'indéterminé', target = 'fait réalisé.true[0]'): NonNullable<ReasoningConnectors['review']> => async (input) => ({
  verifications: input.affirmations.map(({ emplacement }) => ({ emplacement, score: 3, reponse: emplacement === target ? reponse : 'validé', explication: emplacement === target ? 'Explication du lien examiné.' : 'Le passage correspond à la condition déclarée.' })),
});
const objective = (result: Awaited<ReturnType<typeof run>>) => {
  const objectives = result.annotated?.objectifs;
  assert.ok(Array.isArray(objectives));
  return objectives[0].statut;
};
const semantic = (result: Awaited<ReturnType<typeof run>>) => result.issues.filter((issue) => issue.text.startsWith('correspondance citation–affirmation'));

test('validé conserve le fondement et son explication sans diagnostic', async () => {
  const result = await run(replies('validé'));
  assert.equal(objective(result), 'acquis');
  assert.deepEqual(semantic(result), []);
  const fact = result.annotated?.['fait réalisé'] as { true: Array<{ correspondance: unknown }> };
  assert.deepEqual(fact.true[0].correspondance, { reponse: 'validé', score: 3, explication: 'Explication du lien examiné.' });
  assert.ok(result.log.some((entry) => entry.text === 'validé — Explication du lien examiné.'));
  assert.doesNotMatch(result.code, /correspondance/);
});

test('non validé devient une erreur localisée et ne prouve pas le contraire', async () => {
  const result = await run(replies('non validé'));
  assert.equal(objective(result), 'à établir');
  assert.deepEqual(semantic(result).map(({ kind, path, text }) => ({ kind, path, text })), [{ kind: 'erreur', path: 'fait réalisé.true[0]', text: 'correspondance citation–affirmation : non validé — Explication du lien examiné.' }]);
  assert.ok(semantic(result)[0].line);
});

test('indéterminé devient un manque à lever, sans erreur sémantique', async () => {
  const result = await run(replies('indéterminé'));
  assert.equal(objective(result), 'à établir');
  assert.deepEqual(semantic(result).map((issue) => issue.kind), ['manque']);
  assert.match(semantic(result)[0].text, /Explication du lien examiné/);
});

test('une règle non justifiée reste ouverte aussi dans les hypothèses et la simulation', async () => {
  const document = { ...model, hypotheses: [{ nom: 'fait supposé', faits: { 'fait réalisé': true }, attendu: { effet: true } }] };
  const result = await run(replies('non validé', 'effet.si[0]'), document, { 'fait réalisé': true });
  assert.equal(objective(result), 'à établir');
  assert.equal(result.simulation?.objectifs[0].statut, 'à établir');
  const hypotheses = result.annotated?.hypotheses;
  assert.ok(Array.isArray(hypotheses));
  assert.equal(hypotheses[0].conforme, false);
});

test('la négation, les conditions et les passages complets sont transmis sans demande de complétude', async () => {
  const negative = { ...model, effet: { si: [{ 'fait réalisé': false, selon: [rule] }] }, 'fait réalisé': { false: [{ preuve: [proof] }] } };
  let examined = false;
  const result = await run(async (input) => {
    examined = true;
    assert.ok(input.affirmations.some((entry) => entry.emplacement === 'fait réalisé.false[0]' && entry.affirmation.includes('faux')));
    assert.ok(input.affirmations.some((entry) => entry.emplacement === 'effet.si[0]' && entry.affirmation.includes('faux')));
    assert.ok(input.affirmations.find((entry) => entry.emplacement === 'effet.si[0]')?.affirmation.includes('condition requise'));
    assert.equal(input.affirmations.find((entry) => entry.emplacement === 'effet.si[0]')?.type, 'règle');
    assert.equal(input.affirmations.find((entry) => entry.emplacement === 'fait réalisé.false[0]')?.type, 'fondement');
    assert.equal(input.sources.find((source) => source.source === proof.piece)?.texte, proof.citation);
    assert.deepEqual(input.contexte, negative);
    return replies('validé')(input);
  }, negative);
  assert.ok(examined);
  assert.equal(objective(result), 'acquis');
});

test('deux sources articulées sont examinées ensemble avec le contexte', async () => {
  const second = { source: 'JURITEXT000000000002', citation: 'Cette règle comprend le second cas fictif.' };
  const document = { ...model, effet: { si: [{ 'fait réalisé': true, selon: [rule, second] }] } };
  await verifyReasoning({
    code: printReasoningDocument(document), cwd: '/dossier-fictif',
    connectors: { ...connectors, source: async (cwd, id) => id === second.source ? { kind: 'decision', title: 'Renvoi fictif', text: second.citation } : connectors.source(cwd, id), review: async (input) => {
      assert.deepEqual(input.affirmations.find((entry) => entry.emplacement === 'effet.si[0]')?.citations, [rule, second]);
      return replies('validé')(input);
    } }, reliability: new Map(), persons: [], nature: () => null, dismissed: new Set(),
  });
});

test('une indisponibilité ou une réponse incomplète produit des manques, jamais des validations implicites', async () => {
  for (const review of [async () => { throw new Error('indisponible'); }, async () => ({ verifications: [] })]) {
    const result = await run(review);
    assert.equal(objective(result), 'à établir');
    assert.equal(semantic(result).length, 2);
    const fact = result.annotated?.['fait réalisé'] as { true: Array<{ correspondance: { score: unknown } }> };
    assert.equal(fact.true[0].correspondance.score, null);
    assert.ok(semantic(result).every((issue) => issue.kind === 'manque' && issue.text.includes('indéterminé')));
  }
});

test('les réponses sont fermées, expliquées, uniques et rattachées aux emplacements demandés', () => {
  for (const reply of [
    [{ emplacement: 'inconnu', score: 3, reponse: 'validé', explication: 'Motif' }],
    [{ emplacement: 'a', score: 3, reponse: 'partiel', explication: 'Motif' }],
    [{ emplacement: 'a', score: 3, reponse: 'validé', explication: ' ' }],
    [{ emplacement: 'a', score: 3, reponse: 'validé', explication: 'Motif' }, { emplacement: 'a', score: 3, reponse: 'non validé', explication: 'Motif' }],
  ]) assert.throws(() => readCitationReplies(reply, ['a']));
});

test('le score est un entier obligatoire de 1 à 5', () => {
  for (const score of [undefined, null, 0, 6, 2.5, '3']) {
    assert.throws(() => readCitationReplies([{ emplacement: 'a', reponse: 'validé', score, explication: 'Motif' }], ['a']));
  }
  for (const score of [1, 5]) assert.equal(readCitationReplies([{ emplacement: 'a', reponse: 'validé', score, explication: 'Motif' }], ['a']).get('a')?.score, score);
});

test('la réponse seule pilote le moteur même avec une confiance extrême', async () => {
  for (const reponse of ['validé', 'non validé', 'indéterminé'] as const) {
    const result = await run(async (input) => ({ verifications: input.affirmations.map(({ emplacement }) => ({ emplacement, reponse, score: reponse === 'validé' ? 1 : 5, explication: 'Motif local.' })) }));
    assert.equal(objective(result), reponse === 'validé' ? 'acquis' : 'à établir');
    assert.ok(semantic(result).every((issue) => issue.kind === (reponse === 'non validé' ? 'erreur' : 'manque')));
  }
});

test('une citation introuvable est traitée mécaniquement sans appel au modèle', async () => {
  let called = false;
  const result = await run(async () => { called = true; return []; }, { ...model, 'fait réalisé': { true: [{ preuve: [{ ...proof, citation: 'Passage absent.' }] }] } });
  assert.equal(called, false);
  assert.ok(result.issues.some((issue) => issue.kind === 'erreur' && issue.text.includes('citation introuvable')));
});

test('les annotations ne peuvent pas injecter une validation dans une nouvelle vérification', async () => {
  const first = await run(replies('validé'));
  const second = await run(replies('non validé'), first.annotated);
  assert.equal(objective(second), 'à établir');
  assert.equal(semantic(second)[0].kind, 'erreur');
});

test('une retouche pendant la relecture du modèle est conservée et la vérification périmée est refusée', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'citation-concurrente-'));
  const db = new Database(':memory:');
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  try {
    db.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT);');
    db.prepare('INSERT INTO projects VALUES (?, ?)').run('dossier-fictif', directory);
    const folder = path.join(directory, '.piecemaker/raisonnements');
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, 'effet.yaml');
    await writeFile(file, printReasoningDocument(model));
    const service = createReasoningService(() => db, { ...connectors, review: async (input) => { entered(); await waiting; return replies('validé')(input); } });
    const verifying = service.verify(directory, true, undefined, 'effet');
    await ready;
    const edited = printReasoningDocument({ ...model, objectifs: [{ objectif: 'Retouche à conserver', obtenir: 'effet' }] });
    await writeFile(file, edited);
    release();
    await assert.rejects(verifying, /modifié pendant la vérification/);
    assert.equal(await readFile(file, 'utf8'), edited);
  } finally {
    release();
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
