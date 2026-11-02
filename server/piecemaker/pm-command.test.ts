import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { installPmCommand } from './pm-command.js';

const applicationRoot = findApplicationRoot(getModuleDirectory(import.meta.url));

function temporaryFolder() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-pm-command-')));
}

test('installe pm dans le PATH des sessions et du shell, sans doublon', () => {
  const home = temporaryFolder();
  const userHome = temporaryFolder();
  fs.writeFileSync(path.join(userHome, '.zshrc'), 'export A=1\n');
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin' };

  const binDir = installPmCommand({ applicationRoot, piecemakerHome: home, env, platform: 'darwin', userHome });
  installPmCommand({ applicationRoot, piecemakerHome: home, env, platform: 'darwin', userHome });

  assert.equal(env.PATH, `${binDir}:/usr/bin:/bin`);
  assert.equal(fs.readFileSync(path.join(userHome, '.zshrc'), 'utf8').split(binDir).length, 2);
  assert.equal(fs.existsSync(path.join(userHome, '.profile')), false);
  const help = execFileSync('pm', ['--help'], { cwd: userHome, env: { ...process.env, PATH: env.PATH }, encoding: 'utf8' });
  assert.match(help, /Usage: pm <outil>/);
});

test('crée .zshrc sur macOS quand aucun fichier de shell n’existe', () => {
  const userHome = temporaryFolder();
  const binDir = installPmCommand({ applicationRoot, piecemakerHome: temporaryFolder(), env: {}, platform: 'darwin', userHome });
  assert.match(fs.readFileSync(path.join(userHome, '.zshrc'), 'utf8'), new RegExp(`export PATH="${binDir}:\\$PATH"`));
});

test('sous Windows, écrit pm.cmd et pm, et inscrit le dossier dans le PATH utilisateur', () => {
  const home = temporaryFolder();
  const persisted: string[] = [];
  const env: NodeJS.ProcessEnv = { Path: 'C:\\Windows' };

  const binDir = installPmCommand({
    applicationRoot,
    piecemakerHome: home,
    env,
    platform: 'win32',
    execPath: 'C:\\Program Files\\PieceMaker\\PieceMaker.exe',
    persistWindowsPath: (dir) => persisted.push(dir),
  });

  assert.equal(env.Path, `${binDir};C:\\Windows`);
  assert.deepEqual(persisted, [binDir]);
  const cmd = fs.readFileSync(path.join(binDir, 'pm.cmd'), 'utf8');
  assert.match(cmd, /set ELECTRON_RUN_AS_NODE=1\r\n"C:\\Program Files\\PieceMaker\\PieceMaker.exe" ".*pm\.mjs" %\*/);
  assert.match(fs.readFileSync(path.join(binDir, 'pm'), 'utf8'), /^#!\/bin\/sh\n/);
});
