import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createWindowsUpdateAction, installWindowsUpdater } from './windowsUpdater.js';

function harness(result, response = 0) {
  const calls = [];
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => result;
  updater.quitAndInstall = (...args) => calls.push(['install', ...args]);
  const app = { getPath: () => '/Programs/PieceMaker/PieceMaker.exe' };
  const dialog = { showMessageBox: async () => { calls.push(['dialog']); return { response }; } };
  return { updater, calls, update: createWindowsUpdateAction({ app, dialog, updater }) };
}

test('installation waits for the download and explicit restart consent', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let finishDownload;
  const downloadPromise = new Promise((resolve) => { finishDownload = resolve; });
  const { update, updater, calls } = harness({ downloadPromise, updateInfo: { version: '0.0.2' } });
  const pending = update();
  await Promise.resolve();
  assert.deepEqual(calls, []);
  finishDownload();
  const result = await pending;
  assert.equal(result.success, true);
  assert.deepEqual(calls, [['dialog']]);
  context.mock.timers.tick(1000);
  assert.deepEqual(calls, [['dialog'], ['install', false, true]]);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.installDirectory, '/Programs/PieceMaker');
});

test('deferring a downloaded update does not install or quit', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { update, calls } = harness({ downloadPromise: Promise.resolve(), updateInfo: { version: '0.0.2' } }, 1);
  assert.equal((await update()).success, true);
  context.mock.timers.tick(5000);
  assert.deepEqual(calls, [['dialog']]);
});

test('a failed download never offers or starts installation', async () => {
  const { update, updater, calls } = harness(null);
  updater.checkForUpdates = async () => ({ downloadPromise: Promise.reject(new Error('Network unavailable')) });
  await assert.rejects(update(), /Network unavailable/);
  assert.deepEqual(calls, []);
});

test('concurrent update requests share a single download and prompt', async () => {
  const { update, calls } = harness({ downloadPromise: Promise.resolve(), updateInfo: { version: '0.0.2' } }, 1);
  const first = update();
  assert.equal(update(), first);
  await first;
  assert.deepEqual(calls, [['dialog']]);
});

test('an up-to-date installation does not prompt for a restart', async () => {
  const { update, calls } = harness(null);
  assert.equal((await update()).message, 'Aucune mise à jour disponible.');
  assert.deepEqual(calls, []);
});

test('macOS and development skip the Windows updater dependency', async () => {
  await installWindowsUpdater({ platform: 'darwin', app: {}, dialog: {} });
  await installWindowsUpdater({ platform: 'win32', app: { isPackaged: false }, dialog: {} });
});
