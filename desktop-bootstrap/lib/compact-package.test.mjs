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
  assert.ok(manifest.build.asarUnpack.includes('dist/**'));
  assert.ok(manifest.build.asarUnpack.includes('public/**'));
  assert.ok(manifest.build.asarUnpack.includes('electron-piecemaker/runtime-components.mjs'));
  assert.ok(manifest.build.asarUnpack.includes('electron-piecemaker/ui-update-runtime.json'));
  assert.ok(manifest.build.asarUnpack.includes('node_modules/export-only/**'));
  assert.ok(manifest.build.asarUnpack.includes('node_modules/child/**'));
  assert.equal(manifest.build.nsis.differentialPackage, true);
});

test('Express keeps its CommonJS dependency closure physical', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-express-compact-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'server'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: {}, build: { files: [], nsis: {} } }));
  const packages = [
    ['express', path.join(root, 'node_modules', 'express'), { send: '0.19.2' }],
    ['send', path.join(root, 'node_modules', 'express', 'node_modules', 'send'), { mime: '1.6.0' }],
    ['mime', path.join(root, 'node_modules', 'mime'), {}],
  ];
  for (const [name, directory, dependencies] of packages) {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, dependencies }));
  }

  const manifest = await configureCompactPackage(root);
  assert.ok(manifest.build.asarUnpack.includes('node_modules/express/**'));
  assert.ok(manifest.build.asarUnpack.includes('node_modules/express/node_modules/send/**'));
  assert.ok(manifest.build.asarUnpack.includes('node_modules/send/**'));
  assert.ok(manifest.build.asarUnpack.includes('node_modules/mime/**'));
});

test('install scripts run by an external Node only import unpacked files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-unpacked-imports-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: {}, build: { files: [], nsis: {} } }));
  const { asarUnpack } = (await configureCompactPackage(root)).build;
  const isUnpacked = (file) => asarUnpack.some((pattern) => (
    pattern.endsWith('/**') ? file.startsWith(pattern.slice(0, -2)) : file === pattern
  ));
  const repoRoot = path.resolve(import.meta.dirname, '../..');
  const sourceOf = (file) => path.join(repoRoot, file.startsWith('electron-piecemaker/') ? `desktop-bootstrap/overlay/${file}` : file);
  const pending = ['desktop-bootstrap/lib/finish-install.mjs', 'desktop-bootstrap/lib/prepare-installed.mjs'];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    assert.ok(isUnpacked(file), `${file} est importé hors Electron mais reste dans app.asar`);
    const source = await fs.readFile(sourceOf(file), 'utf8');
    for (const [, specifier] of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
    }
  }
  assert.ok(seen.has('electron-piecemaker/runtime-components.mjs'));
});

test('MIME stays physical when installed as a direct dependency', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-mime-compact-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'node_modules', 'mime'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { mime: '1.6.0' }, build: { files: [], nsis: {} } }));
  await fs.writeFile(path.join(root, 'node_modules', 'mime', 'package.json'), JSON.stringify({ name: 'mime', version: '1.6.0' }));

  const manifest = await configureCompactPackage(root);
  assert.ok(manifest.build.asarUnpack.includes('node_modules/mime/**'));
});
