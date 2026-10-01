import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import Database from 'better-sqlite3';

test('Telegram plugin exposes registered projects without leaking bot tokens', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-telegram-'));
  const databasePath = path.join(directory, 'auth.db');
  const database = new Database(databasePath);
  database.exec(`CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT, custom_project_name TEXT, isArchived INTEGER);
    INSERT INTO projects VALUES ('case-1', '/tmp/case-1', 'Dossier test', 0);
    CREATE TABLE piecemaker_telegram_bots (id TEXT PRIMARY KEY, project_id TEXT UNIQUE, token TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL, owner_id TEXT NOT NULL, desired INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    INSERT INTO piecemaker_telegram_bots VALUES ('case-1', 'case-1', 'private-token', 'case_bot', '123456', 0, '2026-09-26');`);
  database.close();
  const source = path.resolve('plugins/piecemaker-telegram/src/server.mjs');
  fs.mkdirSync(path.join(directory, 'dist'));
  fs.copyFileSync(source, path.join(directory, 'dist', 'server.mjs'));
  fs.writeFileSync(path.join(directory, 'runtime.json'), JSON.stringify({
    databasePath, applicationRoot: process.cwd(), secret: 'test-secret',
  }));
  const child = spawn(process.execPath, [path.join(directory, 'dist', 'server.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Plugin server did not start: ${stderr}`)), 10000);
      child.once('error', reject);
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Plugin server exited: ${code}: ${stderr}`)); });
      child.stdout.on('data', (chunk) => {
        try {
          const ready = JSON.parse(String(chunk).trim());
          if (ready.ready) { clearTimeout(timeout); resolve(ready.port); }
        } catch {}
      });
    });
    const unauthenticated = await fetch(`http://127.0.0.1:${port}/state`);
    assert.equal(unauthenticated.status, 403);
    const response = await fetch(`http://127.0.0.1:${port}/state`, {
      headers: { 'x-plugin-secret-access': 'test-secret' },
    });
    assert.equal(response.status, 200);
    const state = await response.json();
    assert.deepEqual(state.projects, [{ id: 'case-1', path: '/tmp/case-1', name: 'Dossier test' }]);
    assert.deepEqual(state.bots, [{
      id: 'case-1', projectId: 'case-1', projectName: 'Dossier test', username: 'case_bot',
      ownerId: '123456', desired: false, active: false,
    }]);
    assert.equal(JSON.stringify(state).includes('private-token'), false);
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
