import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const source = await fs.readFile(new URL('../../electron/piecemakerUninstall.js', import.meta.url), 'utf8');

async function load({ names = ['Uninstall PieceMaker.exe'], failure = false, platform = 'win32' } = {}) {
  const calls = [];
  let handler;
  const context = createContext({ process: { platform, env: {}, pid: 123 }, setImmediate });
  const macOnly = (value) => {
    if (platform !== 'darwin') throw new Error('Mac removal must not run');
    return value;
  };
  const mocks = {
    'node:child_process': { spawn(command, args) {
      calls.push([command, args]);
      const child = new EventEmitter();
      child.unref = () => {};
      setImmediate(() => child.emit(failure ? 'error' : 'spawn', ...(failure ? [new Error('EPERM')] : [])));
      return child;
    } },
    'node:fs': { default: {
      readdirSync: () => names,
      readFileSync(file) { calls.push(['read', file]); return macOnly('{}'); },
      writeFileSync(file, script) { calls.push(['write', file, script]); macOnly(); },
    } },
    'node:os': { default: { homedir: () => macOnly('/Users/me'), tmpdir: () => macOnly('/tmp') } },
    'node:path': { default: platform === 'win32' ? path.win32 : path.posix },
    '../shared/product-config.mjs': { loadProductConfig: () => macOnly({ dataDirectoryName: '.piecemaker-droit-francais' }) },
    './uninstallPlan.js': {
      macUninstallScript: () => macOnly('mac removal script'),
      packagedApplicationRoot: () => macOnly('/Applications/PieceMaker.app'),
      removalPlan: () => macOnly({}),
    },
  };
  const entry = new SourceTextModule(source, { context });
  await entry.link(specifier => {
    const values = mocks[specifier];
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await entry.evaluate();
  entry.namespace.registerPiecemakerUninstall({ ipcMain: { handle(_name, value) { handler = value; } }, app: { isPackaged: true, getAppPath: () => macOnly('/Applications/PieceMaker.app/Contents/Resources/app'), getPath: () => 'C:\\Apps\\PieceMaker\\PieceMaker.exe', quit: () => calls.push('quit') } });
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

test('macOS schedules its helper without reading shared model configuration', async () => {
  const runtime = await load({ platform: 'darwin' });
  assert.equal((await runtime.uninstall()).scheduled, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(runtime.calls.filter(call => call[0] === 'read'), [['read', '/Users/me/.piecemaker/config.json']]);
  assert.deepEqual(runtime.calls.find(call => call[0] === 'write'), ['write', '/tmp/piecemaker-uninstall-123.sh', 'mac removal script']);
  const shell = runtime.calls.find(call => call[0] === '/bin/sh');
  assert.deepEqual(Array.from(shell[1]), ['/tmp/piecemaker-uninstall-123.sh', '123']);
  assert.ok(runtime.calls.includes('quit'));
});
