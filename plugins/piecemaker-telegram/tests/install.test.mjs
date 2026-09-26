import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('installs the Telegram tab into the application plugin registry', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-telegram-install-'));
  const install = () => spawnSync(process.execPath, [path.resolve('plugins/piecemaker-telegram/install.mjs'), process.cwd()], {
    env: { ...process.env, CLOUDCLI_HOME: directory, DATABASE_PATH: path.join(directory, 'auth.db') },
    encoding: 'utf8',
  });
  try {
    const first = install();
    assert.equal(first.status, 0, first.stderr);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'plugins/piecemaker-telegram/manifest.json'), 'utf8'));
    const config = JSON.parse(fs.readFileSync(path.join(directory, 'plugins.json'), 'utf8'));
    const runtime = JSON.parse(fs.readFileSync(path.join(directory, 'plugins/piecemaker-telegram/runtime.json'), 'utf8'));
    assert.equal(manifest.name, 'piecemaker-telegram');
    assert.equal(runtime.databasePath, path.join(directory, 'auth.db'));
    assert.equal(runtime.secret, config['piecemaker-telegram'].secrets.access);
    const second = install();
    assert.equal(second.status, 0, second.stderr);
    const secondConfig = JSON.parse(fs.readFileSync(path.join(directory, 'plugins.json'), 'utf8'));
    assert.equal(secondConfig['piecemaker-telegram'].secrets.access, runtime.secret);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
