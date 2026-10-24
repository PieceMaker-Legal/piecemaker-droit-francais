import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { configureRuntimeEnvironment, createRuntimeResolver } from './asar-runtime.mjs';

test('physical server imports fall back to the packed application without changing relative imports', () => {
  const packedRoot = path.resolve('fixture/app.asar');
  const physicalRoot = `${packedRoot}.unpacked`;
  const resolve = createRuntimeResolver({ packedRoot, physicalRoot });
  const parentURL = pathToFileURL(path.join(physicalRoot, 'dist-server/server/index.js')).href;
  const missing = Object.assign(new Error('not found'), { code: 'ERR_MODULE_NOT_FOUND' });
  const calls = [];
  const result = resolve('pure-module', { parentURL }, (specifier, context) => {
    calls.push({ specifier, parentURL: context.parentURL });
    if (context.parentURL === parentURL) throw missing;
    return { url: 'file:///resolved.js' };
  });
  assert.equal(result.url, 'file:///resolved.js');
  assert.equal(calls[1].parentURL, pathToFileURL(path.join(packedRoot, 'dist-server/server/index.js')).href);
  assert.throws(() => resolve('./missing.js', { parentURL }, () => { throw missing; }), (error) => error === missing);
  const otherError = new Error('access denied');
  assert.throws(() => resolve('pure-module', { parentURL }, () => { throw otherError; }), (error) => error === otherError);
});

test('preload survives spaces in installation paths and preserves configured server entries', () => {
  const physicalRoot = path.resolve('fixture with spaces/app.asar.unpacked');
  const settings = { packedRoot: physicalRoot.replace(/\.unpacked$/, ''), physicalRoot, moduleRoots: [] };
  const environment = { NODE_OPTIONS: '--trace-warnings', ELECTRON_SERVER_ENTRY: '/custom/server.js' };
  configureRuntimeEnvironment({ ...settings, environment });
  const first = environment.NODE_OPTIONS;
  configureRuntimeEnvironment({ ...settings, environment });
  assert.equal(environment.NODE_OPTIONS, first);
  assert.ok(first.includes('%20'));
  assert.equal(environment.ELECTRON_SERVER_ENTRY, '/custom/server.js');
});


for (const nativeArchive of [false, true]) test(`physical server, worker and plugin subprocess resolve packed and external ESM and CommonJS packages (${nativeArchive ? 'Electron ASAR' : 'Node directories'})`, async (t) => {
  let executable = process.execPath;
  let createPackage;
  if (nativeArchive) {
    try {
      const require = createRequire(import.meta.url);
      executable = require('electron');
      await fs.access(executable);
      ({ createPackage } = require('@electron/asar'));
    } catch {
      t.skip('Electron and @electron/asar must be installed for the native archive check');
      return;
    }
  }
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pm-asar-imports-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packedRoot = path.join(root, 'application with spaces', 'app.asar');
  const physicalRoot = `${packedRoot}.unpacked`;
  const moduleRoots = [path.join(root, 'components with spaces', 'node_modules')];
  const packedStage = nativeArchive ? path.join(root, 'stage') : packedRoot;
  const write = async (file, contents) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, contents);
  };
  for (const [directory, name] of [[path.join(packedStage, 'node_modules'), 'packed-example'], [moduleRoots[0], 'external-example']]) {
    const packageRoot = path.join(directory, name);
    await write(path.join(packageRoot, 'package.json'), JSON.stringify({
      name, type: 'module', exports: { import: './entry.mjs', require: './entry.cjs' },
    }));
    await write(path.join(packageRoot, 'entry.mjs'), `export default '${name}-esm';`);
    await write(path.join(packageRoot, 'entry.cjs'), `module.exports = '${name}-cjs';`);
  }
  if (nativeArchive) {
    await fs.mkdir(path.dirname(packedRoot), { recursive: true });
    await createPackage(packedStage, packedRoot);
  }
  await write(path.join(physicalRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  const consumer = path.join(physicalRoot, 'server', 'consume.mjs');
  await write(consumer, `
    import { createRequire } from 'node:module';
    import packed from 'packed-example';
    import external from 'external-example';
    const require = createRequire(import.meta.url);
    export default [packed, external, require('packed-example'), require('external-example')];
  `);
  const entry = path.join(physicalRoot, 'server', 'entry.mjs');
  await write(entry, `
    import { once } from 'node:events';
    import { execFileSync } from 'node:child_process';
    import { Worker } from 'node:worker_threads';
    import { fileURLToPath } from 'node:url';
    import values from './consume.mjs';
    const worker = new Worker(new URL('./worker.mjs', import.meta.url));
    const workerExit = once(worker, 'exit');
    const [workerValues] = await once(worker, 'message');
    await workerExit;
    const pluginValues = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('./plugin.mjs', import.meta.url))], { encoding: 'utf8' }));
    process.stdout.write(JSON.stringify([values, workerValues, pluginValues]));
  `);
  await write(path.join(physicalRoot, 'server', 'worker.mjs'), `
    import { parentPort } from 'node:worker_threads';
    import values from './consume.mjs';
    parentPort.postMessage(values);
  `);
  await write(path.join(physicalRoot, 'server', 'plugin.mjs'), `
    import values from './consume.mjs';
    process.stdout.write(JSON.stringify(values));
  `);
  const preload = path.join(root, 'register.mjs');
  await write(preload, `
    import { registerRuntimeModules } from ${JSON.stringify(new URL('./asar-runtime.mjs', import.meta.url).href)};
    registerRuntimeModules(${JSON.stringify({ packedRoot, physicalRoot, moduleRoots })});
  `);
  const run = promisify(execFile);
  const environment = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '', NODE_PATH: [path.join(packedRoot, 'node_modules'), ...moduleRoots].join(path.delimiter) };
  await assert.rejects(run(executable, [entry], { env: environment }), (error) => {
    assert.match(error.stderr, /ERR_MODULE_NOT_FOUND/);
    return true;
  });
  const runtimeEnvironment = { ...environment, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` };
  if (nativeArchive) {
    const runtimeFile = path.join(physicalRoot, 'electron-piecemaker', 'asar-runtime.mjs');
    await fs.mkdir(path.dirname(runtimeFile), { recursive: true });
    await fs.copyFile(new URL('./asar-runtime.mjs', import.meta.url), runtimeFile);
    runtimeEnvironment.NODE_OPTIONS = '';
    configureRuntimeEnvironment({ packedRoot, physicalRoot, moduleRoots, environment: runtimeEnvironment });
  }
  const { stdout, stderr } = await run(executable, [entry], { env: runtimeEnvironment });
  assert.equal(stderr, '');
  const expected = ['packed-example-esm', 'external-example-esm', 'packed-example-cjs', 'external-example-cjs'];
  assert.deepEqual(JSON.parse(stdout), [expected, expected, expected]);
});
