import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { declarePieceMakerServer } from './mcp-declaration.js';

const TOML = createRequire(import.meta.url)('@iarna/toml') as { parse(value: string): Record<string, any> };

const TARGET_FILES = ['.codex/config.toml', '.vibe/config.toml', '.cursor/mcp.json', 'opencode.json', '.grok/config.toml'];

function temporaryFolder() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-mcp-declaration-')));
}

function snapshot(folder: string) {
  return Object.fromEntries(TARGET_FILES.map((file) => {
    const filePath = path.join(folder, file);
    return [file, { content: fs.readFileSync(filePath, 'utf8'), mtimeMs: fs.statSync(filePath).mtimeMs }];
  }));
}

test('déclare piecemaker pour Codex et Vibe, conserve les entrées tierces', () => {
  const folder = temporaryFolder();
  fs.mkdirSync(path.join(folder, '.codex'));
  fs.writeFileSync(path.join(folder, '.codex', 'config.toml'), '[mcp_servers.exemple]\ncommand = "exemple-mcp"\nargs = ["--demo"]\nenabled = true\n');
  fs.mkdirSync(path.join(folder, '.vibe'));
  fs.writeFileSync(path.join(folder, '.vibe', 'config.toml'), '[[mcp_servers]]\nname = "exemple"\ntransport = "stdio"\ncommand = "exemple-mcp"\nargs = []\n');

  declarePieceMakerServer(folder);

  const codex = TOML.parse(fs.readFileSync(path.join(folder, '.codex', 'config.toml'), 'utf8'));
  assert.equal(codex.mcp_servers.exemple.command, 'exemple-mcp');
  assert.equal(codex.mcp_servers.piecemaker.command, 'node');
  assert.match(codex.mcp_servers.piecemaker.args[0], /vendor[\\/]mcp[\\/]piecemaker[\\/]server\.mjs$/);
  const vibe = TOML.parse(fs.readFileSync(path.join(folder, '.vibe', 'config.toml'), 'utf8'));
  assert.deepEqual(vibe.mcp_servers.map((server: { name: string }) => server.name).sort(), ['exemple', 'piecemaker']);
  assert.equal(fs.existsSync(path.join(folder, '.mcp.json')), false);
  assert.equal(fs.existsSync(path.join(folder, '.claude', 'settings.local.json')), false);
});

test('un second passage ne réécrit aucun fichier', () => {
  const folder = temporaryFolder();
  declarePieceMakerServer(folder);
  const old = new Date('2020-01-01T00:00:00Z');
  for (const file of TARGET_FILES) fs.utimesSync(path.join(folder, file), old, old);
  const before = snapshot(folder);

  declarePieceMakerServer(folder);

  assert.deepEqual(snapshot(folder), before);
});

test('une entrée piecemaker obsolète est remplacée', () => {
  const folder = temporaryFolder();
  fs.mkdirSync(path.join(folder, '.codex'));
  fs.writeFileSync(path.join(folder, '.codex', 'config.toml'), '[mcp_servers.piecemaker]\ncommand = "node"\nargs = ["/ancien/server.mjs"]\nenabled = true\n');

  declarePieceMakerServer(folder);

  const codex = TOML.parse(fs.readFileSync(path.join(folder, '.codex', 'config.toml'), 'utf8'));
  assert.match(codex.mcp_servers.piecemaker.args[0], /vendor[\\/]mcp[\\/]piecemaker[\\/]server\.mjs$/);
});

test('un dossier inexistant est journalisé sans lever d’erreur', (context) => {
  const warn = context.mock.method(console, 'warn', () => undefined);
  declarePieceMakerServer(path.join(temporaryFolder(), 'absent'));
  assert.equal(warn.mock.callCount(), 1);
});
