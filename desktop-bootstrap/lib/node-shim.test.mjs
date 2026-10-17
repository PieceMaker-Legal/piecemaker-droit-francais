import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NODE_SHIM_DIR, embedNodeShim, nodeShimScript } from './node-shim.mjs';

async function stage(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-node-shim-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ build: { files: ['server/**'], extraResources: [{ from: 'mingit', to: 'mingit' }] } }));
  return directory;
}

test('the shim runs the app executable two levels up as Node with every argument', () => {
  const script = nodeShimScript('PieceMaker.exe');
  assert.match(script, /^set ELECTRON_RUN_AS_NODE=1\r$/m);
  assert.match(script, /^"%~dp0\.\.\\\.\.\\PieceMaker\.exe" %\*\r$/m);
});

test('ships node.cmd as an extra resource next to the app', async (t) => {
  const directory = await stage(t);
  await embedNodeShim(directory);
  await embedNodeShim(directory);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.build.extraResources, [{ from: 'mingit', to: 'mingit' }, { from: NODE_SHIM_DIR, to: NODE_SHIM_DIR }]);
  assert.equal(await fs.readFile(path.join(directory, NODE_SHIM_DIR, 'node.cmd'), 'utf8'), nodeShimScript());
});
