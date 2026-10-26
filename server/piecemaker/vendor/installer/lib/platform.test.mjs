import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { venvPaths } from './platform.mjs';

test('the portable Windows Python counts as the environment interpreter', { skip: process.platform !== 'win32' }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-portable-python-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'python.exe'), '');
  const paths = venvPaths(root);
  assert.equal(paths.python, path.join(root, 'python.exe'));
  assert.equal(paths.binDir, path.join(root, 'Scripts'));
  assert.equal(paths.exists, true);
});

test('a virtualenv keeps its interpreter under Scripts or bin', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-venv-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binDir = path.join(root, process.platform === 'win32' ? 'Scripts' : 'bin');
  fs.mkdirSync(binDir);
  fs.writeFileSync(path.join(binDir, process.platform === 'win32' ? 'python.exe' : 'python'), '');
  const paths = venvPaths(root);
  assert.equal(paths.python, path.join(binDir, process.platform === 'win32' ? 'python.exe' : 'python'));
  assert.equal(paths.exists, true);
});
