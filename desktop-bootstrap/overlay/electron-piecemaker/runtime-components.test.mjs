import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureRuntimeComponents } from './runtime-components.mjs';

const emptyManifest = { repository: 'example/runtime', releaseTag: 'v1', components: [] };

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-runtime-download-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function download(root, pid, suffix, marker = { format: 1, owner: 'piecemaker-runtime-download', pid }) {
  const directory = path.join(root, `.runtime-download-${pid}-${suffix}`);
  fs.mkdirSync(directory);
  if (marker) fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify(marker));
  fs.writeFileSync(path.join(directory, 'component.partial'), 'unfinished archive');
  fs.mkdirSync(path.join(directory, 'extracting'));
  return directory;
}

test('reclaims a download left by a terminated installer process', { timeout: 10000 }, async (t) => {
  const root = scratch(t);
  const component = { id: 'a'.repeat(64), sha256: 'b'.repeat(64), assetName: `piecemaker-runtime-components-win32-x64-${'a'.repeat(64)}.tar.gz`, packageNames: ['@openai/codex-sdk'] };
  const script = `import { ensureRuntimeComponents } from ${JSON.stringify(new URL('./runtime-components.mjs', import.meta.url).href)};
import fs from 'node:fs';
import path from 'node:path';
const root = ${JSON.stringify(root)};
const ready = setInterval(() => {
  const [directory] = fs.readdirSync(root);
  if (!directory) return;
  const partial = path.join(root, directory, 'component.partial');
  if (!fs.existsSync(partial) || fs.statSync(partial).size === 0) return;
  clearInterval(ready);
  process.stdout.write('downloading');
}, 10);
await ensureRuntimeComponents({ manifest: ${JSON.stringify({ ...emptyManifest, components: [component] })}, cacheRoot: root, fetchImpl: () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('unfinished archive')); setInterval(() => {}, 1000); } })) });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  });
  const [message] = await once(child.stdout, 'data');
  assert.equal(message.toString(), 'downloading');
  const directories = fs.readdirSync(root);
  assert.equal(directories.length, 1);
  assert.equal(fs.readFileSync(path.join(root, directories[0], 'component.partial'), 'utf8'), 'unfinished archive');
  await ensureRuntimeComponents({ manifest: emptyManifest, cacheRoot: root });
  assert.deepEqual(fs.readdirSync(root), directories);
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
  const messages = [];
  await ensureRuntimeComponents({ manifest: emptyManifest, cacheRoot: root, log: (message) => messages.push(message) });
  assert.deepEqual(fs.readdirSync(root), []);
  assert.match(messages[0], /Removed abandoned runtime component download/);
});

test('retains live or uninspectable owners, unknown directories, versions and recovery copies', async (t) => {
  const root = scratch(t);
  const deniedPid = 2147483000;
  const absentPid = deniedPid - 1;
  const active = download(root, process.pid, 'active');
  const denied = download(root, deniedPid, 'denied');
  const unknown = download(root, absentPid, 'unknow', null);
  const foreign = download(root, absentPid, 'foreig', { format: 1, owner: 'someone-else', pid: absentPid });
  const mismatched = download(root, absentPid, 'badpid', { format: 1, owner: 'piecemaker-runtime-download', pid: process.pid });
  const malformed = download(root, absentPid, 'broken');
  fs.writeFileSync(path.join(malformed, 'owner.json'), 'invalid json');
  const recovery = download(root, absentPid, 'backup');
  fs.mkdirSync(path.join(recovery, 'component.previous'));
  const symlinkTarget = path.join(root, 'personal-environment');
  fs.mkdirSync(symlinkTarget);
  fs.writeFileSync(path.join(symlinkTarget, 'keep'), 'personal data');
  const symlink = path.join(root, `.runtime-download-${absentPid}-symlin`);
  fs.symlinkSync(symlinkTarget, symlink, 'junction');
  const oldTemporary = path.join(root, `.${'a'.repeat(64)}.123-abcdef.extracting`);
  const previous = path.join(root, `.${'a'.repeat(64)}.123-abcdef.previous`);
  const versions = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)].map((name) => path.join(root, name));
  for (const directory of [oldTemporary, previous, ...versions]) fs.mkdirSync(directory);
  const originalKill = process.kill;
  t.mock.method(process, 'kill', (pid, signal) => {
    if (pid === deniedPid) throw Object.assign(new Error('inspection denied'), { code: 'EPERM' });
    if (pid === absentPid) throw Object.assign(new Error('absent'), { code: 'ESRCH' });
    return originalKill(pid, signal);
  });
  await ensureRuntimeComponents({ manifest: emptyManifest, cacheRoot: root });
  for (const directory of [active, denied, unknown, foreign, mismatched, malformed, recovery, symlink, symlinkTarget, oldTemporary, previous, ...versions]) assert.equal(fs.existsSync(directory), true, directory);
  assert.equal(fs.readFileSync(path.join(symlinkTarget, 'keep'), 'utf8'), 'personal data');
});

test('reports cleanup failures and leaves the abandoned transaction available for retry', async (t) => {
  const root = scratch(t);
  const pid = 2147482998;
  const directory = download(root, pid, 'locked');
  const messages = [];
  t.mock.method(process, 'kill', () => { throw Object.assign(new Error('absent'), { code: 'ESRCH' }); });
  const originalRemove = fs.rmSync;
  t.mock.method(fs, 'rmSync', (target, options) => {
    if (target === directory) throw Object.assign(new Error('access denied'), { code: 'EPERM' });
    return originalRemove(target, options);
  });
  await ensureRuntimeComponents({ manifest: emptyManifest, cacheRoot: root, log: (message) => messages.push(message) });
  assert.equal(fs.existsSync(directory), true);
  assert.match(messages[0], /cleanup skipped: .*access denied/);
});
