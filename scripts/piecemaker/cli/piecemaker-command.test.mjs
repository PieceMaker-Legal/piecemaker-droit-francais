import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { BIN_DIR } from './lib/config.mjs';
import { piecemakerExecutable } from './install-command.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('the curl bootstrap installs the piecemaker command before launching', () => {
  const posix = fs.readFileSync(path.join(here, 'piecemaker.sh'), 'utf8');
  const windows = fs.readFileSync(path.join(here, 'piecemaker.ps1'), 'utf8');
  assert.match(posix, /install-command\.mjs/);
  assert.match(windows, /install-command\.mjs/);
});

test('the desktop launcher binds to the installed piecemaker binary', () => {
  const executable = piecemakerExecutable();
  assert.equal(path.basename(executable).startsWith('piecemaker'), true);
  if (executable !== 'piecemaker') {
    assert.equal(executable.startsWith(BIN_DIR) || executable.includes(`${path.sep}node${path.sep}` ) || executable.includes('versions/node'), true);
  }
});

test('plugins are installed through the shared toolchain, before the application starts', () => {
  const plugins = fs.readFileSync(path.join(here, 'lib', 'plugins.mjs'), 'utf8');
  assert.match(plugins, /'plugins', 'toolchain', 'index\.mjs'/);
  const main = fs.readFileSync(path.join(here, 'piecemaker.mjs'), 'utf8');
  assert.ok(main.indexOf('await installPlugins(') < main.indexOf('await resetAndLaunch('));
});
