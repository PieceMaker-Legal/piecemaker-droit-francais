import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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

test('installe pm dans le PATH des sessions du serveur, sans doublon', () => {
  const userHome = temporaryFolder();
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin' };

  const binDir = installPmCommand({ applicationRoot, piecemakerHome: temporaryFolder(), env, platform: 'darwin', userHome });
  installPmCommand({ applicationRoot, piecemakerHome: path.dirname(binDir), env, platform: 'darwin', userHome });

  assert.equal(env.PATH, `${binDir}:/usr/bin:/bin`);
  for (const name of ['.zshenv', '.zshrc', '.bashrc']) {
    assert.equal(fs.readFileSync(path.join(userHome, name), 'utf8').split(binDir).length, 2);
  }
  assert.equal(fs.existsSync(path.join(userHome, '.profile')), false);
  const help = execFileSync('pm', ['--help'], { cwd: userHome, env: { ...process.env, PATH: env.PATH }, encoding: 'utf8' });
  assert.match(help, /Usage: pm <outil>/);
  const proxied = { ...process.env, PATH: env.PATH, NO_COLOR: '1', FORCE_COLOR: '1', NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: 'http://127.0.0.1:9' };
  assert.equal(spawnSync('pm', ['--help'], { cwd: userHome, env: proxied, encoding: 'utf8' }).stderr, '');
});

test('un shell lancé hors PieceMaker trouve pm, interactif ou non', () => {
  const userHome = temporaryFolder();
  installPmCommand({ applicationRoot, piecemakerHome: temporaryFolder(), env: {}, platform: 'darwin', userHome });
  const env = { HOME: userHome, ZDOTDIR: userHome, PATH: '/usr/bin:/bin' };
  for (const [shell, args] of [['/bin/zsh', ['-c']], ['/bin/zsh', ['-lic']], ['/bin/bash', ['-ic']]] as const) {
    const help = execFileSync(shell, [...args, 'pm --help'], { cwd: userHome, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.match(help, /Usage: pm <outil>/, `${shell} ${args.join(' ')}`);
  }
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
