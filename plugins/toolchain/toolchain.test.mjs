import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildPlugins, discoverPlugins, validatePlugin } from './build.mjs';
import { INSTALLED_MARKER, syncPlugins } from './sync.mjs';
import { runtimeEnvironment } from './runtime.mjs';

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
    for (const id of ['piecemaker-tabular-review']) {
      const runtime = readJson(path.join(dataRoot, 'plugins', id, 'runtime.json'));
      assert.equal(runtime.secret, config[id].secrets.access);
      assert.equal(runtime.secret.length, 64);
      assert.equal(runtime.databasePath, path.join(dataRoot, 'auth.db'));
      assert.equal(runtime.applicationRoot, appRoot);
      assert.ok(fs.existsSync(path.join(dataRoot, 'plugins', id, 'launcher.mjs')));
      assert.ok(fs.existsSync(path.join(dataRoot, 'plugins', id, 'runtime.mjs')));
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
    assert.equal(after['piecemaker-tabular-review'].secrets.access, config['piecemaker-tabular-review'].secrets.access);

    const runtimeBundle = path.join(work, 'portable');
    await buildPlugins({ appRoot, outDir: runtimeBundle, portableRuntime: true });
    const portableRuntime = readJson(path.join(runtimeBundle, 'bundle.json')).runtime;
    assert.equal(portableRuntime.nodePath, null);
    assert.equal(portableRuntime.applicationRoot, null);
    assert.equal(JSON.stringify(portableRuntime).includes(appRoot), false);

    const runtimeOverride = {
      nodePath: process.execPath,
      applicationRoot: path.join(work, 'app.asar'),
      claudePath: null,
      codexPath: null,
      codexLauncher: null,
      electronRunAsNode: true,
    };
    const portableData = path.join(work, 'portable-data');
    const failures = [];
    const synchronized = syncPlugins({ bundleDir: runtimeBundle, dataRoot: portableData, databasePath: path.join(portableData, 'auth.db'), runtime: runtimeOverride, log: { log() {}, error: (message) => failures.push(message) } });
    assert.deepEqual(synchronized.failed, [], failures.join('\n'));
    const installedRuntime = readJson(path.join(portableData, 'plugins', 'piecemaker-tabular-review', 'runtime.json'));
    assert.equal(installedRuntime.applicationRoot, runtimeOverride.applicationRoot);
    assert.equal(installedRuntime.nodePath, process.execPath);
    assert.equal(installedRuntime.electronRunAsNode, true);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('plugin launcher adds Electron run-as-Node without dropping inherited environment', () => {
  const inherited = { PATH: 'portable-runtime', CODEX_HOME: 'provider-data' };
  assert.equal(runtimeEnvironment({}, inherited), inherited);
  assert.deepEqual(runtimeEnvironment({ electronRunAsNode: true }, inherited), {
    ...inherited,
    ELECTRON_RUN_AS_NODE: '1',
  });
});

test('sync keeps developer runtime fields and rebases portable runtime fields', (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-runtime-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const bundleDir = path.join(work, 'bundle');
  const pluginDir = path.join(bundleDir, 'piecemaker-runtime-fixture');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'manifest.json'), '{}');
  fs.writeFileSync(path.join(pluginDir, 'launcher.mjs'), '');
  fs.writeFileSync(path.join(bundleDir, 'bundle.json'), JSON.stringify({
    runtime: { nodePath: 'C:\\build\\node.exe', applicationRoot: 'C:\\checkout', claudePath: 'C:\\tools\\claude.cmd' },
    plugins: { 'piecemaker-runtime-fixture': { fingerprint: 'fixture', server: true } },
  }));

  const devRoot = path.join(work, 'dev');
  syncPlugins({ bundleDir, dataRoot: devRoot, databasePath: path.join(devRoot, 'auth.db'), log: quiet });
  const devRuntime = readJson(path.join(devRoot, 'plugins', 'piecemaker-runtime-fixture', 'runtime.json'));
  assert.equal(devRuntime.nodePath, 'C:\\build\\node.exe');
  assert.equal(devRuntime.applicationRoot, 'C:\\checkout');

  const portableRoot = path.join(work, 'portable');
  syncPlugins({
    bundleDir,
    dataRoot: portableRoot,
    databasePath: path.join(portableRoot, 'auth.db'),
    runtime: { nodePath: 'C:\\portable\\PieceMaker.exe', applicationRoot: 'C:\\portable\\resources\\app.asar', claudePath: null, electronRunAsNode: true },
    log: quiet,
  });
  const portableRuntime = readJson(path.join(portableRoot, 'plugins', 'piecemaker-runtime-fixture', 'runtime.json'));
  assert.equal(portableRuntime.nodePath, 'C:\\portable\\PieceMaker.exe');
  assert.equal(portableRuntime.applicationRoot, 'C:\\portable\\resources\\app.asar');
  assert.equal(portableRuntime.claudePath, null);
  assert.equal(portableRuntime.electronRunAsNode, true);
});

test('the Electron build embeds the bundle and the overlay installs it before the app starts', () => {
  const build = fs.readFileSync(path.join(appRoot, 'desktop-bootstrap', 'lib', 'build.mjs'), 'utf8');
  assert.match(build, /await embedBundledPlugins\(sourceDir, stageDir\)/);
  const overlay = fs.readFileSync(path.join(appRoot, 'desktop-bootstrap', 'overlay', 'electron-piecemaker', 'main.js'), 'utf8');
  assert.ok(overlay.indexOf('syncPlugins(') > 0);
  assert.ok(overlay.indexOf('syncPlugins(') < overlay.indexOf("await import('../electron/main.js')"));
});
