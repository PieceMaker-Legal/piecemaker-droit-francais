import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildPlugins, discoverPlugins, validatePlugin } from './build.mjs';
import { INSTALLED_MARKER, syncPlugins } from './sync.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const quiet = { log() {}, error() {} };
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('every plugins/piecemaker-* follows the shared contract', () => {
  const sources = fs.readdirSync(path.join(appRoot, 'plugins')).filter((name) => name.startsWith('piecemaker-')).sort();
  const plugins = discoverPlugins(appRoot);
  assert.deepEqual(plugins.map((plugin) => plugin.id), sources);
  for (const plugin of plugins) validatePlugin(plugin);
  for (const legacy of ['install.mjs', 'launcher.mjs', 'build.mjs']) {
    assert.deepEqual(sources.filter((id) => fs.existsSync(path.join(appRoot, 'plugins', id, legacy))), [], `${legacy} propre à un plugin`);
  }
});

test('builds every plugin, installs them, repairs, removes and keeps user choices', async (t) => {
  if (!fs.existsSync(path.join(appRoot, 'node_modules', 'esbuild'))) return t.skip('dépendances de l\'application absentes');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-toolchain-'));
  const bundleDir = path.join(work, 'bundle');
  const dataRoot = path.join(work, 'data');
  const options = { bundleDir, dataRoot, databasePath: path.join(dataRoot, 'auth.db'), log: quiet };
  try {
    const plugins = await buildPlugins({ appRoot, outDir: bundleDir });
    const ids = plugins.map((plugin) => plugin.id);
    assert.ok(fs.existsSync(path.join(bundleDir, 'sync.mjs')));
    for (const id of ids) assert.ok(fs.existsSync(path.join(bundleDir, id, 'dist', 'index.js')), id);

    assert.deepEqual(syncPlugins(options).installed, ids);
    assert.deepEqual(syncPlugins(options).installed, []);

    const configPath = path.join(dataRoot, 'plugins.json');
    const config = readJson(configPath);
    for (const id of ['piecemaker-telegram', 'piecemaker-tabular-review']) {
      const runtime = readJson(path.join(dataRoot, 'plugins', id, 'runtime.json'));
      assert.equal(runtime.secret, config[id].secrets.access);
      assert.equal(runtime.secret.length, 64);
      assert.equal(runtime.databasePath, path.join(dataRoot, 'auth.db'));
      assert.equal(runtime.applicationRoot, appRoot);
      assert.ok(fs.existsSync(path.join(dataRoot, 'plugins', id, 'launcher.mjs')));
    }
    assert.equal(config['piecemaker-tampon'].secrets, undefined);

    config['piecemaker-timesheet'].enabled = false;
    fs.writeFileSync(configPath, JSON.stringify(config));
    fs.rmSync(path.join(dataRoot, 'plugins', 'piecemaker-tampon'), { recursive: true });
    fs.mkdirSync(path.join(dataRoot, 'plugins', 'piecemaker-obsolete'));
    fs.writeFileSync(path.join(dataRoot, 'plugins', 'piecemaker-obsolete', INSTALLED_MARKER), 'x\n');
    fs.mkdirSync(path.join(dataRoot, 'plugins', 'plugin-git-externe'));

    const repaired = syncPlugins(options);
    assert.deepEqual(repaired.installed, ['piecemaker-tampon']);
    assert.deepEqual(repaired.removed, ['piecemaker-obsolete']);
    assert.ok(fs.existsSync(path.join(dataRoot, 'plugins', 'plugin-git-externe')));
    const after = readJson(configPath);
    assert.equal(after['piecemaker-timesheet'].enabled, false);
    assert.equal(after['piecemaker-telegram'].secrets.access, config['piecemaker-telegram'].secrets.access);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('the Electron build embeds the bundle and the overlay installs it before the app starts', () => {
  const build = fs.readFileSync(path.join(appRoot, 'desktop-bootstrap', 'lib', 'build.mjs'), 'utf8');
  assert.match(build, /await embedBundledPlugins\(sourceDir, stageDir\)/);
  const overlay = fs.readFileSync(path.join(appRoot, 'desktop-bootstrap', 'overlay', 'electron-piecemaker', 'main.js'), 'utf8');
  assert.ok(overlay.indexOf('syncPlugins(') > 0);
  assert.ok(overlay.indexOf('syncPlugins(') < overlay.indexOf("await import('../electron/main.js')"));
});
