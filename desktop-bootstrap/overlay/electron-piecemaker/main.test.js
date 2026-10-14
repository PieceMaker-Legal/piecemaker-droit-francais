import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const entryUrl = new URL('./main.js', import.meta.url);
const source = await fs.readFile(entryUrl, 'utf8');

async function loadEntry(startupError) {
  const calls = [];
  let ready;
  const readyPromise = new Promise(resolve => { ready = resolve; });
  const app = new EventEmitter();
  app.whenReady = () => { calls.push('waiting-ready'); return readyPromise; };
  app.quit = () => calls.push('quit');
  const context = createContext({
    process: { platform: 'win32', env: {}, argv: [] },
    console: { error: (...args) => calls.push(['error', ...args]) },
    setTimeout,
  });
  const mocks = {
    electron: { app, autoUpdater: new EventEmitter(), BrowserWindow: { getAllWindows: () => [] }, dialog: {} },
    'node:child_process': { execFile: () => {} },
    'node:os': { default: os },
    'node:path': { default: path },
    'node:url': { fileURLToPath, pathToFileURL },
    '../shared/product-config.mjs': { loadProductConfig: () => ({ dataDirectoryName: '.example-app' }) },
    '../electron/uninstallPlan.js': { UNINSTALL_ARGUMENT: '--uninstall' },
    '../electron/desktopWindow.js': { DesktopWindowManager: class {} },
    '../electron/localServer.js': { LocalServerController: class {} },
    './windowsTitleBar.js': { installWindowsTitleBar: () => {} },
    './compact-runtime.mjs': {
      initializeCompactRuntime: async ({ applicationRoot }) => ({ applicationRoot, moduleRoots: [] }),
      portablePluginRuntime: () => ({}),
    },
    './windowsUpdater.js': { installWindowsUpdater: async () => {
      calls.push('updater');
      if (startupError) throw startupError;
    } },
  };
  function mockModule(exports) {
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  }
  const entry = new SourceTextModule(source, {
    context,
    identifier: entryUrl.href,
    importModuleDynamically: async specifier => {
      let exports;
      if (specifier.endsWith('/sync.mjs')) exports = { syncPlugins: () => calls.push('plugins') };
      else if (specifier === '../electron/main.js') {
        calls.push('desktop');
        exports = {};
      } else throw new Error(`Unexpected import: ${specifier}`);
      const module = mockModule(exports);
      await module.link(() => {});
      await module.evaluate();
      return module;
    },
    initializeImportMeta: meta => { meta.url = entryUrl.href; },
  });
  await entry.link(specifier => {
    assert.ok(mocks[specifier], `Unexpected import: ${specifier}`);
    return mockModule(mocks[specifier]);
  });
  let timer;
  try {
    await Promise.race([
      entry.evaluate(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Entry blocked before Electron ready')), 1000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.deepEqual(calls, ['waiting-ready']);
  ready();
  await new Promise(resolve => setTimeout(resolve, 20));
  return calls;
}

test('Windows entry finishes loading before ready, then starts updater, plugins and desktop', async () => {
  assert.deepEqual(await loadEntry(), ['waiting-ready', 'updater', 'plugins', 'desktop']);
});

test('startup failure is reported and quits the app without an unhandled rejection', async () => {
  const error = new Error('Updater initialization failed');
  assert.deepEqual(await loadEntry(error), [
    'waiting-ready', 'updater', ['error', '[PieceMaker] Startup failed:', error], 'quit',
  ]);
});
