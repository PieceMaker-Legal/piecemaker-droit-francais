import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { catalaHomes, compilerErrors, findCatalaPack, listPrograms, pisteCredentials, runCatala, selectProgram, sharedPython, toolCommand } from './catala.mjs';
import { run } from './pm.mjs';

const MODULE = '> Module Prime\n\n```catala-metadata\ndéclaration champ d\'application Prime:\n  résultat montant contenu argent\n```\n';
const TESTS = '> Usage de Prime\n\n```catala\n#[test]\ndéclaration champ d\'application JeanDupont:\n  résultat calcul champ d\'application Prime.Prime\n```\n';

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
    assert.deepEqual(report.checks.map((entry) => entry.name), ['documentation', 'typecheck', 'format', 'premisses', 'tests', 'tests-python', 'preuve', 'catleg', 'citations', 'explication']);
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
  const runner = async (command, args) => args.includes('lf')
    ? { code: 0, stdout: JSON.stringify({ article: { id: 'LEGIARTI000000000001', dateDebut: '2020-01-01', dateFin: '2999-01-01' } }), stderr: '' }
    : { code: 0, stdout: 'PIECEMAKER_ARTICLES=[]\n', stderr: '' };
  const deps = { env: { PIECEMAKER_HOME: context.home }, homeDir: context.home, run: runner, python: '/py/python3', credentials: { CATLEG_LF_CLIENT_ID: 'id', CATLEG_LF_CLIENT_SECRET: 's' }, now: () => '2026-03-04T10:00:00Z' };
  const report = () => JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'catleg.json'), 'utf8'));
  return { ...context, directory, deps, report };
}

test('catleg checks an identifier cited only in a doc attribute', async () => {
  const { dossier, deps, report, cleanup } = catlegScenario({ 'prime.catala_fr': '#[doc.source = "LEGIARTI000000000001"]\n' });
  try {
    const text = await runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2026-03-04' }, deps });
    assert.match(text, /1 article\(s\) contrôlé/);
    assert.equal(report().passed, true);
    assert.deepEqual(report().fichiers[0].articles, ['LEGIARTI000000000001']);
    assert.doesNotMatch(JSON.stringify(report()), /non reconnus/);
    await runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2019-12-31' }, deps });
    assert.equal(report().passed, false);
  } finally { cleanup(); }
});

test('catleg takes the reference date from --au, then tache.json, and accepts today', async () => {
  const task = { tache: 'Acte', type: 'contentieux', raisonnements: [], date_vigueur: '2024-01-15' };
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
  const { dossier, deps, cleanup } = catlegScenario({ 'prime.catala_fr': MODULE }, { tache: 'Acte', type: 'contentieux', raisonnements: [{ champ: 'Prime', objectif: 'Calculer' }], date_vigueur: '2024-02-30' });
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
    await runCatala({ commande: 'catleg', cwd: dossier, flags: { au: '2021-06-01' }, deps: { ...deps, run: async (command, args, options) => args.includes('lf') ? runner(command, args, options) : { code: 1, stdout, stderr: 'expired' } } });
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
    assert.deepEqual(report.checks.map((entry) => [entry.name, entry.status]), [['documentation', 'passed'], ['typecheck', 'failed'], ['format', 'blocked'], ['premisses', 'blocked'], ['tests', 'blocked'], ['tests-python', 'blocked'], ['preuve', 'blocked'], ['catleg', 'missing'], ['citations', 'failed'], ['explication', 'blocked']]);
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

test('verifier requires doc, a nonempty quote and a title, in any language', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime');
    const { runner } = fakeRun();
    const cases = [
      ['', '#[doc] manquant'],
      ['#[doc="Source : référence fictive."]\n', 'quote manquante'],
      ['#[doc="quote: «   »"]\n', 'quote manquante'],
      ['#[doc="Sans citation"]\n#[doc="quote: « Passage exact. »"]\n', 'quote manquante'],
      ['#[doc="Source : référence fictive.\\nquote: « Passage exact. »"]\n', 'titre manquant'],
      ['#[doc="titre: Amount claimed\\nsource: ../../../pieces/contrat-fictif.md\\nquote: « Passage exact. »"]\n', null],
      ['#[doc="titre: Vérifier le montant de la prime\\nsource: https://example.org/texte-fictif\\nquote: « Passage exact. »"]\n', null],
      ['#[doc="titre: Montant de la prime\\nsource: okf:/_premises/montant-de-la-prime.md"]\n', null],
      ['#[doc="source: okf:/_premises/montant-de-la-prime.md"]\n', 'titre manquant'],
    ];
    for (const [annotation, message] of cases) {
      fs.writeFileSync(path.join(directory, 'prime.catala_fr'), MODULE + '\nCitation : « Une citation extérieure ne suffit pas. »\n\n```catala\nchamp d\'application Prime:\n' + annotation + 'définition montant égal à 10 €\n```\n');
      const output = await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run: runner, python: null, credentials: null } });
      const report = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8'));
      const check = report.checks.find((entry) => entry.name === 'documentation');
      assert.equal(check.passed, !message);
      if (message) {
        assert.equal(report.passed, false);
        assert.ok(check.errors.some((error) => error.includes('prime.catala_fr:') && error.includes(message)));
        assert.ok(output.includes(message));
      }
    }
    fs.writeFileSync(path.join(directory, 'prime.catala_fr'), MODULE + '\n```catala\nchamp d\'application Prime:\n#[doc="titre: Fixer le montant\\nquote: « Passage exact. »"]\ndéfinition montant égal à 10 €\ndéfinition autre égal à 20 €\ndéclaration taux contenu décimal égal à 0.1\n```\n');
    await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run: runner, python: null, credentials: null } });
    const check = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8')).checks.find((entry) => entry.name === 'documentation');
    assert.equal(check.errors.length, 2);
    assert.match(check.errors[0], /doc.*manquant/);
    const verify = async (task) => {
      fs.writeFileSync(path.join(directory, 'tache.json'), JSON.stringify(task));
      await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run: runner, python: null, credentials: null } });
      return JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8')).checks.find((entry) => entry.name === 'documentation').errors.filter((error) => error.startsWith('tache.json:1: '));
    };
    assert.deepEqual(await verify({ tache: 'Conclusions en défense Dupont / Société Exemple', type: 'contentieux', raisonnements: [{ champ: 'Prime', objectif: 'Obtenir la prime', rang: 'principal' }] }), []);
    const faults = await verify({ type: 'litige', raisonnements: [{ champ: 'Absent' }] });
    assert.equal(faults.length, 4);
    assert.match(faults.join('\n'), /sans nom[\s\S]*type de tâche inconnu[\s\S]*« Absent » : aucun champ[\s\S]*sans objectif/);
  } finally { cleanup(); }
});

const PREMISE_SOURCE = [
  '```catala-metadata',
  "déclaration champ d'application Prime:",
  '  #[doc = "source: okf:/_premises/exemple"]',
  '  entrée mention_lue contenu booléen',
  '  #[doc = "source: okf:/_premises/exemple"]',
  '  entrée mention_morte contenu booléen',
  '  résultat possible contenu booléen',
  '```',
  '',
].join('\n');

function premiseRun(edges) {
  const { runner } = fakeRun();
  return async (command, args, options) => {
    if (args[0] === 'dependency-graph' && args.includes('prime.catala_fr')) return { code: 0, stdout: JSON.stringify({ intra_scopes: { Prime: { nodes: { 3: 'possible', 2: 'mention_morte', 1: 'mention_lue' }, edges } }, inter_scopes: { nodes: { 1: 'Prime' }, edges: [] } }), stderr: '' };
    return runner(command, args, options);
  };
}

test('verifier accepts an OKF premise read by a rule', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime', { 'prime.catala_fr': PREMISE_SOURCE });
    const text = await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run: premiseRun([{ from: 1, to: 3 }, { from: 2, to: 3 }]), python: null, credentials: null } });
    assert.match(text, /- premisses : ok/);
    assert.doesNotMatch(text, /Prémisse sans effet/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8')).checks.find((entry) => entry.name === 'premisses').passed, true);
  } finally { cleanup(); }
});

test('verifier blocks an OKF premise that no rule reads', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime', { 'prime.catala_fr': PREMISE_SOURCE });
    const text = await runCatala({ commande: 'verifier', cwd: dossier, flags: { au: '2026-01-02' }, deps: { env: { PIECEMAKER_HOME: home }, homeDir: home, run: premiseRun([{ from: 1, to: 3 }]), python: null, credentials: null } });
    assert.match(text, /- premisses : échec/);
    assert.match(text, /Prémisse sans effet : Prime\.mention_morte cite okf:\/_premises\/exemple mais aucune règle ne la lit\./);
    assert.doesNotMatch(text, /Prime\.mention_lue/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8')).passed, false);
  } finally { cleanup(); }
});
