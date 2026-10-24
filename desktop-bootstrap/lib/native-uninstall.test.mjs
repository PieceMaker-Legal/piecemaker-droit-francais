import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const source = await fs.readFile(new URL('../../electron/piecemakerUninstall.js', import.meta.url), 'utf8');

async function load({ names = ['Uninstall PieceMaker.exe'], failure = false } = {}) {
  const calls = [];
  let handler;
  const context = createContext({ process: { platform: 'win32' }, setImmediate });
  const mocks = {
    'node:child_process': { spawn(command, args) {
      calls.push([command, args]);
      const child = new EventEmitter();
      child.unref = () => {};
      setImmediate(() => child.emit(failure ? 'error' : 'spawn', ...(failure ? [new Error('EPERM')] : [])));
      return child;
    } },
    'node:fs': { default: { readdirSync: () => names } },
    'node:os': { default: {} },
    'node:path': { default: path.win32 },
    '../shared/product-config.mjs': { loadProductConfig: () => ({}) },
    './uninstallPlan.js': { macUninstallScript() {}, packagedApplicationRoot() { throw new Error('Legacy removal must not run'); }, removalPlan() {} },
  };
  const entry = new SourceTextModule(source, { context });
  await entry.link(specifier => {
    const values = mocks[specifier];
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await entry.evaluate();
  entry.namespace.registerPiecemakerUninstall({ ipcMain: { handle(_name, value) { handler = value; } }, app: { isPackaged: true, getPath: () => 'C:\\Apps\\PieceMaker\\PieceMaker.exe', quit: () => calls.push('quit') } });
  return { calls, uninstall: () => handler() };
}

test('Windows delegates removal and registration to NSIS', async () => {
  const runtime = await load();
  assert.equal((await runtime.uninstall()).scheduled, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.calls[0][0], 'C:\\Apps\\PieceMaker\\Uninstall PieceMaker.exe');
  assert.deepEqual(Array.from(runtime.calls[0][1]), []);
  assert.ok(runtime.calls.includes('quit'));
});

test('a missing or failed NSIS uninstaller keeps the application open', async () => {
  const missing = await load({ names: [] });
  await assert.rejects(missing.uninstall(), /NSIS introuvable/);
  const failed = await load({ failure: true });
  await assert.rejects(failed.uninstall(), /EPERM/);
  assert.ok(!failed.calls.includes('quit'));
});
