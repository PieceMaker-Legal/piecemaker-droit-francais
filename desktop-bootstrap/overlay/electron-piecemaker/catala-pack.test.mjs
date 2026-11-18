import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { startCatalaPack } from './catala-pack.mjs';

function recorder() {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args, options });
    return { unref: () => calls.push('unref') };
  };
  return { calls, spawnProcess };
}

test('the packaged app starts the Catala pack installer in the background with its own Node', () => {
  const { calls, spawnProcess } = recorder();
  startCatalaPack({ app: { isPackaged: true }, applicationRoot: '/app', spawnProcess, exists: () => true, env: { HOME: '/home/jean' }, execPath: '/app/PieceMaker' });
  assert.equal(calls[0].command, '/app/PieceMaker');
  assert.deepEqual(calls[0].args, [path.join('/app', 'desktop-bootstrap', 'composants', 'catala.mjs')]);
  assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, 'ignore');
  assert.equal(calls[1], 'unref');
});

test('development runs and missing installer scripts start nothing', () => {
  const { calls, spawnProcess } = recorder();
  assert.equal(startCatalaPack({ app: { isPackaged: false }, applicationRoot: '/app', spawnProcess, exists: () => true }), null);
  assert.equal(startCatalaPack({ app: { isPackaged: true }, applicationRoot: '/app', spawnProcess, exists: () => false }), null);
  assert.deepEqual(calls, []);
});
