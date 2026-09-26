import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { installTelegramTab } from '../install.js';

test('installs the Telegram tab into the application plugin registry', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-telegram-install-'));
  const previousRoot = process.env.CLOUDCLI_HOME;
  const previousDatabase = process.env.DATABASE_PATH;
  process.env.CLOUDCLI_HOME = directory;
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  try {
    installTelegramTab(process.cwd());
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'plugins/piecemaker-telegram/manifest.json'), 'utf8'));
    const config = JSON.parse(fs.readFileSync(path.join(directory, 'plugins.json'), 'utf8'));
    const runtime = JSON.parse(fs.readFileSync(path.join(directory, 'plugins/piecemaker-telegram/runtime.json'), 'utf8'));
    assert.equal(manifest.name, 'piecemaker-telegram');
    assert.equal(runtime.databasePath, path.join(directory, 'auth.db'));
    assert.equal(runtime.secret, config['piecemaker-telegram'].secrets.access);
    installTelegramTab(process.cwd());
    const secondConfig = JSON.parse(fs.readFileSync(path.join(directory, 'plugins.json'), 'utf8'));
    assert.equal(secondConfig['piecemaker-telegram'].secrets.access, runtime.secret);
  } finally {
    if (previousRoot === undefined) delete process.env.CLOUDCLI_HOME; else process.env.CLOUDCLI_HOME = previousRoot;
    if (previousDatabase === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previousDatabase;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
