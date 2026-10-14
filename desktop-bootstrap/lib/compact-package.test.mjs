import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { configureCompactPackage } from './compact-package.mjs';

test('native and external script dependency closures stay physical even with export-only packages', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-compact-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'server/piecemaker'), { recursive: true });
  await fs.writeFile(path.join(root, 'server/piecemaker/worker.mjs'), "import 'export-only/subpath';");
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    dependencies: { 'export-only': '1.0.0' }, build: { files: [], nsis: {} },
  }));
  for (const [name, dependencies] of [['export-only', { child: '1.0.0' }], ['child', {}]]) {
    const directory = path.join(root, 'node_modules', name);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, dependencies, exports: { './subpath': './subpath.js' } }));
  }
  const manifest = await configureCompactPackage(root);
  assert.equal(manifest.build.asar, true);
  assert.ok(manifest.build.asarUnpack.includes('node_modules/export-only/**'));
  assert.ok(manifest.build.asarUnpack.includes('node_modules/child/**'));
  assert.equal(manifest.build.nsis.differentialPackage, true);
});
