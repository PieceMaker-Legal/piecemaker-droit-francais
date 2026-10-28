import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

async function runBuild(platform, downloaded) {
  const calls = [];
  const context = createContext({
    process: { platform, execPath: '/fixture/node', env: {} },
    recordDownload: async (...args) => { calls.push({ name: 'download', args }); return downloaded; },
  });
  const noop = async () => {};
  const mocks = {
    'node:fs/promises': { default: {
      access: async () => { throw new Error('No npm CLI fixture'); },
      cp: noop,
      readFile: async () => JSON.stringify({ build: {}, dependencies: {} }),
      writeFile: noop,
    } },
    './shell.mjs': {
      capture: () => ({ code: 0 }),
      run: async (command, args) => { calls.push({ name: command, args: [...args] }); },
    },
    './plugins.mjs': { BUNDLE_DIR: 'plugins', embedBundledPlugins: noop },
    './ui-updates.mjs': { embedUiRuntimeConfig: noop },
    './ui.mjs': { ui: { step() {}, detail() {}, ok() {} } },
    './windows-update-config.mjs': { configureWindowsUpdates: noop },
    './compact-package.mjs': { pruneDesktopDependencies: async () => [], configureCompactPackage: noop },
    './components-package.mjs': { packageRuntimeComponents: noop },
    './mingit.mjs': { embedMinGit: noop },
    './node-shim.mjs': { embedNodeShim: noop },
    '../../server/piecemaker/vendor/installer/steps/10-libreoffice.mjs': { embedLibreOffice: noop },
    './prebuilt-app.mjs': { verifyBuiltApp: noop, verifyMacBundleLinks: noop },
    './paths.mjs': { IS_MAC: platform === 'darwin', PRODUCT_NAME: 'PieceMaker', caCertPath: '', caKeyPath: '', releaseRepo: 'Example/Product', releaseTag: 'fixture' },
  };
  const source = await fs.readFile(new URL('./build.mjs', import.meta.url), 'utf8');
  const entry = new SourceTextModule(`${source}
    embedLocalServer = async () => {};
    embedDesktopOverlay = async () => {};
    patchStagedManifest = async () => {};
    repairStagedTree = async () => {};
    buildAnonymizerProxy = async () => '/fixture/proxy';
    smokeTestAnonymizerProxy = async () => {};
    findBuiltApp = async () => '/fixture/built';
    downloadReleaseAsset = recordDownload;
  `, {
    context,
    initializeImportMeta(meta) { meta.url = new URL('./build.mjs', import.meta.url).href; },
  });
  await entry.link(async specifier => {
    const values = mocks[specifier] || await import(specifier);
    return new SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context });
  });
  await entry.evaluate();
  await entry.namespace.buildDesktopApp('/fixture/source');
  return calls;
}

for (const [platform, downloaded] of [['darwin', false], ['win32', true], ['win32', false]]) {
  test(`SQLite download preserves Electron native rebuilds (${platform}, downloaded=${downloaded})`, async () => {
    const calls = await runBuild(platform, downloaded);
    const downloads = calls.filter(call => call.name === 'download');
    assert.equal(downloads.length, platform === 'win32' ? 1 : 0);
    if (downloads.length) {
      assert.deepEqual([...downloads[0].args], [
        'better-sqlite3-electron-win32-x64.node',
        path.join('/fixture/source', '.desktop-build/desktop-app/node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
        'better-sqlite3 pour Electron',
      ]);
    }
    const builder = calls.find(call => call.args.some(arg => arg.replaceAll('"', '') === 'electron-builder'));
    assert.ok(builder);
    assert.equal(builder.args.some(arg => arg.includes('npmRebuild')), false);
    assert.ok(calls.some(call => call.args.map(arg => arg.replaceAll('"', '')).slice(0, 2).join(' ') === 'rebuild better-sqlite3'));
    if (downloads.length) assert.ok(calls.indexOf(downloads[0]) < calls.indexOf(builder));
  });
}
