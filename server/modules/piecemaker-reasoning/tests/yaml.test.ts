import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { parseReasoningDocument, printReasoningDocument } from '../document.js';
import { parseLiteral, readReasoning } from '../format.js';
import { EXAMPLE_CODE, EXAMPLE_SOURCES, verifyReasoning } from '../program.js';
import type { ReasoningConnectors, SourceInfo } from '../program.js';

const connectors: ReasoningConnectors = {
  source: async (_cwd, id) => EXAMPLE_SOURCES[id] ?? null,
  match: (text, excerpt) => text.includes(excerpt) ? excerpt : null,
  registry: async () => ({ found: true, status: 'active' }),
  bodacc: async () => [],
};
const verify = (code: string, format: 'js' | 'yaml', selected = connectors) => verifyReasoning({ code, format, cwd: '/dossier-fictif', connectors: selected, reliability: new Map(), persons: [], nature: () => null, dismissed: new Set() });
const withoutLines = (issues: Awaited<ReturnType<typeof verify>>['issues']) => issues.map(({ line: _line, ...issue }) => issue);
const orderedPieces = (value: Record<string, unknown> | null) => {
  const copy = structuredClone(value);
  const bilan = copy?.bilan as { pieces_a_evaluer_par_l_avocat?: string[] } | undefined;
  bilan?.pieces_a_evaluer_par_l_avocat?.sort();
  return copy;
};

test('YAML et JS produisent les mêmes statuts, hypothèses, manques et calculs', async () => {
  const yaml = printReasoningDocument(parseLiteral(EXAMPLE_CODE).value, 'yaml');
  const js = await verify(EXAMPLE_CODE, 'js');
  const converted = await verify(yaml, 'yaml');
  assert.deepEqual(converted.annotated, js.annotated);
  assert.deepEqual(withoutLines(converted.issues), withoutLines(js.issues));
  assert.deepEqual(converted.log, js.log);
  assert.deepEqual(parseReasoningDocument(converted.code, 'yaml').value, parseLiteral(js.code).value);
  for (const issue of converted.issues) if (issue.line) assert.ok(converted.code.split('\n')[issue.line - 1].trim());
  assert.equal((await verify(converted.code, 'yaml')).code, converted.code);
});

test('les objets archivés et les deux rédactions Luna restent identiques après changement de format', async () => {
  const root = path.resolve('docs/tests/acte-redige-haiku');
  const sources: Record<string, SourceInfo> = {};
  for (const line of (await readFile(path.join(root, 'SOURCES.md'), 'utf8')).split('\n')) {
    const match = /^- (LEGIARTI\d+) — (.*?) — en vigueur depuis le ([\d-]+) : « (.*) »$/u.exec(line);
    if (match) sources[match[1]] = { kind: 'texte', title: match[2], text: match[4], validity: { from: match[3], to: null } };
  }
  const fixture: ReasoningConnectors = { ...connectors, source: async (_cwd, id) => sources[id] ?? (id.startsWith('pieces/') ? { kind: 'piece', title: id, text: await readFile(path.join(root, id), 'utf8') } : null) };
  for (const name of ['phase1-raisonnement.js', 'phase2-essai-avant-correctif.js', 'phase2-raisonnement-apres-fusion.js', 'phase3-raisonnement-importe.js', '../raisonnement-yaml-luna/luna-js.js', '../raisonnement-yaml-luna/luna-yaml.yaml']) {
    const code = await readFile(path.resolve('docs/tests/acte-redige-haiku', name), 'utf8');
    const value = parseReasoningDocument(code, name.endsWith('.yaml') ? 'yaml' : 'js').value;
    const yaml = printReasoningDocument(value, 'yaml');
    const literal = printReasoningDocument(value, 'js');
    assert.deepEqual(parseReasoningDocument(yaml, 'yaml').value, value, name);
    assert.deepEqual(parseLiteral(literal).value, value, name);
    const js = await verify(literal, 'js', fixture);
    const converted = await verify(yaml, 'yaml', fixture);
    assert.deepEqual(orderedPieces(converted.annotated), orderedPieces(js.annotated), name);
    assert.deepEqual(withoutLines(converted.issues), withoutLines(js.issues), name);
  }
});

test('objectifs et clés métier restent obligatoires sans limiter les noms de termes', async () => {
  const missing = await verify('terme_libre:\n  si:\n    - condition: fait_libre\n', 'yaml');
  assert.ok(missing.issues.some((issue) => issue.kind === 'erreur' && issue.path === 'objectifs'));
  assert.ok((await verify('objectifs: []', 'yaml')).issues.some((issue) => issue.kind === 'erreur' && issue.path === 'objectifs'));
  const wrong = await verify('objectifs: []\nterme_libre:\n  parce_que: fait_libre\n', 'yaml');
  assert.ok(wrong.issues.some((issue) => issue.text.includes('clé inconnue')));
  const value = { objectifs: [{ objectif: 'Obtenir un effet fictif', obtenir: 'effet_à_établir' }], effet_à_établir: { si: [{ condition: 'fait_entièrement_libre', selon: [{ source: 'LEGIARTI000000000001', citation: 'Règle entièrement fictive' }] }] } };
  assert.deepEqual(readReasoning(parseReasoningDocument(printReasoningDocument(value, 'yaml'), 'yaml').value).problems, []);
});

test('types, citations multilignes, dates, booléens et alias non cycliques sont préservés', () => {
  const value = parseReasoningDocument('texte: |\n  Première ligne.\n  Deuxième ligne.\ndate: 2025-01-31\nactif: true\nabsent: false\ninconnu: null\nbase: &base\n  condition: fait\nreprise: *base\n', 'yaml').value;
  assert.deepEqual(value, { texte: 'Première ligne.\nDeuxième ligne.\n', date: '2025-01-31', actif: true, absent: false, inconnu: null, base: { condition: 'fait' }, reprise: { condition: 'fait' } });
});

test('la correction d’une citation échappée reste du YAML valide', async () => {
  const original = 'Règle : "oui".\nSuite.';
  const fixed = 'RÈGLE : "oui".\nSuite.';
  const value = { objectifs: [{ objectif: 'Obtenir un effet fictif', obtenir: 'effet' }], effet: { si: [{ condition: 'fait', selon: [{ source: 'LEGIARTI000000000001', citation: original }] }] } };
  const result = await verify(printReasoningDocument(value, 'yaml'), 'yaml', { ...connectors, source: async () => ({ kind: 'texte', title: 'Règle fictive', text: fixed }), match: () => fixed });
  const corrected = parseReasoningDocument(result.code, 'yaml').value as typeof value;
  assert.equal(corrected.effet.si[0].selon[0].citation, fixed);
});

test('les doublons, documents multiples, tags, commentaires et alias circulaires ne passent pas silencieusement', () => {
  for (const text of ['objectifs: []\nobjectifs: []', 'objectifs: []\n---\nobjectifs: []', 'cle: !inconnue valeur', '# note\nobjectifs: []', 'cle: &boucle\n  suite: *boucle', 'cle: .nan', '42: valeur']) {
    assert.throws(() => parseReasoningDocument(text, 'yaml'), /ligne \d+/u, text);
  }
});

test('les chemins gardent leurs lignes YAML et les chaînes profondes partagent les faits', async () => {
  const value: Record<string, unknown> = { objectifs: [{ objectif: 'Obtenir la racine', obtenir: 'niveau_0' }] };
  for (let index = 0; index < 80; index += 1) value[`niveau_${index}`] = { si: [{ condition: index === 79 ? 'fait_commun' : `niveau_${index + 1}` }] };
  const yaml = printReasoningDocument(value, 'yaml');
  const parsed = parseReasoningDocument(yaml, 'yaml');
  assert.match(yaml.split('\n')[parsed.lines.get('niveau_79.si[0].condition')! - 1], /condition: fait_commun/u);
  const js = await verify(printReasoningDocument(value, 'js'), 'js');
  const converted = await verify(yaml, 'yaml');
  assert.deepEqual(converted.annotated, js.annotated);
  assert.deepEqual(withoutLines(converted.issues), withoutLines(js.issues));
});
