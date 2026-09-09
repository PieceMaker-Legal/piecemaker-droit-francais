import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createNormalizedMessage } from '@/shared/utils.js';

import { createCitationStore } from './citation-store.js';
import { createCitationTurn } from './citation-turn.js';

const block = (citations: unknown[]) => `<CITATIONS>${JSON.stringify(citations)}</CITATIONS>`;

async function fixture(t: test.TestContext) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pm-citations-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const store = createCitationStore(path.join(cwd, '.store'));
  const events: Parameters<Parameters<typeof createCitationTurn>[0]['emit']>[0][] = [];
  const turn = createCitationTurn({ cwd, sessionId: 'session', store, emit: (event) => events.push(event) });
  return { cwd, store, events, turn };
}

test('Mike : texte diffusé, bloc masqué même découpé, annotations finales corrigées et source navigable', async (t) => {
  const { cwd, store, events, turn } = await fixture(t);
  const source = 'Avant. La CLAUSE   prévoit une durée de deux ans. Après.';
  await writeFile(path.join(cwd, 'piece.md'), source);
  const text = `Analyse [1].\n${block([{ ref: 1, doc_id: 'piece.md', quote: 'la clause prévoit une durée de deux ans' }])}`;
  let visible = '';
  for (const character of text) visible += turn.delta(character);
  visible += turn.flush();
  assert.equal(visible, 'Analyse [1].\n');
  assert.deepEqual(events.map((event) => event.status), ['started', 'partial']);
  const suffix = await turn.finish();
  assert.equal(events.at(-1)?.status, 'final');
  assert.equal(events.at(-1)?.citations[0].verified, true);
  assert.equal(events.at(-1)?.citations[0].quotes[0].quote, 'La CLAUSE   prévoit une durée de deux ans');
  const token = /#piecemaker-citation=([a-f0-9]{64})/.exec(suffix)?.[1];
  assert.ok(token);
  const snapshot = await store.read(token);
  assert.equal(snapshot?.source, source);
  assert.equal(snapshot?.source.slice(snapshot.ranges[0].start, snapshot.ranges[0].end), snapshot?.citation.quotes[0].quote);
  await writeFile(path.join(cwd, 'piece.md'), 'Document modifié ensuite.');
  assert.equal((await store.read(token))?.source, source);
  assert.equal(await store.read('../escape'), null);
});

test('Mike : citation introuvable annotée false, sans suppression de la réponse', async (t) => {
  const { cwd, events, turn } = await fixture(t);
  await writeFile(path.join(cwd, 'piece.md'), 'Texte source réel.');
  assert.equal(turn.text(`Réponse [1].${block([{ ref: 1, doc_id: 'piece.md', quote: 'Texte inventé.' }])}`), 'Réponse [1].');
  assert.match(await turn.finish(), /extrait non retrouvé/);
  assert.equal(events.at(-1)?.citations[0].verified, false);
});

test('les résultats consulter_decision Claude et Codex sont appariés et restent propres au tour', async (t) => {
  for (const provider of ['claude', 'codex'] as const) {
    const { turn, events, store, cwd } = await fixture(t);
    const message = (fields: Omit<Parameters<typeof createNormalizedMessage>[0], 'provider'> & { kind: 'tool_use' | 'tool_result' }) => createNormalizedMessage({ ...fields, provider, sessionId: 'session' });
    turn.observe(message({ kind: 'tool_use', toolId: 'call-1', toolName: 'mcp__legifrance__consulter_decision', toolInput: { text_id: 'JURITEXT1' } }));
    turn.observe(message({ kind: 'tool_result', toolId: 'unrelated', content: 'Extrait intrus.' }));
    turn.observe(message({ kind: 'tool_result', toolId: 'call-1', content: JSON.stringify({ content: [{ type: 'text', text: 'TEXTE INTÉGRAL:\n=====\nExtrait lu dans ce tour.\nLien: https://example.org' }] }) }));
    const text = block([{ ref: 1, decision_id: 'JURITEXT1', quote: 'Extrait lu dans ce tour.' }]);
    turn.text(text);
    await turn.finish();
    assert.equal(events.at(-1)?.citations[0].verified, true);
    const other = createCitationTurn({ cwd, sessionId: 'other', store, emit: (event) => events.push(event) });
    other.text(text);
    await other.finish();
    assert.equal(events.at(-1)?.citations[0].verified, false);
  }
});

test('une réponse MCP en erreur et un résultat de sous-agent ne constituent pas une lecture du tour', async (t) => {
  const { turn, events } = await fixture(t);
  const base = { provider: 'codex' as const, sessionId: 'session', toolId: 'call' };
  turn.observe(createNormalizedMessage({ ...base, kind: 'tool_use', toolName: 'mcp__legifrance__consulter_decision', toolInput: { text_id: 'JURITEXT1' } }));
  turn.observe(createNormalizedMessage({ ...base, kind: 'tool_result', content: 'Extrait.', isError: true }));
  turn.observe(createNormalizedMessage({ ...base, kind: 'tool_result', content: 'Extrait.', parentToolUseId: 'agent' }));
  turn.text(block([{ ref: 1, decision_id: 'JURITEXT1', quote: 'Extrait.' }]));
  await turn.finish();
  assert.equal(events.at(-1)?.citations[0].verified, false);
});

test('pas de lecture hors dossier, y compris par lien symbolique', async (t) => {
  const { cwd, turn, events } = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'pm-source-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'source.md'), 'Texte hors dossier.');
  await symlink(path.join(outside, 'source.md'), path.join(cwd, 'link.md'));
  turn.text(block([
    { ref: 1, doc_id: path.join(outside, 'source.md'), quote: 'Texte hors dossier.' },
    { ref: 2, doc_id: 'link.md', quote: 'Texte hors dossier.' },
  ]));
  await turn.finish();
  assert.deepEqual(events.at(-1)?.citations.map((citation) => citation.verified), [false, false]);
  assert.equal(await readFile(path.join(outside, 'source.md'), 'utf8'), 'Texte hors dossier.');
});

test('sans citations et avec JSON malformé : pas de faux succès ni de bloc technique visible', async (t) => {
  const { turn, events } = await fixture(t);
  let visible = turn.delta('Bonjour <CI');
  visible += turn.flush();
  assert.equal(visible, 'Bonjour <CI');
  assert.equal(await turn.finish(), '');
  assert.deepEqual(events.at(-1)?.citations, []);
  const other = await fixture(t);
  assert.equal(other.turn.text('Bonjour<CITATIONS>{incorrect}</CITATIONS>'), 'Bonjour');
  assert.equal(await other.turn.finish(), '');
  assert.deepEqual(other.events.at(-1)?.citations, []);
});

test('extraits multiples, ellipses et sauts de page conservent leurs plages source', async (t) => {
  const { cwd, turn, store } = await fixture(t);
  await writeFile(path.join(cwd, 'piece.md'), 'Début de clause. Texte omis. Fin de clause. Autre passage.');
  turn.text(block([{ ref: 1, doc_id: 'piece.md', quotes: [
    { page: '1-2', quote: 'Début de clause ... Fin de clause' },
    { page: 2, quote: 'Fin de clause[[PAGE_BREAK]]Autre passage' },
  ] }]));
  const suffix = await turn.finish();
  const token = /#piecemaker-citation=([a-f0-9]{64})/.exec(suffix)?.[1];
  assert.ok(token);
  const snapshot = await store.read(token);
  assert.equal(snapshot?.citation.verified, true);
  assert.deepEqual(snapshot?.ranges.map((range) => range.quoteIndex), [0, 0, 1, 1]);
});

test('un article lu avec consulter_article est vérifiable et titré par son code', async (t) => {
  const { turn, store, events } = await fixture(t);
  const resultat = [
    '**1103**', '', 'Code: Code civil', 'Section: Chapitre Ier : Dispositions liminaires',
    'Validité: 2016-10-01 → 2999-01-01', 'Identifiant: LEGIARTI000032040777',
    'Lien: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032040777', '',
    'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.',
  ].join('\n');
  const message = (fields: Omit<Parameters<typeof createNormalizedMessage>[0], 'provider'> & { kind: 'tool_use' | 'tool_result' }) => createNormalizedMessage({ ...fields, provider: 'claude', sessionId: 'session' });
  turn.observe(message({ kind: 'tool_use', toolId: 'call-1', toolName: 'mcp__legifrance__consulter_article', toolInput: { article_id: 'LEGIARTI000032040777' } }));
  turn.observe(message({ kind: 'tool_result', toolId: 'call-1', content: resultat }));
  turn.text(block([{ ref: 1, decision_id: 'LEGIARTI000032040777', quote: 'tiennent lieu de loi à ceux qui les ont faits' }]));
  const suffix = await turn.finish();
  assert.equal(events.at(-1)?.citations[0].verified, true);
  const token = /#piecemaker-citation=([a-f0-9]{64})/.exec(suffix)?.[1];
  assert.ok(token);
  assert.equal((await store.read(token))?.title, 'Code civil, article 1103');
});

test('la visionneuse porte le titre lisible de la décision, pas son identifiant', async (t) => {
  const { turn, store } = await fixture(t);
  const titre = 'Cour de cassation, civile, Chambre commerciale, 23 janvier 2016, 14-11.111';
  turn.observe(createNormalizedMessage({ provider: 'claude', sessionId: 'session', kind: 'tool_use', toolId: 'call-1', toolName: 'mcp__legifrance__consulter_decision', toolInput: { text_id: 'JURITEXT1' } }));
  turn.observe(createNormalizedMessage({ provider: 'claude', sessionId: 'session', kind: 'tool_result', toolId: 'call-1', content: `DÉCISION: ${titre}\n\nNature: ARRET\n\n=====\nTEXTE INTÉGRAL:\n=====\nExtrait lu dans ce tour.\nLien: https://example.org` }));
  const suffix = await (async () => { turn.text(block([{ ref: 1, decision_id: 'JURITEXT1', quote: 'Extrait lu dans ce tour.' }])); return turn.finish(); })();
  const token = /#piecemaker-citation=([a-f0-9]{64})/.exec(suffix)?.[1];
  assert.ok(token);
  assert.equal((await store.read(token))?.title, titre);
});
