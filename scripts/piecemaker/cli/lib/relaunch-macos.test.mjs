import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCapture, waitUntil } from './exec.mjs';
import { installMacRelaunchHandler } from './relaunch-macos.mjs';

test('macOS relay compiles, is signed and accepts only the fixed relaunch URL', { skip: process.platform !== 'darwin' }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-relaunch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const marker = path.join(directory, 'launched');
  const command = path.join(directory, "example's launcher.sh");
  fs.writeFileSync(command, `#!/bin/sh\nprintf '%s' "$1" > '${marker}'\n`, { mode: 0o755 });
  const bundle = installMacRelaunchHandler(command, directory);
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  const types = runCapture('/usr/bin/plutil', ['-extract', 'CFBundleURLTypes', 'json', '-o', '-', plist]);
  assert.equal(types.code, 0, types.stderr);
  assert.deepEqual(JSON.parse(types.stdout)[0].CFBundleURLSchemes, ['piecemaker-relaunch']);
  const signature = runCapture('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
  assert.equal(signature.code, 0, signature.stderr);
  const compiledScript = path.join(bundle, 'Contents', 'Resources', 'Scripts', 'main.scpt');
  const sendURL = (url) => runCapture('/usr/bin/osascript', [
    '-e', `set relay to load script POSIX file ${JSON.stringify(compiledScript)}`,
    '-e', `tell relay to open location ${JSON.stringify(url)}`,
  ]);
  const ignored = sendURL('piecemaker-relaunch://start?command=example');
  assert.equal(ignored.code, 0, ignored.stderr);
  assert.equal(fs.existsSync(marker), false);
  const accepted = sendURL('piecemaker-relaunch://start');
  assert.equal(accepted.code, 0, accepted.stderr);
  assert.ok(await waitUntil(() => fs.existsSync(marker), { timeoutMs: 2000, intervalMs: 25 }));
  assert.equal(fs.readFileSync(marker, 'utf8'), '--launch-only');
  const modified = fs.statSync(compiledScript).mtimeMs;
  assert.equal(installMacRelaunchHandler(command, directory), bundle);
  assert.equal(fs.statSync(compiledScript).mtimeMs, modified);
});
