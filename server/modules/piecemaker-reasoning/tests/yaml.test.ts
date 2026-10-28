import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { parseReasoningDocument, printReasoningDocument, ReasoningSyntaxError } from '../document.js';
import { parseLiteral, readReasoning } from '../format.js';
import { EXAMPLE_CODE, EXAMPLE_SOURCES, verifyReasoning } from '../program.js';
import type { ReasoningConnectors, SourceInfo } from '../program.js';
import { EXAMPLE_LITERAL } from './fixtures.js';

const connectors: ReasoningConnectors = {
  source: async (_cwd, id) => EXAMPLE_SOURCES[id] ?? null,
  match: (text, excerpt) => text.includes(excerpt) ? excerpt : null,
  registry: async () => ({ found: true, status: 'active' }),
  bodacc: async () => [],
};
const verify = (code: string, selected = connectors) => verifyReasoning({ code, cwd: '/dossier-fictif', connectors: selected, reliability: new Map(), persons: [], nature: () => null, dismissed: new Set() });
const syntax = (text: string) => {
  try { parseReasoningDocument(text); } catch (error) { if (error instanceof ReasoningSyntaxError) return error.problems.map((problem) => problem.message); throw error; }
  return [];
};

test('l’exemple fictif est en YAML, se vérifie et se réécrit à l’identique', async () => {
  assert.deepEqual(parseReasoningDocument(EXAMPLE_CODE).value, parseLiteral(EXAMPLE_LITERAL).value);
  const result = await verify(EXAMPLE_CODE);
  assert.deepEqual(result.issues.filter((issue) => issue.kind === 'erreur'), []);
  for (const issue of result.issues) if (issue.line) assert.ok(result.code.split('\n')[issue.line - 1].trim());
  assert.equal((await verify(result.code)).code, result.code);
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

test('les objets archivés et les deux rédactions Luna se transcrivent en YAML sans perte', async () => {
  const root = path.resolve('docs/tests/acte-redige-haiku');
  const sources: Record<string, SourceInfo> = {};
  for (const line of (await readFile(path.join(root, 'SOURCES.md'), 'utf8')).split('\n')) {
    const match = /^- (LEGIARTI\d+) — (.*?) — en vigueur depuis le ([\d-]+) : « (.*) »$/u.exec(line);
    if (match) sources[match[1]] = { kind: 'texte', title: match[2], text: match[4], validity: { from: match[3], to: null } };
  }
  const fixture: ReasoningConnectors = { ...connectors, source: async (_cwd, id) => sources[id] ?? (id.startsWith('pieces/') ? { kind: 'piece', title: id, text: await readFile(path.join(root, id), 'utf8') } : null) };
  for (const name of ['phase1-raisonnement.js', 'phase2-essai-avant-correctif.js', 'phase2-raisonnement-apres-fusion.js', 'phase3-raisonnement-importe.js', '../raisonnement-yaml-luna/luna-js.js', '../raisonnement-yaml-luna/luna-yaml.yaml']) {
    const code = await readFile(path.resolve('docs/tests/acte-redige-haiku', name), 'utf8');
    const value = migrate((name.endsWith('.yaml') ? parseReasoningDocument(code) : parseLiteral(code)).value as Json);
    const yaml = printReasoningDocument(value);
    assert.deepEqual(parseReasoningDocument(yaml).value, value, name);
    const verified = await verify(yaml, fixture);
    assert.ok(verified.annotated, name);
    assert.deepEqual(verified.issues.filter((issue) => issue.kind === 'erreur' && !issue.path), [], name);
  }
});

test('objectifs et clés métier restent obligatoires sans limiter les noms de termes', async () => {
  const missing = await verify('terme_libre:\n  si:\n    - fait_libre: true\n');
  assert.ok(missing.issues.some((issue) => issue.kind === 'erreur' && issue.path === 'objectifs'));
  assert.ok((await verify('objectifs: []')).issues.some((issue) => issue.kind === 'erreur' && issue.path === 'objectifs'));
  const wrong = await verify('objectifs: []\nterme_libre:\n  parce_que: fait_libre\n');
  assert.ok(wrong.issues.some((issue) => issue.text.includes('clé inconnue')));
  const value = { objectifs: [{ objectif: 'Obtenir un effet fictif', obtenir: 'effet_à_établir' }], effet_à_établir: { si: [{ fait_entièrement_libre: true, selon: [{ source: 'LEGIARTI000000000001', citation: 'Règle entièrement fictive' }] }] } };
  assert.deepEqual(readReasoning(parseReasoningDocument(printReasoningDocument(value)).value).problems, []);
});

test('types, citations multilignes, dates et booléens sont préservés', () => {
  const value = parseReasoningDocument('texte: |\n  Première ligne.\n  Deuxième ligne.\ndate: 2025-01-31\nactif: true\nabsent: false\ninconnu: null\ncitation: "Article 3 : le prix"\n').value;
  assert.deepEqual(value, { texte: 'Première ligne.\nDeuxième ligne.\n', date: '2025-01-31', actif: true, absent: false, inconnu: null, citation: 'Article 3 : le prix' });
});

test('la correction d’une citation échappée reste du YAML valide', async () => {
  const original = 'Règle : "oui".\nSuite.';
  const fixed = 'RÈGLE : "oui".\nSuite.';
  const value = { objectifs: [{ objectif: 'Obtenir un effet fictif', obtenir: 'effet' }], effet: { si: [{ fait: true, selon: [{ source: 'LEGIARTI000000000001', citation: original }] }] } };
  const result = await verify(printReasoningDocument(value), { ...connectors, source: async () => ({ kind: 'texte', title: 'Règle fictive', text: fixed }), match: () => fixed });
  const corrected = parseReasoningDocument(result.code).value as typeof value;
  assert.equal(corrected.effet.si[0].selon[0].citation, fixed);
});

test('les doublons, documents multiples, tags, commentaires, ancres et alias ne passent pas silencieusement', () => {
  for (const text of ['objectifs: []\nobjectifs: []', 'objectifs: []\n---\nobjectifs: []', 'cle: !inconnue valeur', '# note\nobjectifs: []', 'cle: &boucle\n  suite: *boucle', 'base: &base\n  fait: true\nreprise: *base\n', 'cle: .nan', '42: valeur']) {
    assert.throws(() => parseReasoningDocument(text), /ligne \d+/u, text);
  }
});

test('une valeur à mettre entre guillemets est signalée avec la ligne corrigée', () => {
  assert.deepEqual(syntax('a:\n  - piece: p.md\n    citation: la société : le courrier\n'), ['ligne 3 : guillemets : « : » suivi d’une espace se lit comme une nouvelle clé ; écris citation: "la société : le courrier"']);
  assert.deepEqual(syntax('a:\n  citation: voir le point #3 du contrat\n'), ['ligne 2 : guillemets : « # » ouvre un commentaire et coupe la valeur ; écris citation: "voir le point #3 du contrat"']);
  assert.deepEqual(syntax('a:\n  citation: "le" courrier\n'), ['ligne 2 : guillemets : la valeur commence par un guillemet mais ne s’y termine pas ; écris citation: "\\"le\\" courrier"']);
  assert.match(syntax('a:\n  citation: *important\n')[0], /^ligne 2 : guillemets : « \* » en début de valeur a un sens en YAML/);
  assert.match(syntax('a:\n  citation: ! le prix\n')[0], /^ligne 2 : guillemets : « ! » en début de valeur/);
  assert.match(syntax('a:\n  citation: [sic] le courrier\n')[0], /^ligne 2 : guillemets : « \[ » en début de valeur/);
  assert.deepEqual(syntax('acte:\n  - texte:\n      - **La pénalité est donc due.**\n'), ['ligne 3 : guillemets : « * » en début de valeur a un sens en YAML ; écris - "**La pénalité est donc due.**"']);
  assert.deepEqual(syntax('acte:\n  - texte:\n      - La société : elle a payé.\n'), ['ligne 3 : guillemets : « : » suivi d’une espace se lit comme une nouvelle clé ; écris - "La société : elle a payé."']);
  assert.deepEqual(syntax('a:\n  citation: "le courrier\n  b: 1\n'), ['ligne 2 : guillemets : guillemet ouvert et jamais fermé ; ferme-le à la fin de la valeur']);
});

test('une ligne mal indentée est signalée avec le niveau sur lequel l’aligner', () => {
  assert.deepEqual(syntax('a:\n  si:\n    - b: true\n   - c: true\n'), ['ligne 4 : indentation : « - c: true » commence après 3 espace(s), ce qui ne la rattache à aucun bloc ; aligne-la sur 4 espace(s), comme la ligne 3 (« - b: true »)']);
  assert.deepEqual(syntax('a:\n  si:\n    - b: true\n        selon: []\n'), ['ligne 4 : indentation : « selon: [] » commence après 8 espace(s), ce qui ne la rattache à aucun bloc ; aligne-la sur 6 espace(s), comme la ligne 3 (« - b: true »)']);
  assert.deepEqual(syntax('a:\n\t- b: true\n'), ['ligne 2 : tabulation : indente uniquement avec des espaces']);
  assert.deepEqual(syntax('a:\n  si: []\n  si: []\n'), ['ligne 3 : clé en double si : elle figure déjà plus haut au même niveau ; réunis les deux blocs sous une seule clé']);
});

test('le vérificateur rend toutes les fautes de syntaxe d’un coup, chacune avec sa ligne', async () => {
  const result = await verify('objectifs:\n  - objectif: Obtenir : un effet\n    obtenir: effet\neffet:\n  si:\n    - b: true\n   - c: true\n');
  assert.equal(result.annotated, null);
  assert.deepEqual(result.issues.map((issue) => [issue.kind, issue.line]), [['erreur', 2], ['erreur', 7]]);
});

test('une clé mal placée ou mal orthographiée est nommée avec sa place ou sa bonne graphie', async () => {
  const at = async (code: string) => (await verify(code)).issues.filter((issue) => issue.kind === 'erreur').map((issue) => `${issue.path} : ${issue.text}`).join('\n');
  const head = 'objectifs:\n  - objectif: Obtenir un effet fictif\n    obtenir: effet\n';
  assert.match(await at(`${head}effet:\n  si:\n    - fait: true\n  selon:\n    - source: LEGIARTI000000000001\n      citation: Règle\n`), /effet\.selon : selon n’a pas sa place ici : c’est une clé d’une condition, un fondement ou une valeur ; vérifie son indentation \(admises ici : si, sauf\)/);
  assert.match(await at(`${head}effet:\n  si:\n    - fait: true\n      seleon:\n        - source: LEGIARTI000000000001\n          citation: Règle\n`), /effet\.si\[0\]\.seleon : clé inconnue seleon : écris selon/);
  assert.match(await at(`${head}hypothèses: []\n`), /hypothèses : clé inconnue hypothèses : écris hypotheses/);
  assert.match(await at(`${head}effet:\n  si:\n    - fait: true\nselon: []\n`), /selon : selon n’a pas sa place au premier niveau : c’est une clé d’une condition, un fondement ou une valeur ; vérifie son indentation/);
  assert.match(await at(`${head}effet:\n  true:\n    - preuve:\n        - piece: p.md\n          citaton: passage\n`), /effet\.true\[0\]\.preuve\[0\]\.citaton : clé inconnue citaton : écris citation/);
});

test('les chemins gardent leurs lignes YAML et les chaînes profondes partagent les faits', async () => {
  const value: Record<string, unknown> = { objectifs: [{ objectif: 'Obtenir la racine', obtenir: 'niveau_0' }] };
  for (let index = 0; index < 80; index += 1) value[`niveau_${index}`] = { si: [{ [index === 79 ? 'fait_commun' : `niveau_${index + 1}`]: true }] };
  const yaml = printReasoningDocument(value);
  const parsed = parseReasoningDocument(yaml);
  assert.match(yaml.split('\n')[parsed.lines.get('niveau_79.si[0].fait_commun')! - 1], /fait_commun: true/u);
  assert.ok((await verify(yaml)).annotated);
});

test('les clés true et false d’une question survivent à la lecture et à la réécriture', async () => {
  assert.match(EXAMPLE_CODE, /^ {2}true:$/m);
  assert.match(EXAMPLE_CODE, /^ {2}false:$/m);
  assert.doesNotMatch(EXAMPLE_CODE, /["']true["']|["']false["']/);
  const parsed = parseReasoningDocument(EXAMPLE_CODE).value as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(parsed.retard_de_livraison), ['true']);
  assert.deepEqual(Object.keys(parsed.grève_du_secteur), ['false']);
  assert.deepEqual(parseReasoningDocument('q:\n  "true":\n    - preuve: []\n  false: []\n').value, { q: { true: [{ preuve: [] }], false: [] } });
  const rewritten = await verify(EXAMPLE_CODE);
  assert.match(rewritten.code, /^ {2}true:$/m);
  assert.equal((await verify(rewritten.code)).code, rewritten.code);
});
