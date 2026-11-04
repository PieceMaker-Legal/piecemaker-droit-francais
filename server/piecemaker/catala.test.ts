import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import express from 'express';

import { catalaScriptPath, createCatalaRouter } from './catala.js';

const MODULE = '> Module Prime\n\n```catala-metadata\ndéclaration champ d\'application Prime:\n  résultat montant contenu argent\n```\n';
const TESTS = '> Usage de Prime\n\n```catala\n#[test]\ndéclaration champ d\'application JeanDupont:\n  résultat calcul champ d\'application Prime.Prime\n```\n';

let root = '';
let home = '';
let dossier = '';
let base = '';
let close = () => {};

const runner = async (command: string, args: string[], options: { cwd: string }) => {
  const tool = path.basename(command);
  if (tool === 'catala-format') return { code: 0, stdout: fs.readFileSync(path.join(options.cwd, args.at(-1)!), 'utf8'), stderr: '' };
  if (tool === 'clerk' && args[0] === 'test') return { code: 0, stdout: JSON.stringify({ 'test-results': [{ file: path.join(options.cwd, args.at(-1)!), tests: { scopes: [{ scope_name: 'JeanDupont', success: true, errors: [], time: 0.1 }], 'inline-tests': [] } }] }), stderr: '' };
  return { code: 0, stdout: 'ok', stderr: '' };
};

const program = (name: string) => {
  const directory = path.join(dossier, '.piecemaker', 'raisonnements', name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'clerk.toml'), `[project]\nname = "${name}"\n`);
  fs.writeFileSync(path.join(directory, 'prime.catala_fr'), MODULE);
  fs.writeFileSync(path.join(directory, 'test_prime.catala_fr'), TESTS);
  return directory;
};

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-catala-route-'));
  home = path.join(root, 'home');
  dossier = path.join(root, 'Dupont');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const tools = Object.fromEntries(['catala', 'clerk', 'catala-lsp', 'catala-format', 'catala-dap'].map((name) => [name, path.join(bin, name)]));
  for (const binary of Object.values(tools)) fs.writeFileSync(binary, '');
  fs.mkdirSync(path.join(home, 'catala'), { recursive: true });
  fs.writeFileSync(path.join(home, 'catala', 'pack.json'), JSON.stringify({ id: 'pack-essai', platform: 'darwin-arm64', version: '1.3.0', proof: true, installedAt: '2026-11-01T09:00:00Z', bin: tools, path: [bin], env: {} }));
  fs.writeFileSync(path.join(home, 'catala', 'status.json'), JSON.stringify({ state: 'pret', id: 'pack-essai' }));
  const env = { PIECEMAKER_HOME: home, PATH: '/usr/bin' };
  const app = express();
  app.use(createCatalaRouter(catalaScriptPath(process.cwd()), { env, homeDir: home, run: runner, python: null, credentials: null, now: () => '2026-11-04T10:00:00Z' }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

after(() => {
  close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('liste le pack et les programmes du dossier avec leurs fichiers', async () => {
  program('prime-anciennete');
  const response = await fetch(`${base}/?projectPath=${encodeURIComponent(dossier)}`);
  const data = await response.json() as any;
  assert.equal(response.status, 200);
  assert.equal(data.pack.id, 'pack-essai');
  assert.equal(data.status.state, 'pret');
  assert.deepEqual(data.programmes.map((entry: { nom: string }) => entry.nom), ['prime-anciennete']);
  assert.deepEqual(data.programmes[0].fichiers.map((file: { nom: string }) => file.nom), ['prime.catala_fr', 'test_prime.catala_fr']);
  assert.equal(data.programmes[0].verification, null);
});

test('vérifie un programme et renvoie le bilan et les journaux', async () => {
  program('licenciement-jean-dupont');
  const response = await fetch(`${base}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectPath: dossier, raisonnement: 'licenciement-jean-dupont' }) });
  const data = await response.json() as any;
  assert.equal(response.status, 200);
  const verified = data.programmes.find((entry: { nom: string }) => entry.nom === 'licenciement-jean-dupont');
  assert.equal(verified.verification.passed, true);
  assert.equal(verified.enCours, false);
  assert.ok(verified.journaux.some((file: { nom: string }) => file.nom === 'typecheck.log'));
});

test('refuse un nom de programme mal écrit', async () => {
  const response = await fetch(`${base}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectPath: dossier, raisonnement: '../autre' }) });
  assert.equal(response.status, 400);
  assert.match((await response.json() as { error: string }).error, /mal écrit/);
});
