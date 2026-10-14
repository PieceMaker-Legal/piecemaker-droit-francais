import assert from 'node:assert/strict';
import path from 'node:path';
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
