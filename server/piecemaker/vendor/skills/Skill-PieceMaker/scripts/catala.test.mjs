import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { catalaHomes, compilerErrors, findCatalaPack, listPrograms, pisteCredentials, runCatala, selectProgram, sharedPython, toolCommand, typecheckErrors } from './catala.mjs';
import { catalaDocumentation } from './catala-documentation.mjs';
import { run } from './pm.mjs';

const MODULE = '> Module Prime\n\n```catala-metadata\ndéclaration champ d\'application Prime:\n  résultat montant contenu argent\n```\n';
const TASK = { tache: 'Calcul de la prime de Jean Dupont', type: 'litigation', date_vigueur: '2024-01-15', raisonnements: [{ champ: 'Prime', objectif: 'Calculer la prime' }] };
const TESTS = '> Usage de Prime\n\n```catala\n#[test]\ndéclaration champ d\'application JeanDupont:\n  résultat calcul champ d\'application Prime.Prime\n\nchamp d\'application JeanDupont:\n  assertion calcul.montant = 0 €\n```\n';

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-catala-'));
  const home = path.join(root, 'home');
  const dossier = path.join(root, 'dossier');
  const pack = { id: 'p', bin: Object.fromEntries(['catala', 'clerk', 'catala-lsp', 'catala-format', 'catala-dap'].map((name) => [name, path.join(root, 'bin', name)])), path: [path.join(root, 'bin')], env: { OPAMSWITCH: 'catala' }, runtimePython: path.join(root, 'runtime'), proof: true };
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  for (const binary of Object.values(pack.bin)) fs.writeFileSync(binary, '');
  fs.mkdirSync(path.join(home, 'catala'), { recursive: true });
  fs.writeFileSync(path.join(home, 'catala', 'pack.json'), JSON.stringify(pack));
  return { root, home, dossier, pack, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function program(dossier, name, files = { 'prime.catala_fr': MODULE, 'test_prime.catala_fr': TESTS }) {
  const directory = path.join(dossier, '.piecemaker', 'catala', name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'clerk.toml'), `[project]\nname = "${name}"\n`);
  fs.writeFileSync(path.join(directory, 'tache.json'), JSON.stringify(TASK));
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, file), content);
  return directory;
}

function fakeRun({ testsPass = true, proofOutput = 'No errors found during the proof mode run.\n', scopes = [{ scope_name: 'JeanDupont', success: testsPass, errors: [], time: 0.1 }] } = {}) {
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command: path.basename(command), args, cwd: options.cwd, env: options.env });
    const tool = path.basename(command);
    if (tool === 'catala-format') return { code: 0, stdout: fs.readFileSync(path.join(options.cwd, args.at(-1)), 'utf8'), stderr: '' };
    if (tool === 'clerk' && args[0] === 'runtest') fs.writeFileSync(path.join(options.cwd, args.find((arg) => arg.startsWith('--report=')).slice(9)), 'report');
    if (tool === 'clerk' && args[0] === 'report') {
      return { code: testsPass ? 0 : 1, stdout: JSON.stringify({ 'test-results': [{ file: path.join(options.cwd, 'test_prime.catala_fr'), tests: { scopes, 'inline-tests': [] } }], coverage: {} }), stderr: '' };
    }
    if (tool === 'catala' && args[0] === 'dependency-graph') return { code: 0, stdout: JSON.stringify({ inter_scopes: { nodes: { 1: 'Prime', 2: 'AutrePrime' } } }), stderr: '' };
    if (args.includes('lf')) return { code: 0, stdout: JSON.stringify({ article: { id: 'LEGIARTI000000000001', dateDebut: '2020-01-01', dateFin: '2999-01-01' } }), stderr: '' };
    if (args.includes('check-expiry')) return { code: 0, stdout: 'PIECEMAKER_ARTICLES=[{"id":"LEGIARTI000000000001","archive":false}]', stderr: '' };
    if (tool === 'catala' && args[0] === 'explain') return { code: 0, stdout: 'digraph G { x001 [label=<Prime>] }', stderr: '' };
    if (tool === 'catala' && args[0] === 'proof') return { code: 0, stdout: proofOutput, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { calls, runner };
}

test('the pack and the shared Python are found under the components roots', () => {
  const { home, root, cleanup } = scratch();
  try {
    assert.deepEqual(catalaHomes({ PIECEMAKER_HOME: home }, '/home/jean'), [home, path.join('/home/jean', '.piecemaker')]);
    assert.equal(findCatalaPack({ env: { PIECEMAKER_HOME: path.join(root, 'autre'), PIECEMAKER_COMPONENTS_HOME: home }, homeDir: root }).home, home);
    assert.equal(findCatalaPack({ env: {}, homeDir: root }).pack, null);
    const python = path.join(root, 'python3');
    fs.writeFileSync(python, '');
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ pythonPath: python }));
    assert.equal(sharedPython({ env: { PIECEMAKER_HOME: home }, homeDir: root }), python);
  } finally {
    cleanup();
  }
});

test('verifier stores every test scenario and keeps failed assertions distinct from trace results', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime');
    const scopes = [
      { scope_name: 'AvecDemande', success: true, errors: [] },
      { scope_name: 'SansDemande', success: true, errors: [] },
      { scope_name: 'AssertionFausse', success: false, errors: [{ message: 'Assertion fausse.' }] },
    ];
    const { runner } = fakeRun({ scopes });
    const run = async (command, args, options) => {
      if (args[0] === 'explain') {
        const scope = args[args.indexOf('-s') + 1];
        return { code: scope === 'AssertionFausse' ? 1 : 0, stdout: scope === 'AssertionFausse' ? '' : `digraph G { x001 [label=<${scope}>] }`, stderr: scope === 'AssertionFausse' ? 'Assertion fausse.' : '' };
      }
      return runner(command, args, options);
    };
    await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run, python: null, credentials: null } });
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'scenarios.json'), 'utf8'));
    assert.deepEqual(saved.scenarios.map((scenario) => [scenario.scope, scenario.test_reussi, scenario.passed]), [['AvecDemande', true, true], ['SansDemande', true, true], ['AssertionFausse', false, false]]);
    assert.match(saved.scenarios[1].graphe, /SansDemande/);
    assert.equal(saved.scenarios[2].graphe, '');
    assert.match(saved.scenarios[2].message, /Assertion fausse/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'tests.json'), 'utf8')).sources_sha256, saved.sources_sha256);
  } finally { cleanup(); }
});

test('expliquer retains native provenance and succeeds through JSON when explain cannot render the program', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime');
    const position = { file: 'prime.catala_fr', start: { line: 4, character: 1 }, end: { line: 4, character: 10 }, law_headings: ['Texte fictif'] };
    const { runner } = fakeRun();
    const run = async (command, args, options) => {
      if (args[0] === 'explain') return { code: 1, stdout: '', stderr: 'Explication indisponible.' };
      if (args[0] === 'interpret') {
        fs.writeFileSync(args.find((arg) => arg.startsWith('--trace=')).slice(8), JSON.stringify([{ element: { kind: 'scope_call', name: 'Prime', decl_pos: position }, pos: position, value: {}, trace: [{ element: { kind: 'scope_var', name: 'montant', decl_pos: position, output: true }, pos: position, value: 10 }] }]));
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'dependency-graph') return { code: 0, stdout: JSON.stringify({ intra_scopes: { Prime: { nodes: { 1: 'montant' }, edges: [] } } }), stderr: '' };
      if (args[0] === 'exceptions') return { code: 0, stdout: JSON.stringify({ scope: 'Prime', variable: 'montant', trees: [] }), stderr: '' };
      return runner(command, args, options);
    };
    await runCatala({ commande: 'expliquer', cwd: dossier, flags: { fichier: 'test_prime.catala_fr', scope: 'JeanDupont' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run } });
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'explication.json'), 'utf8'));
    assert.equal(report.passed, true);
    assert.equal(report.provenance.trace[0].trace[0].value, 10);
    assert.equal(report.provenance.definitions[0].variable, 'montant');
    assert.equal(report.provenance.dependencies[0].intra_scopes.Prime.nodes[1], 'montant');
    assert.match(report.provenance.issues[0], /DOT indisponible/);
    assert.equal(fs.readFileSync(path.join(directory, 'resultats', 'explication.dot'), 'utf8'), '');
  } finally { cleanup(); }
});

test('verifier names the scenario, the line and the fix when explain crashes on an unset condition', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    program(dossier, 'prime');
    const crash = '┌─[ERROR]─\n│\n│  Oh no, you found a bug in the compiler!\n│  Please report to https://github.com/CatalaLang/catala/issues.\n│\n│  Operator && applied to the wrong arguments\n│\n│ Operator (value &&):\n├─➤ prime.catala_fr:9.20-22:\n│ 9 │     si eligible et anciennete_acquise alors bonus sinon 0 €\n│ Argument n°2, value ø\n├─➤ prime.catala_fr:5.12-30:\n│ 5 │   contexte anciennete_acquise condition\n└─\n';
    const { runner } = fakeRun();
    const run = async (command, args, options) => (args[0] === 'explain' ? { code: 123, stdout: '', stderr: crash } : runner(command, args, options));
    const text = await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run, python: null, credentials: null } });
    assert.match(text, /explication : échec[^\n]*\n  test_prime\.catala_fr › JeanDupont \(prime\.catala_fr:9\) : Operator && applied to the wrong arguments — [^\n]*règle calcul\.anciennete_acquise non rempli/);
    assert.doesNotMatch(text, /Aucun scénario réussi/);
  } finally { cleanup(); }
});

test('verifier computes dependencies and exceptions once for all scenarios', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime');
    const position = { file: 'prime.catala_fr', start: { line: 4, character: 1 }, end: { line: 4, character: 10 }, law_headings: ['Texte fictif'] };
    const scopes = [{ scope_name: 'AvecDemande', success: true, errors: [] }, { scope_name: 'SansDemande', success: true, errors: [] }];
    const { runner } = fakeRun({ scopes });
    const counts = new Map();
    const run = async (command, args, options) => {
      if (args[0] === 'interpret') {
        fs.writeFileSync(args.find((arg) => arg.startsWith('--trace=')).slice(8), JSON.stringify([{ element: { kind: 'scope_call', name: 'Prime', decl_pos: { ...position } }, pos: { ...position }, value: {}, trace: [{ element: { kind: 'scope_var', name: 'montant', decl_pos: { ...position }, output: true }, pos: { ...position }, value: 10 }] }]));
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'dependency-graph' && args.includes('prime.catala_fr') && !args.includes('--whole-program')) {
        const key = JSON.stringify(args);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return { code: 0, stdout: JSON.stringify({ intra_scopes: { Prime: { nodes: { 1: 'montant' }, edges: [] } } }), stderr: '' };
      }
      if (args[0] === 'exceptions') {
        const key = JSON.stringify(args);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return { code: 0, stdout: JSON.stringify({ scope: 'Prime', variable: 'montant', trees: [] }), stderr: '' };
      }
      return runner(command, args, options);
    };
    await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run, python: null, credentials: null } });
    const exceptionCalls = [...counts].filter(([key]) => key.includes('"exceptions"'));
    const dependencyCalls = [...counts].filter(([key]) => key.includes('"dependency-graph"'));
    assert.equal(exceptionCalls.length, 1);
    assert.equal(exceptionCalls[0][1], 1);
    assert.ok(dependencyCalls.every(([, count]) => count <= 2));
    const saved = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'scenarios.json'), 'utf8'));
    assert.equal(saved.scenarios.length, 2);
    for (const scenario of saved.scenarios) {
      assert.equal(scenario.provenance.definitions[0].variable, 'montant');
      assert.equal(scenario.provenance.dependencies[0].intra_scopes.Prime.nodes[1], 'montant');
    }
  } finally { cleanup(); }
});

test('PISTE credentials are mapped to the catleg variables', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-catala-piste-'));
  try {
    assert.equal(pisteCredentials(root), null);
    fs.mkdirSync(path.join(root, '.config', 'mcp-legifrance'), { recursive: true });
    fs.writeFileSync(path.join(root, '.config', 'mcp-legifrance', '.env'), 'LEGIFRANCE_CLIENT_ID="id-fictif"\nLEGIFRANCE_CLIENT_SECRET=secret-fictif\n');
    assert.deepEqual(pisteCredentials(root), { CATLEG_LF_CLIENT_ID: 'id-fictif', CATLEG_LF_CLIENT_SECRET: 'secret-fictif' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('programs live in .piecemaker/catala and a name is required when there are several', () => {
  const { dossier, cleanup } = scratch();
  try {
    assert.equal(listPrograms(dossier).length, 0);
    program(dossier, 'prime-anciennete');
    assert.equal(selectProgram(dossier).name, 'prime-anciennete');
    program(dossier, 'prime-variante');
    assert.deepEqual(listPrograms(dossier), ['prime-anciennete', 'prime-variante']);
    assert.throws(() => selectProgram(dossier), /--programme/);
    assert.throws(() => selectProgram(dossier, 'Prime'), /mal écrit/);
    assert.throws(() => selectProgram(dossier, 'absent'), /introuvable/);
  } finally {
    cleanup();
  }
});

test('verifier runs every check inside the pack environment and writes the results', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime-anciennete');
    const { calls, runner } = fakeRun({ proofOutput: 'This verification condition was generated\nNo errors found during the proof mode run.\n' });
    const text = await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { env: { PIECEMAKER_HOME: home, PATH: '/usr/bin' }, homeDir: home, run: runner, python: '/usr/bin/python3', credentials: { CATLEG_LF_CLIENT_ID: 'id', CATLEG_LF_CLIENT_SECRET: 's' }, citations: async () => ({ passed: true, status: 'passed', results: [] }), now: () => '2026-01-02T00:00:00Z' } });
    assert.match(text, /vérifié/);
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8'));
    assert.equal(report.passed, true);
    assert.match(report.sources_sha256, /^[0-9a-f]{64}$/);
    const explanation = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'explication.json'), 'utf8'));
    assert.equal(explanation.passed, true);
    assert.equal(explanation.sources_sha256, report.sources_sha256);
    assert.equal(explanation.scope, 'JeanDupont');
    assert.deepEqual(report.checks.map((entry) => entry.name), ['documentation', 'typecheck', 'format', 'tests', 'tests-python', 'preuve', 'catleg', 'citations', 'explication']);
    const proof = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'preuve.json')));
    assert.deepEqual(proof.scopes.map((entry) => entry.scope), ['Prime', 'AutrePrime']);
    assert.equal(proof.obligations, 2);
    assert.ok(fs.existsSync(path.join(directory, 'resultats', 'tests.json')));
    const clerkTest = calls.find((call) => call.command === 'clerk' && call.args[0] === 'runtest');
    assert.deepEqual(clerkTest.args, ['runtest', '--whole-program', '-I', '.', '--code-coverage', '--report=resultats/tests-0.report', 'test_prime.catala_fr']);
    assert.equal(clerkTest.cwd, directory);
    assert.equal(clerkTest.env.OPAMSWITCH, 'catala');
    assert.ok(clerkTest.env.PATH.endsWith('/usr/bin'));
  } finally {
    cleanup();
  }
});

test('a failing test fails the verification, verifier rewrites unformatted files and reports a formatter failure', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime-anciennete');
    const { runner } = fakeRun({ testsPass: false });
    const deps = { env: { PIECEMAKER_HOME: home }, homeDir: home, python: null, credentials: null };
    const text = await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { ...deps, run: runner } });
    assert.match(text, /tests : échec/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8')).passed, false);
    const broken = async (command, args, options) => (path.basename(command) === 'catala-format' ? { code: 1, stdout: '', stderr: 'Failed idempotence check' } : runner(command, args, options));
    assert.match(await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { ...deps, run: broken } }), /format : échec \(prime.catala_fr, test_prime.catala_fr\)/);
    assert.equal(fs.readFileSync(path.join(directory, 'prime.catala_fr'), 'utf8'), MODULE);
    const rewriting = async (command, args, options) => {
      if (path.basename(command) !== 'catala-format') return runner(command, args, options);
      assert.equal(args[0], '--in-place');
      fs.writeFileSync(path.join(options.cwd, args.at(-1)), `${fs.readFileSync(path.join(options.cwd, args.at(-1)), 'utf8')}\n`);
      return { code: 0, stdout: '', stderr: '' };
    };
    assert.match(await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { ...deps, run: rewriting } }), /format : ok — reformatés : prime.catala_fr, test_prime.catala_fr/);
    assert.equal(fs.readFileSync(path.join(directory, 'prime.catala_fr'), 'utf8'), `${MODULE}\n`);
    assert.doesNotMatch(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8'), /Code modifié/);
  } finally {
    cleanup();
  }
});

test('a proof with an overlap warning fails and a pack without proof refuses it', async () => {
  const { home, dossier, pack, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime-anciennete');
    const { calls, runner } = fakeRun({ proofOutput: '[WARNING] At least two exceptions overlap for this variable\n' });
    const deps = { env: { PIECEMAKER_HOME: home }, homeDir: home, run: runner, python: null, credentials: null };
    await runCatala({ commande: 'preuve', cwd: dossier, flags: { scope: 'Prime' }, deps });
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'preuve.json'), 'utf8'));
    assert.equal(report.passed, false);
    assert.equal(report.conflits, 1);
    assert.equal(report.fichier, 'prime.catala_fr');
    assert.deepEqual(calls.filter((call) => call.command === 'clerk'), []);
    const emptyProof = fakeRun();
    await runCatala({ commande: 'preuve', cwd: dossier, flags: { scope: 'Prime' }, deps: { ...deps, run: emptyProof.runner } });
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'preuve.json'), 'utf8')).passed, false);
    const checkedProof = fakeRun({ proofOutput: 'This verification condition was generated\nNo errors found during the proof mode run.\n' });
    await runCatala({ commande: 'preuve', cwd: dossier, flags: { scope: 'Prime' }, deps: { ...deps, run: checkedProof.runner } });
    const checked = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'preuve.json'), 'utf8'));
    assert.equal(checked.passed, true);
    assert.equal(checked.obligations, 1);
    const untranslated = fakeRun({ proofOutput: 'This verification condition was generated\n┌─[WARNING]─\n│  [Prime.montant] The translation to Z3 failed:\n│  [Z3 encoding] ErrorOnEmpty unsupported\n└─\n' });
    assert.match(await runCatala({ commande: 'preuve', cwd: dossier, flags: { scope: 'Prime' }, deps: { ...deps, run: untranslated.runner } }), /1 variable\(s\) non couverte\(s\) par Z3 : Prime\.montant \(ErrorOnEmpty unsupported\)\. Les autres obligations sont prouvées\./);
    const uncovered = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'preuve.json'), 'utf8'));
    assert.equal(uncovered.passed, true);
    assert.equal(uncovered.non_couvertes, 1);
    assert.match(await runCatala({ commande: 'verifier', cwd: dossier, flags: {}, deps: { ...deps, run: untranslated.runner } }), /- preuve : ok — 1 variable\(s\) non couverte\(s\) par Z3 : Prime\.montant/);
    const overlap = fakeRun({ proofOutput: 'This verification condition was generated\n┌─[WARNING]─\n│\n│  [Prime.montant] At least two exceptions overlap for this variable:\n─➤ prime.catala_fr:8.12-21:\n  │\n8 │   résultat montant contenu entier\nPrime\nThe solver generated the following counterexample to explain the faulty behavior:\n--> age : 60\n\n│\n└─\n┌─[WARNING]─\n│\n│  [Prime.taux] This variable might return an empty error:\n─➤ prime.catala_fr:7.12-16:\n--> age : 0\n│\n└─\n' });
    assert.match(await runCatala({ commande: 'preuve', cwd: dossier, flags: { scope: 'Prime' }, deps: { ...deps, run: overlap.runner } }), /échec — \[Prime\.montant\] At least two exceptions overlap for this variable \(prime\.catala_fr, ligne 8\) — contre-exemple : age = 60 ; \[Prime\.taux\] This variable might return an empty error \(prime\.catala_fr, ligne 7\) — contre-exemple : age = 0\./);
    const counted = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'preuve.json'), 'utf8'));
    assert.deepEqual([counted.conflits, counted.vides], [1, 1]);
    assert.match(await runCatala({ commande: 'verifier', cwd: dossier, flags: {}, deps: { ...deps, run: overlap.runner } }), /- preuve : échec — prime\.catala_fr › Prime : \[Prime\.montant\] At least two exceptions overlap for this variable \(prime\.catala_fr, ligne 8\) — contre-exemple : age = 60/);
    assert.match(await runCatala({ commande: 'verifier', cwd: dossier, flags: {}, deps: { ...deps, run: emptyProof.runner } }), /- preuve : échec — prime\.catala_fr › Prime : aucune obligation produite/);
    await assert.rejects(() => runCatala({ commande: 'preuve', cwd: dossier, flags: {}, deps }), /--scope/);
    await assert.rejects(() => runCatala({ commande: 'preuve', cwd: dossier, flags: { scope: 'Prime', whole_program: true }, deps }), /masquer des conflits/);
    fs.writeFileSync(path.join(home, 'catala', 'pack.json'), JSON.stringify({ ...pack, proof: false }));
    await assert.rejects(() => runCatala({ commande: 'preuve', cwd: dossier, flags: { scope: 'Prime' }, deps }), /pas disponible/);
  } finally {
    cleanup();
  }
});

function catlegScenario(files, task) {
  const context = scratch();
  const directory = program(context.dossier, 'prime-anciennete', files);
  if (task) fs.writeFileSync(path.join(directory, 'tache.json'), JSON.stringify(task));
  else fs.rmSync(path.join(directory, 'tache.json'));
  const runner = async (command, args) => args.includes('lf')
    ? { code: 0, stdout: JSON.stringify({ article: { id: 'LEGIARTI000000000001', dateDebut: '2020-01-01', dateFin: '2999-01-01' } }), stderr: '' }
    : { code: 0, stdout: 'PIECEMAKER_ARTICLES=[]\n', stderr: '' };
  const deps = { env: { PIECEMAKER_HOME: context.home }, homeDir: context.home, run: runner, python: '/py/python3', credentials: { CATLEG_LF_CLIENT_ID: 'id', CATLEG_LF_CLIENT_SECRET: 's' }, now: () => '2026-03-04T10:00:00Z' };
  const report = () => JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'catleg.json'), 'utf8'));
  return { ...context, directory, deps, report };
}

test('catleg checks only identifiers cited in an article title, not in a doc attribute', async () => {
  const { dossier, deps, report, directory, cleanup } = catlegScenario({ 'prime.catala_fr': '## Article fictif | LEGIARTI000000000001\n' });
  try {
    const text = await runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2026-03-04' }, deps });
    assert.match(text, /1 article\(s\) contrôlé/);
    assert.equal(report().passed, true);
    assert.deepEqual(report().fichiers[0].articles, ['LEGIARTI000000000001']);
    assert.doesNotMatch(JSON.stringify(report()), /non reconnus/);
    await runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2019-12-31' }, deps });
    assert.equal(report().passed, false);
    fs.writeFileSync(path.join(directory, 'prime.catala_fr'), '#[doc.source = "LEGIARTI000000000001"]\n');
    assert.match(await runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2026-03-04' }, deps }), /sans article cité/);
    assert.deepEqual(report().fichiers[0].articles, []);
  } finally { cleanup(); }
});

test('catleg reads a closed article version from the local cache and downloads a missing one once', async () => {
  const { dossier, deps, home, cleanup } = catlegScenario({ 'prime.catala_fr': '## Article fictif | LEGIARTI000000000001\n\n## Article fictif | LEGIARTI000000000002\n' });
  try {
    const reply = (id) => ({ article: { id, num: 'fictif', texte: 'Texte fictif.', dateDebut: Date.UTC(2020, 0, 1), dateFin: Date.UTC(2025, 0, 1) } });
    const articles = path.join(home, 'articles');
    fs.mkdirSync(articles, { recursive: true });
    fs.writeFileSync(path.join(articles, 'LEGIARTI000000000001.json'), JSON.stringify({ at: '2020-01-01', reponse: reply('LEGIARTI000000000001') }));
    const asked = [];
    const run = async (command, args) => {
      if (!args.includes('lf')) return { code: 0, stdout: 'PIECEMAKER_ARTICLES=[]\n', stderr: '' };
      asked.push(args.at(-1));
      return { code: 0, stdout: JSON.stringify(reply(args.at(-1))), stderr: '' };
    };
    await runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2024-06-01' }, deps: { ...deps, run } });
    await runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2024-06-01' }, deps: { ...deps, run } });
    assert.deepEqual(asked, ['LEGIARTI000000000002']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(articles, 'LEGIARTI000000000002.json'), 'utf8')).reponse, reply('LEGIARTI000000000002'));
  } finally { cleanup(); }
});

test('catleg names the missing module when the shared Python lacks catleg', async () => {
  const { dossier, deps, cleanup } = catlegScenario({ 'prime.catala_fr': '## Article fictif | LEGIARTI000000000001\n' });
  try {
    const run = async () => ({ code: 1, stdout: '', stderr: "ModuleNotFoundError: No module named 'catleg'\n" });
    await assert.rejects(() => runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2026-03-04' }, deps: { ...deps, run } }), /catleg absent du Python partagé/);
  } finally { cleanup(); }
});

test('catleg takes the reference date from --au, then tache.json, and accepts today', async () => {
  const task = { tache: 'Acte', type: 'litigation', raisonnements: [], date_vigueur: '2024-01-15' };
  const files = { 'prime.catala_fr': '## Article fictif | LEGIARTI000000000001\n' };
  const withTask = catlegScenario(files, task);
  const today = catlegScenario(files, { ...task, date_vigueur: 'today' });
  try {
    assert.match(await runCatala({ commande: 'catleg', cwd: withTask.dossier, flags: { au: '2023-05-06' }, deps: withTask.deps }), /date donnée par --au/);
    assert.deepEqual([withTask.report().dates_reference, withTask.report().origine_date], [['2023-05-06'], '--au']);
    assert.match(await runCatala({ commande: 'catleg', cwd: withTask.dossier, deps: withTask.deps }), /date de tache\.json/);
    assert.deepEqual([withTask.report().dates_reference, withTask.report().origine_date], [['2024-01-15'], 'tache.json']);
    assert.match(await runCatala({ commande: 'catleg', cwd: withTask.dossier, flags: { au: 'today' }, deps: withTask.deps }), /date donnée par --au \(today\)/);
    assert.deepEqual([withTask.report().dates_reference, withTask.report().origine_date], [['2026-03-04'], '--au']);
    assert.match(await runCatala({ commande: 'catleg', cwd: today.dossier, deps: today.deps }), /date de tache\.json \(today\)/);
    assert.deepEqual([today.report().dates_reference, today.report().origine_date], [['2026-03-04'], 'tache.json']);
  } finally { withTask.cleanup(); today.cleanup(); }
});

test('a missing reference date stops catleg and verifier before any check', async () => {
  const { dossier, deps, directory, cleanup } = catlegScenario({ 'prime.catala_fr': MODULE });
  const calls = [];
  const counted = { ...deps, run: async (...input) => { calls.push(input); return deps.run(...input); } };
  try {
    await assert.rejects(() => runCatala({ commande: 'catleg', cwd: dossier, deps: counted }), /Date de vigueur absente/);
    await assert.rejects(() => runCatala({ commande: 'verifier', cwd: dossier, deps: counted }), /Date de vigueur absente/);
    await assert.rejects(() => runCatala({ commande: 'verifier', cwd: dossier, flags: { au: true }, deps: counted }), /Date de vigueur absente/);
    assert.equal(calls.length, 0);
    assert.equal(fs.existsSync(path.join(directory, 'resultats', 'verification.json')), false);
  } finally { cleanup(); }
});

test('an invalid date_vigueur in tache.json is reported', async () => {
  const { dossier, deps, cleanup } = catlegScenario({ 'prime.catala_fr': MODULE }, { tache: 'Acte', type: 'litigation', raisonnements: [{ champ: 'Prime', objectif: 'Calculer' }], date_vigueur: '2024-02-30' });
  try {
    await assert.rejects(() => runCatala({ commande: 'catleg', cwd: dossier, deps }), /date_vigueur attend today ou une date valide/);
    await assert.rejects(() => runCatala({ commande: 'verifier', cwd: dossier, deps }), /date_vigueur attend today ou une date valide/);
  } finally { cleanup(); }
});

test('verifier and catleg give the same catleg verdict', async () => {
  const { dossier, deps, report, directory, cleanup } = catlegScenario({ 'prime.catala_fr': '## Article fictif | LEGIARTI000000000001\n' }, { tache: 'Acte', type: 'autre', raisonnements: [], date_vigueur: '2019-12-31' });
  try {
    await runCatala({ commande: 'catleg', cwd: dossier, deps });
    const alone = report();
    await runCatala({ commande: 'verifier', cwd: dossier, deps });
    const inside = report();
    const entry = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8')).checks.find((check) => check.name === 'catleg');
    assert.deepEqual([inside.passed, inside.dates_reference, inside.origine_date, inside.fichiers], [alone.passed, alone.dates_reference, alone.origine_date, alone.fichiers]);
    assert.equal(entry.passed, alone.passed);
    assert.equal(alone.passed, false);
  } finally { cleanup(); }
});

test('catleg counts native parser results, rejects empty checks and uses the user PISTE credentials', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime-anciennete', { 'prime.catala_fr': '## Article fictif | LEGIARTI000000000001\n' });
    const calls = [];
    let stdout = 'PIECEMAKER_ARTICLES=[{"id":"LEGIARTI000000000001","archive":false}]\n';
    const runner = async (command, args, options) => {
      calls.push({ command, args, env: options.env });
      if (args.includes('lf')) return { code: 0, stdout: JSON.stringify({ article: { id: 'LEGIARTI000000000001', dateDebut: '2020-01-01', dateFin: '2999-01-01' } }), stderr: '' };
      return { code: 0, stdout, stderr: '' };
    };
    const deps = { env: { PIECEMAKER_HOME: home }, homeDir: home, run: runner, python: '/py/python3', credentials: { CATLEG_LF_CLIENT_ID: 'id', CATLEG_LF_CLIENT_SECRET: 's' }, now: () => '2026-03-04T10:00:00Z' };
    const report = () => JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'catleg.json'), 'utf8'));
    assert.match(await runCatala({ commande: 'catleg', cwd: dossier, flags: { fichier: 'prime.catala_fr', au: '2026-03-04' }, deps }), /1 article\(s\) contrôlé/);
    assert.equal(calls[0].command, '/py/python3');
    assert.deepEqual(calls[0].args.slice(-2), ['check-expiry', 'prime.catala_fr']);
    assert.equal(calls[0].env.CATLEG_LF_CLIENT_ID, 'id');
    assert.equal(process.env.CATLEG_LF_CLIENT_ID, undefined);
    assert.equal(report().passed, true);
    await runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2019-12-31' }, deps });
    assert.equal(report().passed, false);
    assert.equal(report().fichiers[0].versions[0].valide, false);
    await runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2020-01-01' }, deps });
    assert.equal(report().fichiers[0].versions[0].valide, true);
    assert.match(await runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2021-06-01' }, deps }), /donnée par --au/);
    assert.deepEqual(report().dates_reference, ['2021-06-01']);
    stdout = 'PIECEMAKER_ARTICLES=[{"id":"LEGIARTI000000000001","archive":true}]\n';
    await runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2021-06-01' }, deps: { ...deps, run: async (command, args, options) => args.includes('lf') ? runner(command, args, options) : args.includes('diff') ? { code: 0, stdout: '', stderr: '' } : { code: 1, stdout, stderr: 'expired' } } });
    assert.equal(report().passed, true);
    assert.deepEqual(report().fichiers[0].articles, ['LEGIARTI000000000001']);
    fs.writeFileSync(path.join(directory, 'prime.catala_fr'), '## Article fictif\n');
    for (const output of ['', 'PIECEMAKER_ARTICLES=[]\n']) {
      stdout = output;
      await runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2026-03-04' }, deps });
      assert.equal(report().passed, false);
    }
    await assert.rejects(() => runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2026-02-30' }, deps }), /date valide/);
    await assert.rejects(() => runCatala({ commande: 'catleg', cwd: dossier, flags: { fichier: '../secret', au: '2026-03-04' }, deps }), /absent du programme/);
    await assert.rejects(() => runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2026-03-04' }, deps: { ...deps, credentials: null } }), /PISTE/);
  } finally { cleanup(); }
});

test('Windows tools run through cmd and a missing pack reports the install status', async () => {
  const pack = { bin: { clerk: 'C:\\Catala\\bin\\clerk.cmd' } };
  assert.deepEqual(toolCommand(pack, 'clerk', ['test'], 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }), { command: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/s', '/c', 'C:\\Catala\\bin\\clerk.cmd', 'test'] });
  assert.deepEqual(toolCommand({ bin: { catala: 'C:\\Catala & outils\\catala.exe' } }, 'catala', ['explain', 'Jean & Dupont.catala_fr'], 'win32'), { command: 'C:\\Catala & outils\\catala.exe', args: ['explain', 'Jean & Dupont.catala_fr'] });
  await assert.rejects(() => runCatala({ commande: 'exec', args: ['catala', '--help'], cwd: os.tmpdir(), deps: { findPack: () => ({ pack: null, status: { state: 'installation', step: 'switch' } }) } }), /étape switch/);
});

test('pm catala routes to the Catala wrapper and rejects unknown commands', async () => {
  const seen = [];
  const notifications = [];
  const deps = { catalaFn: async (input) => { seen.push(input); return 'ok'; }, catalaUpdated: async (input) => { notifications.push(input); } };
  assert.equal(await run(['catala', 'verifier', '--programme', 'prime', '--dossier', '/tmp/dossier'], { deps }), 'ok');
  assert.equal(seen[0].programme, 'prime');
  assert.equal(seen[0].cwd, path.resolve('/tmp/dossier'));
  assert.deepEqual(notifications, [{ cwd: path.resolve('/tmp/dossier') }]);
  await run(['catala', 'exec', 'clerk', '--', '--help'], { deps, cwd: '/tmp' });
  assert.deepEqual(seen[1].args, ['clerk', '--help']);
  assert.equal(notifications.length, 1);
  await assert.rejects(() => run(['catala', 'expliquer'], { cwd: '/tmp', deps: { ...deps, catalaFn: async () => { throw new Error('Explication échouée'); } } }), /Explication échouée/);
  assert.equal(notifications.length, 2);
  await assert.rejects(() => run(['catala', 'compiler'], { deps }), (error) => error.exitCode === 2);
  const failing = { catalaFn: async () => { throw new TypeError('Plusieurs programmes'); } };
  await assert.rejects(() => run(['catala', 'verifier'], { deps: failing }), (error) => error.exitCode === 2 && /Plusieurs/.test(error.message));
});

test('expliquer saves the graph and rejects an execution failure without retaining an old graph', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime-anciennete');
    let fail = false;
    const run = async (_command, args) => args[0] === 'explain' ? { code: fail ? 123 : 0, stdout: fail ? '' : 'digraph G { x001 -> x002; }\n', stderr: fail ? 'Invalid input' : '' } : { code: 0, stdout: '', stderr: '' };
    const input = { commande: 'expliquer', cwd: dossier, programme: 'prime-anciennete', flags: { fichier: 'test_prime.catala_fr', scope: 'JeanDupont' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run, python: null, credentials: null } };
    assert.match(await runCatala(input), /graphe des formules/);
    assert.match(fs.readFileSync(path.join(directory, 'resultats', 'explication.dot'), 'utf8'), /digraph/);
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'explication.json'), 'utf8'));
    assert.equal(report.scope, 'JeanDupont');
    assert.equal(report.passed, true);
    fail = true;
    await assert.rejects(() => runCatala(input), /Invalid input/);
    assert.equal(fs.readFileSync(path.join(directory, 'resultats', 'explication.dot'), 'utf8'), '');
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'explication.json'), 'utf8')).passed, false);
    await assert.rejects(() => runCatala({ ...input, flags: { ...input.flags, scope: undefined } }), /--scope/);
    await assert.rejects(() => runCatala({ ...input, flags: { ...input.flags, fichier: '../autre.catala_fr' } }), /--fichier/);
  } finally {
    cleanup();
  }
});

test('expliquer refuses to label an old execution as current when sources change during execution', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime-anciennete');
    const run = async () => {
      fs.appendFileSync(path.join(directory, 'test_prime.catala_fr'), '\nTexte fictif ajouté.\n');
      return { code: 0, stdout: 'digraph G { x001 [label=<Prime>] }', stderr: '' };
    };
    await assert.rejects(() => runCatala({ commande: 'expliquer', cwd: dossier, flags: { fichier: 'test_prime.catala_fr', scope: 'JeanDupont' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run, python: null, credentials: null } }), /Explication échouée/);
    assert.equal(fs.readFileSync(path.join(directory, 'resultats', 'explication.dot'), 'utf8'), '');
  } finally { cleanup(); }
});

test('independent checks finish despite compilation failure and stale reports are removed', { timeout: 5000 }, async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime');
    fs.mkdirSync(path.join(directory, 'resultats'));
    for (const file of ['preuve.json', 'tests.json', 'explication.json']) fs.writeFileSync(path.join(directory, 'resultats', file), '{"passed":true}');
    let release;
    const networkStarted = new Promise((resolve) => { release = resolve; });
    const { runner, calls } = fakeRun();
    const run = async (command, args, options) => {
      if (args[0] === 'typecheck') { await networkStarted; return { code: 1, stdout: '', stderr: 'Erreur de type' }; }
      return runner(command, args, options);
    };
    await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run, python: null, credentials: null, citations: async () => { release(); return { passed: false, status: 'failed', message: 'Citation introuvable', results: [] }; } } });
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json')));
    assert.deepEqual(report.checks.map((entry) => [entry.name, entry.status]), [['documentation', 'passed'], ['typecheck', 'failed'], ['format', 'blocked'], ['tests', 'blocked'], ['tests-python', 'blocked'], ['preuve', 'blocked'], ['catleg', 'missing'], ['citations', 'failed'], ['explication', 'blocked']]);
    assert.equal(report.passed, false);
    assert.ok(!calls.some((call) => ['proof', 'explain', 'runtest'].includes(call.args[0])));
    for (const file of ['preuve.json', 'tests.json', 'explication.json']) assert.equal(fs.existsSync(path.join(directory, 'resultats', file)), false);
    const unavailable = await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { findPack: () => ({ pack: null }), python: null, credentials: null, citations: async () => ({ passed: true, status: 'passed', results: [] }) } });
    assert.match(unavailable, /typecheck : non effectué/);
    assert.match(unavailable, /citations : ok/);
  } finally { cleanup(); }
});

test('a failed Python scenario does not prevent the remaining scenarios from running', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime', { 'prime.catala_fr': MODULE, 'test_prime.catala_fr': TESTS, 'test_variante.catala_fr': TESTS });
    const executed = [];
    const { runner } = fakeRun();
    const run = async (command, args, options) => {
      if (args.at(-1) === '--test') { executed.push(args[2]); return { code: executed.length === 1 ? 1 : 0, stdout: '', stderr: '' }; }
      return runner(command, args, options);
    };
    await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run, python: '/python', credentials: null } });
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json')));
    assert.equal(executed.length, 2);
    assert.equal(report.checks.find((entry) => entry.name === 'tests-python').status, 'failed');
    assert.match(fs.readFileSync(path.join(directory, 'resultats', 'tests-python.log'), 'utf8'), /test_variante.catala_fr: code 0/);
  } finally { cleanup(); }
});

test('compilation errors are shown once per line, numbering removed, and capped', () => {
  const output = 'x.catala_fr:3.5-3.8: [ERROR] 1/2: Syntax error\nx.catala_fr:3.5-3.8: [ERROR] 1/2: Syntax error\nnoise\nx.catala_fr:9.1-9.2: [WARNING] Unused\n';
  assert.deepEqual(compilerErrors(output), ['x.catala_fr:3.5-3.8: [ERROR] Syntax error', 'x.catala_fr:9.1-9.2: [WARNING] Unused']);
  assert.deepEqual(compilerErrors(output, 1), ['x.catala_fr:3.5-3.8: [ERROR] Syntax error', '… 1 autre(s) ligne(s) dans le journal.']);
});

test('verifier prints the compiler error lines under the failed typecheck', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    program(dossier, 'prime');
    const { runner, calls } = fakeRun();
    const run = async (command, args, options) => (args[0] === 'typecheck' ? { code: 1, stdout: 'prime.catala_fr:4.3-4.6: [ERROR] Syntax error\nMaybe you wanted to write: "égal à"?\n', stderr: '' } : runner(command, args, options));
    const text = await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run, python: null, credentials: null, citations: async () => ({ passed: true, status: 'passed', results: [] }) } });
    assert.match(text, /typecheck : échec[^\n]*\n  prime\.catala_fr:4\.3-4\.6: \[ERROR\] Syntax error/);
    assert.match(text, /format : bloqué/);
  } finally { cleanup(); }
});

test('exceptions, executer and squelette call Catala with the expected arguments', async () => {
  const { home, dossier, pack, root, cleanup } = scratch();
  try {
    const stdlib = path.join(root, 'stdlib');
    fs.mkdirSync(stdlib);
    fs.writeFileSync(path.join(stdlib, 'Date_fr.catala_fr'), '');
    pack.env.CATALA_STDLIB = stdlib;
    fs.writeFileSync(path.join(home, 'catala', 'pack.json'), JSON.stringify(pack));
    const directory = program(dossier, 'prime');
    const calls = [];
    const run = async (command, args, options) => {
      calls.push({ args, cwd: options.cwd, input: options.input, libcatala: fs.existsSync(path.join(options.cwd, '_build', 'libcatala', 'Date_fr.catala_fr')), tests: fs.existsSync(path.join(options.cwd, 'test_prime.catala_fr')) });
      if (args[1] === 'write') return { code: 0, stdout: '#[testcase.test_code]\n> éditeur de tests métier\n\n```catala\nchamp d\'application Essai:  \n```\n', stderr: '' };
      return { code: 0, stdout: args[0] === 'testcase' ? '{"tests":[]}' : 'montant = 10 €', stderr: '' };
    };
    const deps = { env: { PIECEMAKER_HOME: home }, homeDir: home, run };
    await assert.rejects(() => runCatala({ commande: 'exceptions', cwd: dossier, flags: { scope: 'Prime' }, deps }), /--variable/);
    await assert.rejects(() => runCatala({ commande: 'executer', cwd: dossier, flags: {}, deps }), /--scope/);
    await assert.rejects(() => runCatala({ commande: 'executer', cwd: dossier, flags: { scope: 'JeanDupont', fichier: 'absent.catala_fr' }, deps }), /--fichier parmi/);
    assert.match(await runCatala({ commande: 'exceptions', cwd: dossier, flags: { scope: 'Prime', variable: 'montant' }, deps }), /Prime\.montant/);
    assert.deepEqual(calls.at(-1).args, ['exceptions', '--color=never', '-I', '.', 'prime.catala_fr', '-s', 'Prime', '-v', 'montant']);
    assert.match(await runCatala({ commande: 'executer', cwd: dossier, flags: { scope: 'JeanDupont', fichier: 'test_prime.catala_fr' }, deps }), /montant = 10 €/);
    assert.deepEqual(calls.at(-1).args, ['interpret', '--color=never', '--message-format=gnu', `--stdlib=${stdlib}`, '--whole-program', '--trace', '-I', '.', 'test_prime.catala_fr', '-s', 'JeanDupont']);
    assert.ok(fs.existsSync(path.join(directory, 'resultats', 'execution.log')));
    const skeleton = await runCatala({ commande: 'squelette', cwd: dossier, flags: { scope: 'Prime' }, deps });
    const [generate, write] = calls.slice(-2);
    assert.equal(generate.args.slice(0, 2).join(' '), 'testcase generate');
    assert.ok(generate.libcatala && !generate.tests);
    assert.equal(write.input, '{"tests":[]}');
    assert.doesNotMatch(skeleton, /testcase\.|éditeur/);
    assert.match(skeleton, /champ d'application Essai:\n```/);
    assert.equal(fs.existsSync(generate.cwd), false);
  } finally { cleanup(); }
});

const FACTS = [
  '> Module Prime',
  '',
  '```catala-metadata',
  "déclaration champ d'application Prime:",
  '  ## Montant demandé',
  '  entrée demande contenu argent',
  '  résultat montant contenu argent',
  '```',
  '',
  '## Article 1 | LEGIARTI000000000001',
  '',
  '« Passage exact. »',
  '',
  '```catala',
  "champ d'application Prime:",
  '  définition montant égal à demande',
  '```',
  '',
].join('\n');
const FACT_TESTS = "> Usage de Prime\n\n```catala\n#[test]\ndéclaration champ d'application JeanDupont:\n  résultat calcul champ d'application Prime.Prime\n\nchamp d'application JeanDupont:\n  ## okf:/_premises/demande.md\n  définition calcul.demande égal à 0 €\n  assertion calcul.montant = 0 €\n```\n";

test('verifier requires a title, a legal anchor and a complete task', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime', { 'test_prime.catala_fr': FACT_TESTS });
    const { runner } = fakeRun();
    const documentation = async () => {
      const output = await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run: runner, python: null, credentials: null } });
      return { output, errors: JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8')).checks.find((entry) => entry.name === 'documentation').errors };
    };
    const cases = [
      [FACTS, null],
      [FACTS.replace('  ## Montant demandé\n', ''), 'prime.catala_fr:5: titre manquant pour cette entrée. Écrivez ## texte court au-dessus.'],
      [FACTS.replace('## Montant demandé', '## Montant ?'), 'prime.catala_fr:5: titre « Montant ? » : écrivez 2 à 7 mots, sans identifiant de variable ni « ? ».'],
      [FACTS.replace('## Montant demandé', '## montant_demande de Jean'), 'prime.catala_fr:5: titre « montant_demande de Jean » : écrivez 2 à 7 mots, sans identifiant de variable ni « ? ».'],
      [FACTS.replace('  ## Montant demandé\n', '  ## Montant demandé\n  #[doc="source: okf:/_premises/montant-demande.md"]\n'), 'prime.catala_fr:6: #[doc] contient « source: » : le titre va dans ## texte court, la source juridique dans le titre de section.'],
      [FACTS.replace('## Article 1 | LEGIARTI000000000001', '## Article 1'), "prime.catala_fr:16: règle sans source juridique : placez-la sous un titre ## Article N | LEGIARTI… (JORFARTI) ou ## Décision | JURITEXT… (CETATEXT, CONSTEXT), suivi de l'extrait exact entre « »."],
      [FACTS.replace('« Passage exact. »\n\n', ''), ["prime.catala_fr:10: LEGIARTI000000000001 cité sans section propre : écrivez ## Article N | LEGIARTI000000000001 suivi de l'extrait entre « ».", "prime.catala_fr:14: règle sans source juridique : placez-la sous un titre ## Article N | LEGIARTI… (JORFARTI) ou ## Décision | JURITEXT… (CETATEXT, CONSTEXT), suivi de l'extrait exact entre « »."]],
      [FACTS.replace('## Article 1 | LEGIARTI000000000001', '## Décision fictive | JURITEXT000000000001'), null],
      [FACTS.replace('## Article 1 | LEGIARTI000000000001', '## Article 1 | LEGIARTI000000000001\n\n« Passage exact. »\n\n### Montant'), "prime.catala_fr:20: règle sans source juridique : placez-la sous un titre ## Article N | LEGIARTI… (JORFARTI) ou ## Décision | JURITEXT… (CETATEXT, CONSTEXT), suivi de l'extrait exact entre « »."],
    ];
    for (const [content, message] of cases) {
      fs.writeFileSync(path.join(directory, 'prime.catala_fr'), content);
      const { output, errors } = await documentation();
      const expected = message ? [message].flat() : [];
      assert.deepEqual(errors, expected);
      for (const item of expected) assert.ok(output.includes(item));
    }
    fs.writeFileSync(path.join(directory, 'prime.catala_fr'), FACTS);
    const verify = async (task) => {
      if (task) fs.writeFileSync(path.join(directory, 'tache.json'), JSON.stringify(task));
      else fs.rmSync(path.join(directory, 'tache.json'));
      return (await documentation()).errors.filter((error) => error.startsWith('tache.json:1: '));
    };
    assert.deepEqual(await verify({ tache: 'Conclusions en défense Dupont / Société Exemple', type: 'litigation', date_vigueur: 'today', raisonnements: [{ champ: 'Prime', objectif: 'Obtenir la prime', rang: 'principal' }] }), []);
    assert.deepEqual(await verify({ tache: 'Contrat de Société Exemple SAS', type: 'transactional', date_vigueur: '2024-01-15', raisonnements: [{ champ: 'Prime', objectif: 'Fixer la prime' }] }), []);
    const faults = await verify({ type: 'contentieux', raisonnements: [{ champ: 'Absent' }] });
    assert.equal(faults.length, 5);
    assert.match(faults.join('\n'), /sans nom[\s\S]*type de tâche inconnu : écrivez litigation, transactional\.[\s\S]*date_vigueur absente : écrivez today ou AAAA-MM-JJ\.[\s\S]*« Absent » : aucun champ[\s\S]*sans objectif/);
    assert.deepEqual(await verify(null), ['tache.json:1: tâche absente : créez tache.json avec tache, type, date_vigueur et raisonnements.']);
  } finally { cleanup(); }
});

test('verifier fails a test without assertion, a typecheck warning, and a misspelled block', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const module = MODULE + '\n## Article 1 | LEGIARTI000000000001\n\n« Passage exact. »\n\n```catala\nchamp d\'application Prime:\n  #[doc="Fixe le montant."]\n  définition montant égal à 10 €\n```\n';
    const directory = program(dossier, 'prime', { 'prime.catala_fr': module, 'test_prime.catala_fr': TESTS + '\n```catala\n#[test]\ndéclaration champ d\'application SansAssertion:\n  résultat calcul champ d\'application Prime.Prime\n```\n' });
    const { runner } = fakeRun();
    const run = async (command, args, options) => {
      if (args[0] === 'typecheck') return { code: 0, stdout: 'prime.catala_fr:4.10-16: [WARNING] Unused variable: statut does not contribute to computing any of scope Prime outputs.\n', stderr: '' };
      return runner(command, args, options);
    };
    const deps = { env: { PIECEMAKER_HOME: home }, homeDir: home, run, python: null, credentials: null };
    const text = await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps });
    assert.match(text, /typecheck : échec\n  prime.catala_fr:4.10-16: \[WARNING\] Unused variable: statut/);
    const checks = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8')).checks;
    const by = (name) => checks.find((entry) => entry.name === name);
    assert.equal(by('typecheck').passed, false);
    const passing = async (command, args, options) => args[0] === 'typecheck' ? { code: 0, stdout: '', stderr: '' } : run(command, args, options);
    await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { ...deps, run: passing } });
    const after = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8')).checks;
    const tests = after.find((entry) => entry.name === 'tests');
    assert.equal(tests.passed, false);
    assert.deepEqual(tests.errors, ['test_prime.catala_fr:13 › SansAssertion : test sans assertion, il réussit toujours. Ajoutez une assertion sur le résultat attendu.']);
    for (const opening of ['``` catala', '```Catala', '```catala-fr']) {
      fs.writeFileSync(path.join(directory, 'prime.catala_fr'), module.replace('\n```catala\n', `\n${opening}\n`));
      await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { ...deps, run: passing } });
      const documentation = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8')).checks.find((entry) => entry.name === 'documentation');
      assert.deepEqual(documentation.errors, ['prime.catala_fr:12: bloc ignoré par Catala : ouvrez-le exactement par ```catala ou ```catala-metadata, sans espace ni majuscule.'], opening);
    }
  } finally { cleanup(); }
});

test('the indemnity fixture passes documentation and each rule rejects its fault', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const fixture = path.join(import.meta.dirname, '../../../../../../docs/tests/raisonnement-indemnite-instruction-maj/.piecemaker/catala/indemnite-depart');
    const source = fs.readFileSync(path.join(fixture, 'indemnite.catala_fr'), 'utf8');
    const task = JSON.parse(fs.readFileSync(path.join(fixture, 'tache.json'), 'utf8'));
    const directory = program(dossier, 'indemnite-depart', { 'indemnite.catala_fr': source });
    const { runner } = fakeRun();
    const errors = async (content, tache = task) => {
      fs.writeFileSync(path.join(directory, 'indemnite.catala_fr'), content);
      fs.writeFileSync(path.join(directory, 'tache.json'), JSON.stringify(tache));
      await runCatala({ commande: 'verifier', cwd: dossier, flags: {}, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run: runner, python: null, credentials: null } });
      return JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8')).checks.find((entry) => entry.name === 'documentation').errors.join('\n');
    };
    assert.equal(await errors(source), '');
    assert.match(await errors(source.replace('## Article 2224 | LEGIARTI000019017112', '## Article 2224')), /règle sans source juridique/);
    assert.match(await errors(source.replace('## Société cotée', '## société_cotée')), /titre « société_cotée » : écrivez 2 à 7 mots/);
    assert.match(await errors(source.replace('  ## okf:/_premises/societe-cotee.md\n', '')), /fait du scénario sans justification : écrivez ## okf:\/_premises\/<fiche>\.md juste au-dessus de cas\.société_cotée\./);
    assert.match(await errors(source, { ...task, type: 'contentieux' }), /type de tâche inconnu : écrivez litigation, transactional\./);
  } finally { cleanup(); }
});

const RULE = "```catala\nchamp d'application Prime:\n  définition montant égal à 1 €\n```\n";
const ANCHORED = (id = 'LEGIARTI000000000001') => `## Article 1 | ${id}\n\n« Passage exact. »\n\n`;
const documentationErrors = (content) => catalaDocumentation(content).errors.map((error) => error.message);

test('documentation rejects a rule under an unanchored subtitle of an anchored parent', () => {
  assert.deepEqual(documentationErrors(`${ANCHORED()}${RULE}`), []);
  assert.match(documentationErrors(`${ANCHORED()}### Détail\n\n${RULE}`).join('\n'), /règle sans source juridique/);
  assert.deepEqual(documentationErrors(`${ANCHORED()}### Détail | LEGIARTI000000000002\n\n« Autre passage. »\n\n${RULE}`), []);
});

test('documentation rejects a rule in a catala-metadata block without anchor', () => {
  const metadata = "```catala-metadata\ndéclaration champ d'application Prime:\n  définition montant égal à 1 €\n```\n";
  assert.match(documentationErrors(`## Définitions\n\n${metadata}`).join('\n'), /règle sans source juridique/);
  assert.deepEqual(documentationErrors(`${ANCHORED()}${metadata}`), []);
});

test('documentation rejects a whole-text identifier in a title', () => {
  for (const id of ['LEGITEXT000000000001', 'JORFTEXT000000000001']) {
    assert.match(documentationErrors(`## Code fictif | ${id}\n\n« Passage exact. »\n`).join('\n'), /pas le texte entier/);
  }
});

test('documentation rejects a malformed identifier', () => {
  assert.deepEqual(documentationErrors(ANCHORED()), []);
  for (const id of ['LEGIARTI 000000000001', 'LEGIARTI00000000001', 'LEGIARTI']) {
    assert.match(documentationErrors(`## Article 1 | ${id}\n\n« Passage exact. »\n`).join('\n'), /mal formé/);
  }
});

test('documentation rejects an inclusion outside the program and keeps a local one', () => {
  assert.match(documentationErrors('> Inclusion: ../x.catala_fr\n').join('\n'), /hors du dossier du programme/);
  assert.match(documentationErrors('> Inclusion: /etc/x.catala_fr\n').join('\n'), /hors du dossier du programme/);
  assert.match(documentationErrors('> Inclusion: ../../x.catala_fr\n').join('\n'), /hors du dossier du programme/);
  assert.deepEqual(documentationErrors('> Inclusion: x.catala_fr\n'), []);
  assert.deepEqual(documentationErrors('> Inclusion: sous/x.catala_fr\n'), []);
});

test('documentation requires the article number and text in a label', () => {
  const labelled = (label) => `${ANCHORED()}\`\`\`catala\nchamp d'application Prime:\n  étiquette ${label}\n  définition montant égal à 1 €\n\`\`\`\n`;
  assert.match(documentationErrors(labelled('article_2')).join('\n'), /étiquette « article_2 »/);
  assert.deepEqual(documentationErrors(labelled('article_2_code_civil')), []);
  assert.deepEqual(documentationErrors(labelled('conditions_principales')), []);
});

test('documentation rejects an identifier cited without its own anchored title', () => {
  assert.match(documentationErrors(`${ANCHORED()}Voir aussi LEGIARTI000000000002.\n`).join('\n'), /LEGIARTI000000000002 cité sans section propre/);
  assert.deepEqual(documentationErrors(`${ANCHORED()}Voir aussi LEGIARTI000000000001.\n`), []);
  assert.deepEqual(documentationErrors(`${ANCHORED()}## Article 2 | LEGIARTI000000000002\n\n« Autre passage. »\n\nVoir LEGIARTI000000000002.\n`), []);
});

test('documentation accepts JORFARTI as an anchor', () => {
  assert.deepEqual(documentationErrors(`${ANCHORED('JORFARTI000000000001')}${RULE}`), []);
});

function catlegWith({ file, article, diff }) {
  const scenario = catlegScenario({ 'prime.catala_fr': file }, { tache: 'Acte', type: 'autre', raisonnements: [], date_vigueur: '2026-03-04' });
  scenario.deps.run = async (command, args) => {
    if (args.includes('lf')) return { code: 0, stdout: JSON.stringify({ article: { id: 'LEGIARTI000000000001', dateDebut: '2020-01-01', dateFin: '2999-01-01', ...article } }), stderr: '' };
    if (args.includes('diff')) return { code: 0, stdout: diff ?? 'Found 0 articles\n', stderr: '' };
    return { code: 0, stdout: 'PIECEMAKER_ARTICLES=[{"id":"LEGIARTI000000000001","archive":false}]\n', stderr: '' };
  };
  return scenario;
}

test('catleg fails when the title number differs from the official number', async () => {
  const wrong = catlegWith({ file: '## Article 2 | LEGIARTI000000000001\n', article: { num: '1' } });
  const right = catlegWith({ file: '## Article 1 | LEGIARTI000000000001\n', article: { num: '1' } });
  try {
    await runCatala({ commande: 'catleg', cwd: wrong.dossier, flags: { au: '2026-03-04' }, deps: wrong.deps });
    assert.equal(wrong.report().passed, false);
    assert.match(wrong.report().fichiers[0].messages.join('\n'), /titre « Article 2 » ne correspond pas à l'article 1/);
    await runCatala({ commande: 'catleg', cwd: right.dossier, flags: { au: '2026-03-04' }, deps: right.deps });
    assert.equal(right.report().passed, true);
  } finally { wrong.cleanup(); right.cleanup(); }
});

test('catleg accepts an archived section whose bounds equal the official period', async () => {
  const article = { num: '1', dateDebut: '2020-01-01', dateFin: '2021-01-01' };
  const bounded = catlegWith({ file: '## Article 1 [archive] | LEGIARTI000000000001\n\n« Version |2020-01-01| à |2021-01-01| du texte. »\n', article });
  const unbounded = catlegWith({ file: '## Article 1 [archive] | LEGIARTI000000000001\n\n« Version sans bornes. »\n', article });
  const different = catlegWith({ file: '## Article 1 [archive] | LEGIARTI000000000001\n\n« Version |2020-01-01| à |2020-06-01| du texte. »\n', article });
  try {
    for (const scenario of [bounded, unbounded, different]) await runCatala({ commande: 'catleg', cwd: scenario.dossier, flags: { au: '2022-01-01' }, deps: scenario.deps });
    assert.equal(bounded.report().passed, true);
    assert.equal(bounded.report().fichiers[0].versions[0].valide, true);
    assert.equal(unbounded.report().passed, false);
    assert.equal(different.report().passed, false);
  } finally { bounded.cleanup(); unbounded.cleanup(); different.cleanup(); }
});

test('catleg fails on a whole-text difference even when diff exits with code 0', async () => {
  const diff = 'LEGIARTI000000000001\nprime.catala_fr:2\n- texte officiel\n+ texte recopié\nFound 1 articles\n';
  const different = catlegWith({ file: '## Article 1 | LEGIARTI000000000001\n\n« Texte recopié. »\n', article: { num: '1' }, diff });
  try {
    await runCatala({ commande: 'catleg', cwd: different.dossier, flags: { au: '2026-03-04' }, deps: different.deps });
    assert.equal(different.report().passed, false);
    assert.match(different.report().fichiers[0].messages.join('\n'), /prime\.catala_fr:3: LEGIARTI000000000001 : le texte recopié diffère du texte officiel/);
    assert.equal(different.report().fichiers[0].versions[0].valide, true);
  } finally { different.cleanup(); }
});

test('catleg ignores a whole-text difference limited to spaces and reports a word difference plainly', async () => {
  const colored = (written, official) => `LEGIARTI000000000001\nprime.catala_fr:2\n\u001b[36m@@ -1 +1 @@\u001b[m\nVoir l'article \u001b[31m${written}\u001b[m\u001b[32m${official}\u001b[m\nFound 1 articles\n`;
  const spaces = catlegWith({ file: '## Article 1 | LEGIARTI000000000001\n\n« Texte. »\n', article: { num: '1' }, diff: colored('L. 22-10-9.', 'L. 22-10-9 .') });
  const words = catlegWith({ file: '## Article 1 | LEGIARTI000000000001\n\n« Texte. »\n', article: { num: '1' }, diff: colored('payé', 'versé') });
  try {
    for (const scenario of [spaces, words]) await runCatala({ commande: 'catleg', cwd: scenario.dossier, flags: { au: '2026-03-04' }, deps: scenario.deps });
    assert.equal(spaces.report().passed, true);
    assert.equal(words.report().passed, false);
    assert.match(words.report().fichiers[0].messages.join('\n'), /écrit « payé », officiel « versé »/);
  } finally { spaces.cleanup(); words.cleanup(); }
});

test('verifier rewrites a corrected citation once in the program file', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime');
    const file = path.join(directory, 'prime.catala_fr');
    fs.writeFileSync(file, FACTS.replace('« Passage exact. »', '« Passage exact. » puis « Passage exact. »'));
    const { runner } = fakeRun();
    const outside = path.join(dossier, 'autre.catala_fr');
    fs.writeFileSync(outside, '« Passage exact. »');
    const citations = async () => ({ passed: true, status: 'passed', message: 'ok', results: [
      { origin: file, correction: { avant: 'Passage exact. »', apres: 'Passage exact. Complété. »' } },
      { origin: outside, correction: { avant: 'Passage exact.', apres: 'Modifié.' } },
    ] });
    await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run: runner, python: null, credentials: null, citations } });
    assert.equal(fs.readFileSync(file, 'utf8').match(/Complété/g).length, 1);
    assert.equal(fs.readFileSync(file, 'utf8').match(/Passage exact\./g).length, 2);
    assert.equal(fs.readFileSync(outside, 'utf8'), '« Passage exact. »');
  } finally { cleanup(); }
});

test('section appends a verified source section that keeps the documentation valid', async () => {
  const { dossier, home, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime', { 'prime.catala_fr': MODULE });
    fs.mkdirSync(path.join(home, 'articles'), { recursive: true });
    fs.mkdirSync(path.join(home, 'decisions'), { recursive: true });
    const long = 'Le débiteur fictif doit payer la prime convenue dans un délai raisonnable fixé par le contrat conclu entre Jean Dupont et la Société Exemple SAS.';
    fs.writeFileSync(path.join(home, 'articles', 'LEGIARTI000000000001.json'), JSON.stringify({ at: '2020-01-01', reponse: { article: { id: 'LEGIARTI000000000001', num: '1', texte: long, texteHtml: `<p>${long}</p><p></p><p>Second alin&#233;a&nbsp;fictif.</p>`, nota: 'Note fictive.', dateDebut: Date.UTC(2020, 0, 1), dateFin: Date.UTC(2021, 0, 1) } } }));
    fs.writeFileSync(path.join(home, 'decisions', 'JURITEXT000000000001.json'), JSON.stringify({ titre: 'Cour de cassation, 1er janvier 2024, n° 00-00.000', texte: 'Attendu que la prime est due &amp; exigible.' }));
    const deps = { env: { PIECEMAKER_HOME: home }, homeDir: home, python: null, credentials: null };
    const section = (flags) => runCatala({ commande: 'section', cwd: dossier, flags: { fichier: 'prime.catala_fr', ...flags }, deps });
    const file = path.join(directory, 'prime.catala_fr');
    const lines = MODULE.split('\n').length + 1;
    assert.equal(await section({ source: 'LEGIARTI000000000001', extrait: 'doit  payer la prime convenue' }), `Section ajoutée : .piecemaker/catala/prime/prime.catala_fr:${lines} (Article 1 | LEGIARTI000000000001). Écrivez ensuite son bloc \`\`\`catala sous le texte.`);
    assert.match(await section({ source: 'JURITEXT000000000001', extrait: 'la prime est due & exigible', titre: 'Cass. fictive' }), /prime\.catala_fr:\d+ \(Cass\. fictive \| JURITEXT000000000001\)/);
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.includes('## Article 1 | LEGIARTI000000000001\n\n« doit payer la prime convenue »\n\nLe débiteur fictif doit payer la prime convenue dans un délai raisonnable fixé\npar le contrat conclu entre Jean Dupont et la Société Exemple SAS.\n\nSecond alinéa fictif.\n\nNOTA :\n\nNote fictive.\n\n## Cass. fictive | JURITEXT000000000001\n'));
    assert.ok(content.split('\n').every((line) => line.length <= 80));
    assert.deepEqual(catalaDocumentation(content).errors, []);
    await assert.rejects(() => section({ source: 'LEGIARTI000000000001', extrait: 'la prime est inventée' }), /Extrait absent du texte de LEGIARTI000000000001/);
    await assert.rejects(() => section({ source: 'LEGIARTI000000000002', extrait: 'prime' }), /absent du cache local : lisez l'article avec consulter_article/);
    await assert.rejects(() => section({ source: 'JURITEXT000000000002', extrait: 'prime' }), /lisez la décision avec consulter_decision/);
    await assert.rejects(() => section({ source: 'ARTICLE1', extrait: 'prime' }), TypeError);
    await assert.rejects(() => section({ source: 'LEGIARTI000000000001', extrait: 'prime', fichier: '../autre.catala_fr' }), /dans \.piecemaker\/catala\/prime\//);
    await assert.rejects(() => section({ source: 'LEGIARTI000000000001', extrait: 'prime', fichier: 'resultats/a.catala_fr' }), TypeError);
    await assert.rejects(() => section({ source: 'LEGIARTI000000000001', extrait: 'prime', titre: 'A | B' }), /sans « \| »/);
    assert.equal(fs.readFileSync(file, 'utf8'), content);
    await section({ source: 'LEGIARTI000000000001', extrait: 'prime', fichier: 'nouveau.catala_fr' });
    assert.match(fs.readFileSync(path.join(directory, 'nouveau.catala_fr'), 'utf8'), /^## Article 1 \| LEGIARTI000000000001\n\n« prime »\n/);
  } finally { cleanup(); }
});

test('typecheckErrors compiles a copy with the written content and keeps only real compiler errors', async () => {
  const { dossier, home, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime');
    fs.mkdirSync(path.join(directory, 'resultats'));
    const file = path.join(directory, 'prime.catala_fr');
    const seen = [];
    const run = async (command, args, options) => {
      seen.push({ tool: path.basename(command), args, copied: fs.readdirSync(options.cwd).sort(), content: fs.readFileSync(path.join(options.cwd, 'prime.catala_fr'), 'utf8'), timeout: options.timeout });
      if (seen.at(-1).content === 'crash') return { code: 2, stdout: '', stderr: 'Fatal error' };
      return { code: 123, stdout: '', stderr: 'prime.catala_fr:3.5-9: [ERROR] 1/2: Unknown identifier "x"\ntest_prime.catala_fr:1.1-15: [ERROR] Required module not found: Absent\n' };
    };
    const options = { env: { PIECEMAKER_COMPONENTS_HOME: home }, homeDir: home, run, timeout: 5 };
    assert.deepEqual(await typecheckErrors(directory, file, 'nouveau', { env: {}, homeDir: dossier, run }), []);
    assert.deepEqual(seen, []);
    assert.deepEqual(await typecheckErrors(directory, file, 'nouveau', options), [{ file: 'prime.catala_fr', line: 3, message: 'Unknown identifier "x"' }]);
    assert.deepEqual(seen[0], { tool: 'clerk', args: ['typecheck', '--color=never', '--catala-opts=--check-invariants', '--catala-opts=--message-format=gnu'], copied: ['clerk.toml', 'prime.catala_fr', 'tache.json', 'test_prime.catala_fr'], content: 'nouveau', timeout: 5 });
    assert.deepEqual(await typecheckErrors(directory, file, 'crash', options), []);
    assert.equal(fs.readFileSync(file, 'utf8'), MODULE);
  } finally { cleanup(); }
});
