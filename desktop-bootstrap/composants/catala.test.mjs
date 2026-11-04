import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { catalaLayout, catalaPackId, catalaRecipe, installCatalaPack, macosSteps } from './catala.mjs';

function memoryHost({ files = {}, failOn = null, cpus = 8, lockAvailable = true } = {}) {
  const store = new Map(Object.entries(files));
  const runs = [];
  return {
    store,
    runs,
    exists: async (target) => store.has(target) || [...store.keys()].some((key) => key.startsWith(`${target}${path.sep}`)),
    readFile: async (target) => {
      if (!store.has(target)) throw new Error('ENOENT');
      return store.get(target);
    },
    writeFile: async (target, content) => { store.set(target, content); },
    mkdir: async () => {},
    rm: async (target) => {
      for (const key of [...store.keys()]) if (key === target || key.startsWith(`${target}${path.sep}`)) store.delete(key);
    },
    list: async (target) => [...new Set([...store.keys()].filter((key) => key.startsWith(`${target}${path.sep}`)).map((key) => key.slice(target.length + 1).split(path.sep)[0]))],
    lock: async () => lockAvailable,
    unlock: async () => {},
    run: async (command, args, options) => {
      runs.push({ command, args, env: options.env });
      if (failOn && args.includes(failOn)) return { code: 3, output: 'erreur simulée' };
      if (args[0] === 'install') {
        const prefix = path.join(options.env.OPAMROOT, 'catala');
        for (const name of ['catala', 'clerk', 'catala-lsp', 'catala-format', 'catala-dap']) store.set(path.join(prefix, 'bin', name), '');
        store.set(path.join(prefix, 'lib', 'catala', 'runtime', 'python', 'src', 'catala', 'catala_runtime.py'), '');
      }
      return { code: 0, output: args[0] === '--version' ? '1.3.0\n' : '' };
    },
    cpus: () => cpus,
  };
}

const home = path.join(os.tmpdir(), 'catala-home');
const env = { PIECEMAKER_COMPONENTS_HOME: home, PATH: '/usr/bin' };
const brew = path.join('/opt/homebrew/bin', 'brew');
const opam = path.join('/opt/homebrew/bin', 'opam');

test('the recipe keeps the official Catala commits, URLs and the verified Windows MSI', () => {
  assert.equal(catalaRecipe.catala.commit, 'e86fc2f5af14af40d80bfba655ef1d8cd6dee93c');
  for (const url of Object.values(catalaRecipe.macos.pins)) assert.match(url, /^git\+https:\/\/github\.com\/CatalaLang\/[a-z-]+\.git#[0-9a-f]{40}$/);
  assert.ok(catalaRecipe.macos.packages.includes('z3.5.1.0'));
  assert.ok(catalaRecipe.macos.packages.includes('catala-format.1.3.0'));
  assert.match(catalaRecipe.windows.msi.url, /^https:\/\/github\.com\/CatalaLang\/installers\/releases\/download\//);
  assert.match(catalaRecipe.windows.msi.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(catalaPackId(catalaRecipe, 'macos'), catalaPackId(catalaRecipe, 'windows'));
});

test('macOS steps keep opam inside the private pack directory and pin every package version', () => {
  const steps = macosSteps(catalaRecipe, '/pack', 4);
  assert.deepEqual(steps.map((step) => step.name), ['opam-init', 'switch', 'pin-catala', 'pin-catala-proof', 'pin-catala-lsp', 'install']);
  assert.equal(steps[0].done, path.join('/pack', 'opam', 'config'));
  assert.ok(steps.at(-1).args.includes('--jobs=4'));
  assert.ok(steps.at(-1).args.includes('topiary.0.6.0'));
});

test('a first macOS start installs the pack, records it and proves its tools run', async () => {
  const host = memoryHost({ files: { [brew]: '', [opam]: '' } });
  const result = await installCatalaPack({ env, platform: 'darwin', arch: 'arm64', host, homeDir: '/home/jean', now: () => 'T' });
  assert.equal(result.state, 'pret');
  const layout = catalaLayout(env);
  const pack = JSON.parse(host.store.get(layout.packFile));
  assert.equal(pack.id, catalaPackId(catalaRecipe, 'macos'));
  assert.equal(pack.proof, true);
  assert.equal(pack.env.OPAMROOT, path.join(layout.base, pack.id, 'opam'));
  assert.ok(pack.bin.catala.startsWith(path.join(layout.base, pack.id)));
  assert.ok(host.runs.some((run) => run.args.join(' ') === 'proof --help=plain'));
  assert.equal(JSON.parse(host.store.get(layout.statusFile)).state, 'pret');
});

test('a ready pack is detected without running anything again', async () => {
  const host = memoryHost({ files: { [brew]: '', [opam]: '' } });
  await installCatalaPack({ env, platform: 'darwin', arch: 'arm64', host, homeDir: '/home/jean' });
  const before = host.runs.length;
  const again = await installCatalaPack({ env, platform: 'darwin', arch: 'arm64', host, homeDir: '/home/jean' });
  assert.equal(again.state, 'pret');
  assert.equal(host.runs.length, before);
});

test('a new recipe replaces only the packs PieceMaker owns, after the new one works', async () => {
  const layout = catalaLayout(env);
  const old = path.join(layout.base, 'ancien');
  const foreign = path.join(layout.base, 'autre', 'fichier');
  const host = memoryHost({ files: { [brew]: '', [opam]: '', [path.join(old, '.piecemaker-catala.json')]: JSON.stringify({ owner: 'piecemaker-catala' }), [foreign]: '' } });
  await installCatalaPack({ env, platform: 'darwin', arch: 'arm64', host, homeDir: '/home/jean' });
  assert.equal(await host.exists(old), false);
  assert.equal(await host.exists(foreign), true);
});

test('a failed step is reported with its name and keeps the previous pack', async () => {
  const layout = catalaLayout(env);
  const host = memoryHost({ files: { [brew]: '', [opam]: '', [layout.packFile]: JSON.stringify({ id: 'ancien' }) }, failOn: 'install' });
  const result = await installCatalaPack({ env, platform: 'darwin', arch: 'arm64', host, homeDir: '/home/jean' });
  assert.equal(result.state, 'echec');
  assert.equal(result.step, 'install');
  assert.equal(JSON.parse(host.store.get(layout.packFile)).id, 'ancien');
  assert.equal(JSON.parse(host.store.get(layout.statusFile)).step, 'install');
});

test('macOS without Homebrew records why the pack is unavailable', async () => {
  const host = memoryHost();
  const result = await installCatalaPack({ env, platform: 'darwin', arch: 'arm64', host, homeDir: '/home/jean' });
  assert.equal(result.state, 'indisponible');
  assert.match(result.error, /Homebrew/);
  assert.deepEqual(host.runs, []);
});

test('a running installation is not started twice', async () => {
  const host = memoryHost({ files: { [brew]: '', [opam]: '' }, lockAvailable: false });
  assert.equal((await installCatalaPack({ env, platform: 'darwin', arch: 'arm64', host, homeDir: '/home/jean' })).state, 'en-cours');
  assert.deepEqual(host.runs, []);
});

test('Windows extracts the verified official MSI, configures its grammars and disables proofs', async () => {
  const host = memoryHost();
  const layout = catalaLayout(env);
  const directory = path.join(layout.base, catalaPackId(catalaRecipe, 'windows'));
  const extracted = path.win32.join(directory, 'msi', 'CommonAppData', 'Catala');
  host.download = async (_fetch, url, destination, digest) => {
    assert.equal(url, catalaRecipe.windows.msi.url);
    assert.equal(digest, catalaRecipe.windows.msi.sha256);
    host.store.set(destination, 'msi');
  };
  const run = host.run;
  host.run = async (command, args, options) => {
    if (args[0] === '/a') {
      for (const name of ['catala', 'clerk', 'catala-lsp', 'catala-format', 'catala-dap']) host.store.set(path.win32.join(extracted, 'bin', `${name}.cmd`), '');
      host.store.set(path.join(path.win32.join(extracted, 'toolchain', 'lib', 'catala', 'runtime', 'python', 'src'), 'catala', 'catala_runtime.py'), '');
    }
    return run(command, args, options);
  };
  host.list = async (target) => [...new Set([...host.store.keys()].filter((key) => key.startsWith(`${target}\\`)).map((key) => key.slice(target.length + 1).split('\\')[0]))];
  host.exists = async (target) => host.store.has(target) || [...host.store.keys()].some((key) => key.startsWith(`${target}\\`) || key.startsWith(`${target}/`));
  const result = await installCatalaPack({ env: { ...env, SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, platform: 'win32', arch: 'x64', host, homeDir: '/home/jean' });
  assert.equal(result.state, 'pret', result.error);
  assert.equal(result.pack.proof, false);
  assert.equal(result.pack.prefix, extracted);
  const commands = host.runs.map((entry) => entry.args[0]);
  assert.deepEqual(commands.slice(0, 2), ['/a', '-NoProfile']);
  assert.ok(host.runs[1].args.includes(extracted));
  assert.ok(host.runs.slice(2).every((entry) => entry.args[0] === '/d'));
  assert.equal([...host.store.keys()].some((key) => key.endsWith('.msi')), false);
});

test('unsupported platforms are recorded as unavailable', async () => {
  const host = memoryHost();
  assert.equal((await installCatalaPack({ env, platform: 'linux', arch: 'x64', host, homeDir: '/home/jean' })).state, 'indisponible');
});

test('the default host writes JSON atomically under the components root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'catala-'));
  try {
    const result = await installCatalaPack({ env: { PIECEMAKER_COMPONENTS_HOME: root }, platform: 'linux', arch: 'x64' });
    assert.equal(result.state, 'indisponible');
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'catala', 'status.json'), 'utf8')).state, 'indisponible');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
