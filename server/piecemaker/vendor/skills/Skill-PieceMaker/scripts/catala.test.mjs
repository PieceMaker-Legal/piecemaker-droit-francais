import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { catalaHomes, findCatalaPack, listPrograms, pisteCredentials, runCatala, selectProgram, sharedPython, toolCommand } from './catala.mjs';
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

function fakeRun({ testsPass = true, proofOutput = 'No errors found during the proof mode run.\n' } = {}) {
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command: path.basename(command), args, cwd: options.cwd, env: options.env });
    const tool = path.basename(command);
    if (tool === 'catala-format') return { code: 0, stdout: fs.readFileSync(path.join(options.cwd, args.at(-1)), 'utf8'), stderr: '' };
    if (tool === 'clerk' && args[0] === 'test') {
      const scopes = [{ scope_name: 'JeanDupont', success: testsPass, errors: [], time: 0.1 }];
      return { code: testsPass ? 0 : 1, stdout: JSON.stringify({ 'test-results': [{ file: path.join(options.cwd, args.at(-1)), tests: { scopes, 'inline-tests': [] } }], coverage: {} }), stderr: '' };
    }
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
    const { calls, runner } = fakeRun();
    const text = await runCatala({ commande: 'verifier', cwd: dossier, deps: { env: { PIECEMAKER_HOME: home, PATH: '/usr/bin' }, homeDir: home, run: runner, python: '/usr/bin/python3', credentials: null, now: () => '2026-01-02T00:00:00Z' } });
    assert.match(text, /vérifié/);
    const report = JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8'));
    assert.equal(report.passed, true);
    assert.match(report.sources_sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(report.checks.map((entry) => entry.name), ['typecheck', 'format', 'tests', 'tests-python']);
    assert.ok(fs.existsSync(path.join(directory, 'resultats', 'tests.json')));
    const clerkTest = calls.find((call) => call.command === 'clerk' && call.args[0] === 'test');
    assert.deepEqual(clerkTest.args, ['test', '--json', '--code-coverage', 'test_prime.catala_fr']);
    assert.equal(clerkTest.cwd, directory);
    assert.equal(clerkTest.env.OPAMSWITCH, 'catala');
    assert.ok(clerkTest.env.PATH.endsWith('/usr/bin'));
  } finally {
    cleanup();
  }
});

test('a failing test or an unformatted file makes the verification fail', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime-anciennete');
    const { runner } = fakeRun({ testsPass: false });
    const deps = { env: { PIECEMAKER_HOME: home }, homeDir: home, python: null, credentials: null };
    const text = await runCatala({ commande: 'verifier', cwd: dossier, deps: { ...deps, run: runner } });
    assert.match(text, /Tests en échec : test_prime.catala_fr › JeanDupont/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'verification.json'), 'utf8')).passed, false);
    const unformatted = async (command, args, options) => (path.basename(command) === 'catala-format' ? { code: 0, stdout: 'autre', stderr: '' } : runner(command, args, options));
    assert.match(await runCatala({ commande: 'verifier', cwd: dossier, deps: { ...deps, run: unformatted } }), /format : échec \(prime.catala_fr, test_prime.catala_fr\)/);
  } finally {
    cleanup();
  }
});

test('a proof with an overlap warning fails and Windows refuses proofs', async () => {
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
    assert.deepEqual(calls.filter((call) => call.command === 'clerk').map((call) => call.args[0]), ['start']);
    await assert.rejects(() => runCatala({ commande: 'preuve', cwd: dossier, flags: {}, deps }), /--scope/);
    fs.writeFileSync(path.join(home, 'catala', 'pack.json'), JSON.stringify({ ...pack, proof: false }));
    await assert.rejects(() => runCatala({ commande: 'preuve', cwd: dossier, flags: { scope: 'Prime' }, deps }), /Windows/);
  } finally {
    cleanup();
  }
});

test('catleg runs in the shared Python with the PISTE credentials of the child only', async () => {
  const { home, dossier, cleanup } = scratch();
  try {
    const directory = program(dossier, 'prime-anciennete');
    const calls = [];
    const runner = async (command, args, options) => {
      calls.push({ command, args, env: options.env });
      return { code: 0, stdout: '', stderr: '' };
    };
    const deps = { env: { PIECEMAKER_HOME: home }, homeDir: home, run: runner, python: '/py/python3', credentials: { CATLEG_LF_CLIENT_ID: 'id', CATLEG_LF_CLIENT_SECRET: 's' }, now: () => '2026-03-04T10:00:00Z' };
    assert.match(await runCatala({ commande: 'catleg', cwd: dossier, flags: { fichier: 'prime.catala_fr' }, deps }), /vigueur au 2026-03-04/);
    assert.equal(calls[0].command, '/py/python3');
    assert.deepEqual(calls[0].args.slice(-2), ['check-expiry', 'prime.catala_fr']);
    assert.equal(calls[0].env.CATLEG_LF_CLIENT_ID, 'id');
    assert.equal(process.env.CATLEG_LF_CLIENT_ID, undefined);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'resultats', 'catleg.json'), 'utf8')).passed, true);
    await assert.rejects(() => runCatala({ commande: 'catleg', cwd: dossier, deps: { ...deps, credentials: null } }), /PISTE/);
  } finally {
    cleanup();
  }
});

test('Windows tools run through cmd and a missing pack reports the install status', async () => {
  const pack = { bin: { clerk: 'C:\\Catala\\bin\\clerk.cmd' } };
  assert.deepEqual(toolCommand(pack, 'clerk', ['test'], 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }), { command: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/s', '/c', 'C:\\Catala\\bin\\clerk.cmd', 'test'] });
  await assert.rejects(() => runCatala({ commande: 'verifier', cwd: os.tmpdir(), deps: { findPack: () => ({ pack: null, status: { state: 'installation', step: 'switch' } }) } }), /étape switch/);
});

test('pm catala routes to the Catala wrapper and rejects unknown commands', async () => {
  const seen = [];
  const deps = { catalaFn: async (input) => { seen.push(input); return 'ok'; } };
  assert.equal(await run(['catala', 'verifier', '--programme', 'prime', '--dossier', '/tmp/dossier'], { deps }), 'ok');
  assert.equal(seen[0].programme, 'prime');
  assert.equal(seen[0].cwd, path.resolve('/tmp/dossier'));
  await run(['catala', 'exec', 'clerk', '--', '--help'], { deps, cwd: '/tmp' });
  assert.deepEqual(seen[1].args, ['clerk', '--help']);
  await assert.rejects(() => run(['catala', 'compiler'], { deps }), (error) => error.exitCode === 2);
  const failing = { catalaFn: async () => { throw new TypeError('Plusieurs programmes'); } };
  await assert.rejects(() => run(['catala', 'verifier'], { deps: failing }), (error) => error.exitCode === 2 && /Plusieurs/.test(error.message));
});
