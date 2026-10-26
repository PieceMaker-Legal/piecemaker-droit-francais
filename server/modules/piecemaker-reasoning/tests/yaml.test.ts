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

type Json = Record<string, any>;
const RESERVED_KEYS = new Set(['objectifs', 'qualification', 'valeurs', 'hypotheses', 'acte', 'bilan']);
const migrate = (source: Json): Json => {
  const terms = new Set(Object.keys(source).filter((key) => !RESERVED_KEYS.has(key)));
  const questions: Record<string, Partial<Record<'true' | 'false', Json[]>>> = {};
  const settle = (name: string, side: 'true' | 'false', refs: Json[]) => {
    if (terms.has(name) || !refs.length) return;
    ((questions[name] ??= {})[side] ??= []).push({ preuve: refs });
  };
  const condition = (entry: Json): Json => {
    const { condition: name, preuve, contredit, l_une: choice, selon, ...rest } = entry;
    const bases = selon?.map(({ contredit: _contredit, ...basis }: Json) => basis);
    if (choice) return { l_une: choice.map(condition), ...(bases ? { selon: bases } : {}), ...rest };
    settle(name, 'true', preuve ?? []);
    settle(name, 'false', contredit ?? []);
    return { [name]: true, ...(bases ? { selon: bases } : {}), ...rest };
  };
  const result: Json = {};
  for (const [key, entry] of Object.entries(source)) {
    if (RESERVED_KEYS.has(key)) result[key] = entry;
    else result[key] = Object.fromEntries(Object.entries(entry).map(([field, list]) => [field, Array.isArray(list) ? list.map(condition) : list]));
  }
  return { ...result, ...questions };
};

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
    const value = migrate(parseReasoningDocument(code, name.endsWith('.yaml') ? 'yaml' : 'js').value as Json);
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
  const missing = await verify('terme_libre:\n  si:\n    - fait_libre: true\n', 'yaml');
  assert.ok(missing.issues.some((issue) => issue.kind === 'erreur' && issue.path === 'objectifs'));
  assert.ok((await verify('objectifs: []', 'yaml')).issues.some((issue) => issue.kind === 'erreur' && issue.path === 'objectifs'));
  const wrong = await verify('objectifs: []\nterme_libre:\n  parce_que: fait_libre\n', 'yaml');
  assert.ok(wrong.issues.some((issue) => issue.text.includes('clé inconnue')));
  const value = { objectifs: [{ objectif: 'Obtenir un effet fictif', obtenir: 'effet_à_établir' }], effet_à_établir: { si: [{ fait_entièrement_libre: true, selon: [{ source: 'LEGIARTI000000000001', citation: 'Règle entièrement fictive' }] }] } };
  assert.deepEqual(readReasoning(parseReasoningDocument(printReasoningDocument(value, 'yaml'), 'yaml').value).problems, []);
});

test('types, citations multilignes, dates, booléens et alias non cycliques sont préservés', () => {
  const value = parseReasoningDocument('texte: |\n  Première ligne.\n  Deuxième ligne.\ndate: 2025-01-31\nactif: true\nabsent: false\ninconnu: null\nbase: &base\n  fait: true\nreprise: *base\n', 'yaml').value;
  assert.deepEqual(value, { texte: 'Première ligne.\nDeuxième ligne.\n', date: '2025-01-31', actif: true, absent: false, inconnu: null, base: { fait: true }, reprise: { fait: true } });
});

test('la correction d’une citation échappée reste du YAML valide', async () => {
  const original = 'Règle : "oui".\nSuite.';
  const fixed = 'RÈGLE : "oui".\nSuite.';
  const value = { objectifs: [{ objectif: 'Obtenir un effet fictif', obtenir: 'effet' }], effet: { si: [{ fait: true, selon: [{ source: 'LEGIARTI000000000001', citation: original }] }] } };
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
  for (let index = 0; index < 80; index += 1) value[`niveau_${index}`] = { si: [{ [index === 79 ? 'fait_commun' : `niveau_${index + 1}`]: true }] };
  const yaml = printReasoningDocument(value, 'yaml');
  const parsed = parseReasoningDocument(yaml, 'yaml');
  assert.match(yaml.split('\n')[parsed.lines.get('niveau_79.si[0].fait_commun')! - 1], /fait_commun: true/u);
  const js = await verify(printReasoningDocument(value, 'js'), 'js');
  const converted = await verify(yaml, 'yaml');
  assert.deepEqual(converted.annotated, js.annotated);
  assert.deepEqual(withoutLines(converted.issues), withoutLines(js.issues));
});

test('les clés true et false d’une question survivent à la lecture, à la réécriture et au passage JS', async () => {
  const yaml = printReasoningDocument(parseLiteral(EXAMPLE_CODE).value, 'yaml');
  assert.match(yaml, /^ {2}true:$/m);
  assert.match(yaml, /^ {2}false:$/m);
  assert.doesNotMatch(yaml, /["']true["']|["']false["']/);
  const parsed = parseReasoningDocument(yaml, 'yaml').value as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(parsed.retard_de_livraison), ['true']);
  assert.deepEqual(Object.keys(parsed.grève_du_secteur), ['false']);
  assert.deepEqual(parseReasoningDocument('q:\n  "true":\n    - preuve: []\n  false: []\n', 'yaml').value, { q: { true: [{ preuve: [] }], false: [] } });
  const rewritten = await verify(yaml, 'yaml');
  assert.deepEqual(rewritten.issues.filter((issue) => issue.kind === 'erreur'), []);
  assert.match(rewritten.code, /^ {2}true:$/m);
  assert.equal((await verify(rewritten.code, 'yaml')).code, rewritten.code);
  const literal = await verify(EXAMPLE_CODE, 'js');
  assert.match(literal.code, /\n {4}true: \[/);
  assert.deepEqual(parseLiteral(literal.code).value, parseReasoningDocument(rewritten.code, 'yaml').value);
});
