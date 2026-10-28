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

async function fakeApplication(t, executableName) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-node-shim-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stageDir = path.join(root, 'resources');
  await fs.mkdir(stageDir);
  await fs.writeFile(path.join(stageDir, 'package.json'), JSON.stringify({ build: { executableName, files: ['server/**'], extraResources: [{ from: 'mingit', to: 'mingit' }] } }));
  return { root, stageDir, app: path.join(root, `${executableName || 'PieceMaker'}.exe`), shim: path.join(stageDir, NODE_SHIM_DIR, 'node.exe') };
}

function processIsRunning(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

test('ships node.exe as an extra resource next to the app', windows, async (t) => {
  const { stageDir, shim } = await fakeApplication(t);
  await embedNodeShim(stageDir);
  await embedNodeShim(stageDir);
  const manifest = JSON.parse(await fs.readFile(path.join(stageDir, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.build.extraResources, [{ from: 'mingit', to: 'mingit' }, { from: NODE_SHIM_DIR, to: NODE_SHIM_DIR }]);
  assert.deepEqual(await fs.readdir(path.dirname(shim)), ['application.txt', 'node.exe']);
  assert.equal(await fs.readFile(path.join(path.dirname(shim), 'application.txt'), 'utf8'), 'PieceMaker.exe');
});

test('node uses the final validation executable name and does not require PieceMaker.exe', windows, async (t) => {
  const { stageDir, shim } = await fakeApplication(t);
  await embedNodeShim(stageDir);
  const manifestFile = path.join(stageDir, 'package.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  manifest.build.executableName = 'PieceMakerValidation';
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  await fs.copyFile(path.join(process.env.SystemRoot, 'System32', 'cmd.exe'), path.join(path.dirname(stageDir), 'PieceMakerValidation.exe'));
  await embedNodeShim(stageDir);
  const result = spawnSync(shim, ['/d', '/c', 'echo %ELECTRON_RUN_AS_NODE% "two words"& exit 7'], { encoding: 'utf8', windowsVerbatimArguments: true });
  assert.equal(result.stdout.trim(), '1 "two words"');
  assert.equal(result.status, 7);
  assert.equal(await fs.readFile(path.join(path.dirname(shim), 'application.txt'), 'utf8'), 'PieceMakerValidation.exe');
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
  const fixture = path.join(path.dirname(stageDir), 'fixture.cs');
  const pidFile = path.join(path.dirname(stageDir), 'child.pid');
  await fs.writeFile(fixture, 'class Fixture { static void Main(string[] args) { System.IO.File.WriteAllText(args[0], System.Diagnostics.Process.GetCurrentProcess().Id.ToString()); System.Threading.Thread.Sleep(30000); } }');
  const compiler = path.join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  execFileSync(compiler, ['/nologo', '/target:exe', `/out:${app}`, fixture]);
  await embedNodeShim(stageDir);

  const child = spawn(shim, [pidFile], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  let appPid;
  t.after(() => {
    child.kill();
    if (appPid && processIsRunning(appPid)) process.kill(appPid);
  });
  const startupDeadline = Date.now() + 10000;
  while (Date.now() < startupDeadline) {
    try { appPid = Number(await fs.readFile(pidFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (Number.isInteger(appPid) && appPid > 0) break;
    if (child.exitCode !== null) throw new Error(`Le lanceur a quitté avant son enfant : ${stderr}`);
    await setTimeout(50);
  }
  assert.ok(Number.isInteger(appPid) && appPid > 0, `Le processus enfant n'a pas annoncé son PID : ${stderr}`);
  assert.equal(processIsRunning(appPid), true);

  const exited = once(child, 'exit');
  child.kill();
  await exited;
  const shutdownDeadline = Date.now() + 5000;
  while (processIsRunning(appPid) && Date.now() < shutdownDeadline) await setTimeout(50);
  assert.equal(processIsRunning(appPid), false);
});
