import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import JSZip from 'jszip';

import { createNormalizedMessage } from '@/shared/utils.js';

import { createCitationStore } from './citation-store.js';
import { createCitationTurn } from './citation-turn.js';
import { formatPieceTitle } from './piece-title.js';

const block = (citations: unknown[]) => `<CITATIONS>${JSON.stringify(citations)}</CITATIONS>`;

async function fixture(t: test.TestContext) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pm-citations-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const store = createCitationStore(path.join(cwd, '.store'));
  const turn = createCitationTurn({ cwd, sessionId: 'session', store });
  return { cwd, store, turn };
}

async function writeDocx(file: string, text: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p></w:body></w:document>`);
  await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
}

test('Mike : texte diffusé, bloc masqué même découpé, annotations finales corrigées et source navigable', async (t) => {
  const { cwd, store, turn } = await fixture(t);
  const source = 'Avant. La CLAUSE   prévoit une durée de deux ans. Après.';
  await writeFile(path.join(cwd, 'piece.md'), source);
  const text = `Analyse [1].\n${block([{ ref: 1, doc_id: 'piece.md', quote: 'la clause prévoit une durée de deux ans' }])}`;
  let visible = '';
  for (const character of text) visible += turn.delta(character);
  visible += turn.flush();
  assert.equal(visible, 'Analyse [1].\n');
  const suffix = await turn.finish();
  const token = /#piecemaker-citation=([a-f0-9]{64})/.exec(suffix)?.[1];
  assert.ok(token);
  const snapshot = await store.read(token);
  assert.equal(snapshot?.citation.verified, true);
  assert.equal(snapshot?.citation.quotes[0].quote, 'La CLAUSE   prévoit une durée de deux ans');
  assert.equal(snapshot?.source, source);
  assert.equal(snapshot?.source.slice(snapshot.ranges[0].start, snapshot.ranges[0].end), snapshot?.citation.quotes[0].quote);
  await writeFile(path.join(cwd, 'piece.md'), 'Document modifié ensuite.');
  assert.equal((await store.read(token))?.source, source);
  assert.equal(await store.read('../escape'), null);
});

test('Mike : citation introuvable annotée false, sans suppression de la réponse', async (t) => {
  const { cwd, turn } = await fixture(t);
  await writeFile(path.join(cwd, 'piece.md'), 'Texte source réel.');
  assert.equal(turn.text(`Réponse [1].${block([{ ref: 1, doc_id: 'piece.md', quote: 'Texte inventé.' }])}`), 'Réponse [1].');
  assert.match(await turn.finish(), /- \[1\] 🔴 \[piece, p\. 1\]\[1\] — \[à vérifier – introuvable\]$/m);
});

test('un Markdown du dossier cité comme code est lu hors du dépôt applicatif', async (t) => {
  const { cwd, turn, store } = await fixture(t);
  await mkdir(path.join(cwd, '.agents', 'skills', 'docx-cli'), { recursive: true });
  const source = '`docx` is a command-line tool for reading, editing, redlining, and commenting on Microsoft Word `.docx` files.\n';
  await writeFile(path.join(cwd, '.agents', 'skills', 'docx-cli', 'SKILL.md'), source);
  turn.text(block([{ ref: 1, kind: 'code', doc_id: '.agents/skills/docx-cli/SKILL.md', quotes: [{ quote: '`docx` is a command-line tool for reading, editing, redlining, and commenting on Microsoft Word `.docx` files.' }] }]));
  const suffix = await turn.finish();
  assert.doesNotMatch(suffix, /🔴/);
  assert.match(suffix, /SKILL\.md, l\. 1/);
  const token = /#piecemaker-citation=([a-f0-9]{64})/.exec(suffix)?.[1];
  assert.ok(token);
  assert.equal((await store.read(token))?.source, source);
});

test('un .docx du dossier est vérifié sur son texte, sans Markdown converti', async (t) => {
  const { cwd, turn, store } = await fixture(t);
  await writeDocx(path.join(cwd, 'bonjour.docx'), 'Bonjour, Gaston !');
  turn.text(block([{ ref: 3, kind: 'document', doc_id: 'bonjour.docx', quotes: [{ page: 1, quote: 'Bonjour, Gaston !' }] }]));
  const suffix = await turn.finish();
  assert.doesNotMatch(suffix, /🔴/);
  assert.match(suffix, /bonjour, p\. 1/);
  const token = /#piecemaker-citation=([a-f0-9]{64})/.exec(suffix)?.[1];
  assert.ok(token);
  assert.match((await store.read(token))?.source ?? '', /Bonjour, Gaston !/);
});

test('un fichier de code du dépôt est vérifié depuis son original et affiche sa ligne', async (t) => {
  const codeRoot = await mkdtemp(path.join(os.tmpdir(), 'pm-code-citations-'));
  t.after(() => rm(codeRoot, { recursive: true, force: true }));
  await mkdir(path.join(codeRoot, '.husky'));
  const code = 'git status --short\nnpx lint-staged\n';
  await writeFile(path.join(codeRoot, '.husky', 'pre-commit'), code);
  await writeFile(path.join(codeRoot, '.oxlintrc'), '{"rules":{}}\n');
  const store = createCitationStore(path.join(codeRoot, '.store'));
  const turn = createCitationTurn({ cwd: codeRoot, codeRoot, sessionId: 'session', store });
  turn.text(block([{ ref: 1, kind: 'code', doc_id: '.husky/pre-commit', quote: 'npx lint-staged' }]));
  const suffix = await turn.finish();
  assert.match(suffix, /^- \[1\] \[\.husky\/pre-commit, l\. 2\]\[1\] — « npx lint-staged »$/m);
  const token = /#piecemaker-citation=([a-f0-9]{64})/.exec(suffix)?.[1];
  assert.ok(token);
  const snapshot = await store.read(token);
  assert.equal(snapshot?.citation.kind, 'code');
  assert.equal(snapshot?.source, code);
  const configTurn = createCitationTurn({ cwd: codeRoot, codeRoot, sessionId: 'config-session', store });
  configTurn.text(block([{ ref: 1, kind: 'code', doc_id: '.oxlintrc', quote: '"rules"' }]));
  assert.doesNotMatch(await configTurn.finish(), /🔴/);
});

test('les résultats consulter_decision Claude et Codex sont appariés et restent propres au tour', async (t) => {
  for (const provider of ['claude', 'codex'] as const) {
    const { turn, store, cwd } = await fixture(t);
    const message = (fields: Omit<Parameters<typeof createNormalizedMessage>[0], 'provider'> & { kind: 'tool_use' | 'tool_result' }) => createNormalizedMessage({ ...fields, provider, sessionId: 'session' });
    turn.observe(message({ kind: 'tool_use', toolId: 'call-1', toolName: 'mcp__legifrance__consulter_decision', toolInput: { text_id: 'JURITEXT1' } }));
    turn.observe(message({ kind: 'tool_result', toolId: 'unrelated', content: 'Extrait intrus.' }));
    turn.observe(message({ kind: 'tool_result', toolId: 'call-1', content: JSON.stringify({ content: [{ type: 'text', text: 'TEXTE INTÉGRAL:\n=====\nExtrait lu dans ce tour.\nLien: https://example.org' }] }) }));
    const text = block([{ ref: 1, decision_id: 'JURITEXT1', quote: 'Extrait lu dans ce tour.' }]);
    turn.text(text);
    assert.doesNotMatch(await turn.finish(), /🔴/);
    const other = createCitationTurn({ cwd, sessionId: 'other', store });
    other.text(text);
    assert.match(await other.finish(), /🔴/);
  }
});

test('une décision Judilibre lue par consulter_decision est vérifiée sous son identifiant hexadécimal', async (t) => {
  const { turn } = await fixture(t);
  const id = '0123456789abcdef01234567';
  const result = ['DÉCISION: Cour de cassation, Chambre sociale, 12 janvier 2024, 22-10.000', '', 'Solution: Cassation', '', '='.repeat(80), 'TEXTE INTÉGRAL:', '='.repeat(80), '', 'Le salarié Jean Dupont a été licencié sans cause réelle et sérieuse.', '', `Lien: https://www.courdecassation.fr/decision/${id}`].join('\n');
  turn.observe(createNormalizedMessage({ provider: 'claude', sessionId: 'session', kind: 'tool_use', toolId: 'call-1', toolName: 'mcp__legifrance__consulter_decision', toolInput: { text_id: id } }));
  turn.observe(createNormalizedMessage({ provider: 'claude', sessionId: 'session', kind: 'tool_result', toolId: 'call-1', content: [{ type: 'text', text: result }] }));
  turn.text(block([{ ref: 1, kind: 'case', decision_id: id, quotes: [{ quote: 'licencié sans cause réelle et sérieuse' }] }]));
  assert.doesNotMatch(await turn.finish(), /🔴/);
});

test('une réponse MCP en erreur et un résultat de sous-agent ne constituent pas une lecture du tour', async (t) => {
  const { turn } = await fixture(t);
  const base = { provider: 'codex' as const, sessionId: 'session', toolId: 'call' };
  turn.observe(createNormalizedMessage({ ...base, kind: 'tool_use', toolName: 'mcp__legifrance__consulter_decision', toolInput: { text_id: 'JURITEXT1' } }));
  turn.observe(createNormalizedMessage({ ...base, kind: 'tool_result', content: 'Extrait.', isError: true }));
  turn.observe(createNormalizedMessage({ ...base, kind: 'tool_result', content: 'Extrait.', parentToolUseId: 'agent' }));
  turn.text(block([{ ref: 1, decision_id: 'JURITEXT1', quote: 'Extrait.' }]));
  assert.match(await turn.finish(), /🔴/);
});

test('pas de lecture hors dossier, y compris par lien symbolique', async (t) => {
  const { cwd, turn } = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'pm-source-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'source.md'), 'Texte hors dossier.');
  await symlink(path.join(outside, 'source.md'), path.join(cwd, 'link.md'));
  turn.text(block([
    { ref: 1, doc_id: path.join(outside, 'source.md'), quote: 'Texte hors dossier.' },
    { ref: 2, doc_id: 'link.md', quote: 'Texte hors dossier.' },
  ]));
  const suffix = await turn.finish();
  assert.match(suffix, /^- \[1\] 🔴/m);
  assert.match(suffix, /^- \[2\] 🔴/m);
  assert.equal(await readFile(path.join(outside, 'source.md'), 'utf8'), 'Texte hors dossier.');
});

test('sans citations et avec JSON malformé : pas de faux succès ni de bloc technique visible', async (t) => {
  const { turn } = await fixture(t);
  let visible = turn.delta('Bonjour <CI');
  visible += turn.flush();
  assert.equal(visible, 'Bonjour <CI');
  assert.equal(await turn.finish(), '');
  const other = await fixture(t);
  assert.equal(other.turn.text('Bonjour<CITATIONS>{incorrect}</CITATIONS>'), 'Bonjour');
  assert.equal(await other.turn.finish(), '');
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
  const { turn, store } = await fixture(t);
  const resultat = [
    '**1103**', '', 'Code: Code civil', 'Section: Chapitre Ier : Dispositions liminaires',
    'Validité: 2016-10-01 → 2999-01-01', 'Identifiant: LEGIARTI000032040777',
    'Lien: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032040777', '',
    'Les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.',
  ].join('\n');
  const message = (fields: Omit<Parameters<typeof createNormalizedMessage>[0], 'provider'> & { kind: 'tool_use' | 'tool_result' }) => createNormalizedMessage({ ...fields, provider: 'claude', sessionId: 'session' });
  turn.observe(message({ kind: 'tool_use', toolId: 'call-1', toolName: 'mcp__legifrance__consulter_article', toolInput: { article_id: 'LEGIARTI000032040777' } }));
  turn.observe(message({ kind: 'tool_result', toolId: 'call-1', content: resultat }));
  turn.text(block([{ ref: 1, kind: 'article', article_id: 'LEGIARTI000032040777', quote: 'tiennent lieu de loi à ceux qui les ont faits' }]));
  const suffix = await turn.finish();
  assert.doesNotMatch(suffix, /🔴/);
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

test('la liste des sources donne le titre Légifrance et l’extrait vérifié', async (t) => {
  const { turn } = await fixture(t);
  const titre = 'Cour de cassation, civile, Chambre commerciale, 23 janvier 2016, 14-11.111';
  turn.observe(createNormalizedMessage({ provider: 'claude', sessionId: 'session', kind: 'tool_use', toolId: 'call-1', toolName: 'mcp__legifrance__consulter_decision', toolInput: { text_id: 'JURITEXT1' } }));
  turn.observe(createNormalizedMessage({ provider: 'claude', sessionId: 'session', kind: 'tool_result', toolId: 'call-1', content: `DÉCISION: ${titre}\n\n=====\nTEXTE INTÉGRAL:\n=====\nLe juge doit rechercher si l'inexécution est suffisamment grave.` }));
  turn.text(block([{ ref: 1, decision_id: 'JURITEXT1', quote: 'le juge doit rechercher si l’inexécution est suffisamment grave' }]));
  assert.match(await turn.finish(), new RegExp(`^\\*\\*Sources\\*\\*\\n\\n- \\[1\\] \\[${titre.replace(/[.]/g, '\\.')}\\]\\[1\\] — « Le juge doit rechercher si l'inexécution est suffisamment grave »$`, 'm'));
});

test('un extrait non vérifié est à vérifier, avec le passage le plus proche quand il existe', async (t) => {
  const { cwd, turn } = await fixture(t);
  await writeFile(path.join(cwd, 'bail.md'), 'Préambule. Le preneur occupera les lieux paisiblement pendant toute la durée du bail. Fin.');
  turn.text(block([
    { ref: 1, doc_id: 'bail.md', quotes: [{ page: 2, quote: 'le preneur occupe les lieux paisiblement pendant la durée du bail' }] },
    { ref: 2, doc_id: 'bail.md', quote: 'clause pénale de dix mille euros' },
    { ref: 3, decision_id: 'JURITEXT9', quote: 'motif jamais lu dans ce tour' },
  ]));
  const suffix = await turn.finish();
  assert.match(suffix, /^- \[1\] 🔴 \[bail, p\. 2\]\[1\] — \[à vérifier – introuvable\] — passage le plus proche : « Le preneur occupera les lieux paisiblement pendant toute la durée du bail »$/m);
  assert.match(suffix, /^- \[2\] 🔴 \[bail, p\. 1\]\[2\] — \[à vérifier – introuvable\]$/m);
  assert.match(suffix, /^- \[3\] 🔴 \[JURITEXT9\]\[3\] — \[à vérifier – introuvable\]$/m);
});

test('le titre d’une pièce vient de la base : label daté, sinon nature et date, sinon nom', async (t) => {
  const { cwd, store } = await fixture(t);
  await writeFile(path.join(cwd, 'courrier.md'), 'Je vous mets en demeure de payer.');
  const seen: string[] = [];
  const turn = createCitationTurn({ cwd, sessionId: 'session', store, pieceTitle: (folder, docId) => { seen.push(`${folder}|${docId}`); return 'Mise en demeure (12/03/2024)'; } });
  turn.text(block([{ ref: 1, doc_id: 'courrier.md', quotes: [{ page: 1, quote: 'Je vous mets en demeure de payer.' }] }]));
  const suffix = await turn.finish();
  assert.deepEqual(seen, [`${cwd}|courrier.md`]);
  assert.match(suffix, /- \[1\] \[Mise en demeure \(12\/03\/2024\), p\. 1\]\[1\] — « Je vous mets en demeure de payer\. »/);
  const token = /#piecemaker-citation=([a-f0-9]{64})/.exec(suffix)?.[1];
  assert.equal((await store.read(token ?? ''))?.title, 'Mise en demeure (12/03/2024)');
  assert.equal(formatPieceTitle({ label: '2024-03-12_Contrat_de_bail.pdf' }, 'x.md'), 'Contrat de bail (12/03/2024)');
  assert.equal(formatPieceTitle({ label: 'scan 4.pdf', nature: 'contrat', doc_date: '2024-03-12' }, 'x.md'), 'Contrat du 12/03/2024');
  assert.equal(formatPieceTitle({ label: 'scan 4.pdf', nature: 'contrat' }, 'x.md'), 'scan 4');
  assert.equal(formatPieceTitle(undefined, 'conversions/scan 4.md'), 'scan 4');
});

test('Mistral : outil Vibe legifrance_consulter_decision, résultat porté par le tool_use', async (t) => {
  const { turn } = await fixture(t);
  const base = { provider: 'mistral' as const, sessionId: 'session', kind: 'tool_use' as const, toolId: 'call-1', toolName: 'legifrance_consulter_decision' };
  turn.observe(createNormalizedMessage({ ...base, toolInput: { text_id: 'JURITEXT1' } }));
  turn.observe(createNormalizedMessage({ ...base, toolInput: {}, toolResult: { content: 'TEXTE INTÉGRAL:\n=====\nExtrait lu par Vibe.', isError: false } }));
  turn.text(block([{ ref: 1, decision_id: 'JURITEXT1', quote: 'Extrait lu par Vibe.' }]));
  assert.match(await turn.finish(), /^- \[1\] \[JURITEXT1\]\[1\] — « Extrait lu par Vibe\. »$/m);
});
