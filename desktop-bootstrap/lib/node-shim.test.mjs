import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { NODE_SHIM_DIR, embedNodeShim } from './node-shim.mjs';

const windows = { skip: process.platform !== 'win32' };

async function fakeApplication(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-node-shim-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stageDir = path.join(root, 'resources');
  await fs.mkdir(stageDir);
  await fs.writeFile(path.join(stageDir, 'package.json'), JSON.stringify({ build: { files: ['server/**'], extraResources: [{ from: 'mingit', to: 'mingit' }] } }));
  return { root, stageDir, app: path.join(root, 'PieceMaker.exe'), shim: path.join(stageDir, NODE_SHIM_DIR, 'node.exe') };
}

function runningCopies(executable) {
  const script = `@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${executable}' }).Count`;
  return Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim());
}

test('ships node.exe as an extra resource next to the app', windows, async (t) => {
  const { stageDir, shim } = await fakeApplication(t);
  await embedNodeShim(stageDir);
  await embedNodeShim(stageDir);
  const manifest = JSON.parse(await fs.readFile(path.join(stageDir, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.build.extraResources, [{ from: 'mingit', to: 'mingit' }, { from: NODE_SHIM_DIR, to: NODE_SHIM_DIR }]);
  assert.deepEqual(await fs.readdir(path.dirname(shim)), ['node.exe']);
});

test('node runs the app two levels up as Node with the arguments untouched and returns its exit code', windows, async (t) => {
  const { stageDir, app, shim } = await fakeApplication(t);
  await fs.copyFile(path.join(process.env.SystemRoot, 'System32', 'cmd.exe'), app);
  await embedNodeShim(stageDir);
  const result = spawnSync(shim, ['/d', '/c', 'echo %ELECTRON_RUN_AS_NODE% "two words"& exit 7'], { encoding: 'utf8', windowsVerbatimArguments: true });
  assert.equal(result.stdout.trim(), '1 "two words"');
  assert.equal(result.status, 7);
});

test('killing node stops the app process it started', windows, async (t) => {
  const { stageDir, app, shim } = await fakeApplication(t);
  await fs.copyFile(path.join(process.env.SystemRoot, 'System32', 'PING.EXE'), app);
  await embedNodeShim(stageDir);

  const child = spawn(shim, ['-n', '30', '127.0.0.1'], { stdio: 'ignore' });
  t.after(() => execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-Process | Where-Object { $_.Path -eq '${app}' } | Stop-Process -Force`]));
  await setTimeout(1500);
  assert.equal(runningCopies(app), 1);

  child.kill();
  await once(child, 'exit');
  await setTimeout(500);
  assert.equal(runningCopies(app), 0);
});
