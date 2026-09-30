import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { bundledPlugins } from './plugins.mjs';
import { INSTALLED_MARKER, syncBundledPlugins } from '../overlay/electron-piecemaker/bundled-plugins.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const quiet = { log() {}, error() {} };

function fakeBundle() {
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-bundle-'));
  for (const id of ['piecemaker-a', 'piecemaker-b']) {
    fs.mkdirSync(path.join(bundleDir, id));
    fs.writeFileSync(path.join(bundleDir, id, 'manifest.json'), JSON.stringify({ name: id, displayName: id, entry: 'index.js' }));
  }
  fs.writeFileSync(path.join(bundleDir, 'piecemaker-b', 'runtime.json'), JSON.stringify({ secret: null, databasePath: '/build/auth.db' }));
  fs.writeFileSync(path.join(bundleDir, 'bundle.json'), JSON.stringify({ plugins: {
    'piecemaker-a': { fingerprint: 'a1', config: { enabled: true } },
    'piecemaker-b': { fingerprint: 'b1', config: { enabled: true } },
  } }));
  return bundleDir;
}

test('every plugins/piecemaker-* source is embedded in the desktop app', async () => {
  const sources = fs.readdirSync(path.join(root, 'plugins'))
    .filter((name) => name.startsWith('piecemaker-') && fs.existsSync(path.join(root, 'plugins', name, 'install.mjs')))
    .sort();
  assert.deepEqual((await bundledPlugins(root)).map((plugin) => plugin.name), sources);
  assert.ok(sources.includes('piecemaker-tabular-review'));
});

test('the app restores missing plugins at every start and keeps user choices', () => {
  const bundleDir = fakeBundle();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-data-'));
  const options = { bundleDir, dataRoot, databasePath: path.join(dataRoot, 'auth.db'), log: quiet };

  assert.deepEqual(syncBundledPlugins(options).installed, ['piecemaker-a', 'piecemaker-b']);
  assert.deepEqual(syncBundledPlugins(options).installed, []);

  const configPath = path.join(dataRoot, 'plugins.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const secret = config['piecemaker-b'].secrets.access;
  assert.equal(secret.length, 64);
  const runtime = JSON.parse(fs.readFileSync(path.join(dataRoot, 'plugins', 'piecemaker-b', 'runtime.json'), 'utf8'));
  assert.deepEqual(runtime, { secret, databasePath: path.join(dataRoot, 'auth.db') });

  config['piecemaker-a'].enabled = false;
  fs.writeFileSync(configPath, JSON.stringify(config));
  fs.rmSync(path.join(dataRoot, 'plugins', 'piecemaker-b'), { recursive: true });

  assert.deepEqual(syncBundledPlugins(options).installed, ['piecemaker-b']);
  const after = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(after['piecemaker-a'].enabled, false);
  assert.equal(after['piecemaker-b'].secrets.access, secret);
  assert.equal(fs.readFileSync(path.join(dataRoot, 'plugins', 'piecemaker-b', INSTALLED_MARKER), 'utf8').trim(), 'b1');
  assert.deepEqual(fs.readdirSync(path.join(dataRoot, 'plugins')).filter((name) => name.startsWith('.tmp-')), []);
});

test('the desktop build embeds the plugins and the overlay syncs them before the app starts', () => {
  const build = fs.readFileSync(path.join(root, 'desktop-bootstrap', 'lib', 'build.mjs'), 'utf8');
  assert.match(build, /await embedBundledPlugins\(sourceDir, stageDir\)/);
  const overlay = fs.readFileSync(path.join(root, 'desktop-bootstrap', 'overlay', 'electron-piecemaker', 'main.js'), 'utf8');
  assert.ok(overlay.indexOf('syncBundledPlugins(') < overlay.indexOf("await import('../electron/main.js')"));
});
