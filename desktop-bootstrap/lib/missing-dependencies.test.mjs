import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findMissingDependencies } from './build.mjs';

test('finds dependencies removed by npm prune even when the checkout has them', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-pruned-runtime-'));
  const stage = path.join(root, '.desktop-build', 'desktop-app');
  const modules = path.join(stage, 'node_modules');
  await fs.mkdir(path.join(modules, 'express', 'node_modules', 'send'), { recursive: true });
  await fs.mkdir(path.join(root, 'node_modules', 'mime'), { recursive: true });
  await fs.writeFile(path.join(modules, 'express', 'package.json'), JSON.stringify({ name: 'express', dependencies: { send: '0.19.2', buffer: '^5.5.0', string_decoder: '~1.1.1' } }));
  await fs.writeFile(path.join(modules, 'express', 'node_modules', 'send', 'package.json'), JSON.stringify({ name: 'send', dependencies: { mime: '1.6.0' } }));
  await fs.writeFile(path.join(root, 'node_modules', 'mime', 'package.json'), JSON.stringify({ name: 'mime', version: '1.6.0' }));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  assert.deepEqual(await findMissingDependencies(stage), ['mime@1.6.0']);
  await fs.mkdir(path.join(modules, 'mime'), { recursive: true });
  await fs.writeFile(path.join(modules, 'mime', 'package.json'), JSON.stringify({ name: 'mime', version: '1.6.0' }));
  assert.deepEqual(await findMissingDependencies(stage), []);
});
