import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import express from 'express';

import { connectedClients, WS_OPEN_STATE } from '../modules/websocket/index.js';

import { catalaScriptPath, createCatalaCitationCheck, createCatalaRouter, createCatalaUpdatedRouter } from './catala.js';
import { createCatalaCitation } from './catala-citation.js';
import { createCitationStore } from './harness/citation-store.js';

const MODULE = '> Module Prime\n\n## Ancienneté\n\nPièce : [Attestation fictive](../../../pieces/attestation.md).\n\n```catala-metadata\ndéclaration champ d\'application Prime:\n  résultat montant contenu argent\n```\n';
const TASK = { tache: 'Prime d’ancienneté', type: 'litigation', date_vigueur: '2026-11-04', raisonnements: [{ champ: 'JeanDupont', objectif: 'Calculer la prime.' }] };
const TESTS = '> Usage de Prime\n\n```catala\n#[test]\ndéclaration champ d\'application JeanDupont:\n  résultat calcul champ d\'application Prime.Prime\n```\n';

let root = '';
let home = '';
let dossier = '';
let base = '';
let close = () => {};
let explanations = 0;
let sourceReads = 0;

const runner = async (command: string, args: string[], options: { cwd: string }) => {
  const tool = path.basename(command);
  if (tool === 'catala' && args[0] === 'explain') { explanations++; return { code: 0, stdout: 'digraph G { x001 [label=<Prime>] }', stderr: '' }; }
  if (tool === 'catala-format') return { code: 0, stdout: fs.readFileSync(path.join(options.cwd, args.at(-1)!), 'utf8'), stderr: '' };
  if (tool === 'clerk' && args[0] === 'runtest') fs.writeFileSync(path.join(options.cwd, args.find((arg) => arg.startsWith('--report='))!.slice(9)), 'report');
  if (tool === 'clerk' && args[0] === 'report') return { code: 0, stdout: JSON.stringify({ 'test-results': [{ file: path.join(options.cwd, 'test_prime.catala_fr'), tests: { scopes: [{ scope_name: 'JeanDupont', success: true, errors: [], time: 0.1 }], 'inline-tests': [] } }] }), stderr: '' };
  return { code: 0, stdout: 'ok', stderr: '' };
};

const program = (name: string) => {
  const directory = path.join(dossier, '.piecemaker', 'catala', name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'clerk.toml'), `[project]\nname = "${name}"\n`);
  fs.writeFileSync(path.join(directory, 'prime.catala_fr'), MODULE);
  fs.writeFileSync(path.join(directory, 'test_prime.catala_fr'), TESTS);
  fs.writeFileSync(path.join(directory, 'tache.json'), JSON.stringify(TASK));
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
  const service = createCatalaCitation({ source: async () => { sourceReads++; return { kind: 'texte', title: 'Source fictive', text: 'Passage exact.' }; }, match: (text, quote) => text.includes(quote) ? quote : null }, createCitationStore(home));
  const app = express();
  app.use(createCatalaUpdatedRouter((request) => request.headers['x-test-loopback'] !== 'no', () => [dossier], createCatalaCitationCheck(catalaScriptPath(process.cwd()), service)));
  app.use(createCatalaRouter(catalaScriptPath(process.cwd()), { env, homeDir: home, run: runner, python: null, credentials: null, now: () => '2026-11-04T10:00:00Z' }, service));
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
  const directory = program('prime-anciennete');
  fs.mkdirSync(path.join(directory, 'resultats'));
  const hash = crypto.createHash('sha256');
  for (const file of ['prime.catala_fr', 'test_prime.catala_fr']) hash.update(`${file}\0`).update(fs.readFileSync(path.join(directory, file))).update('\0');
  fs.writeFileSync(path.join(directory, 'resultats', 'explication.json'), JSON.stringify({ scope: 'JeanDupont', passed: true, sources_sha256: hash.digest('hex') }));
  fs.writeFileSync(path.join(directory, 'resultats', 'explication.dot'), 'digraph G { x001 -> x002; }');
  const response = await fetch(`${base}/?projectPath=${encodeURIComponent(dossier)}`);
  const data = await response.json() as any;
  assert.equal(response.status, 200);
  assert.equal(data.pack.id, 'pack-essai');
  assert.equal(data.status.state, 'pret');
  assert.deepEqual(data.programmes.map((entry: { nom: string }) => entry.nom), ['prime-anciennete']);
  assert.deepEqual(data.programmes[0].fichiers.map((file: { nom: string }) => file.nom), ['prime.catala_fr', 'test_prime.catala_fr']);
  assert.equal(data.programmes[0].fichiers[0].contenu, MODULE);
  assert.equal(data.programmes[0].verification, null);
  assert.equal(data.programmes[0].explication.scope, 'JeanDupont');
  assert.equal(data.programmes[0].graphe, 'digraph G { x001 -> x002; }');
});

test('vérifie un programme et renvoie le bilan et les journaux', async () => {
  program('licenciement-jean-dupont');
  const response = await fetch(`${base}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectPath: dossier, programme: 'licenciement-jean-dupont' }) });
  const data = await response.json() as any;
  assert.equal(response.status, 200);
  const verified = data.programmes.find((entry: { nom: string }) => entry.nom === 'licenciement-jean-dupont');
  assert.equal(verified.verification.passed, false);
  assert.equal(verified.verification.checks.find((entry: any) => entry.name === 'citations').status, 'missing');
  assert.equal(verified.tests['test-results'][0].tests.scopes[0].scope_name, 'JeanDupont');
  assert.equal(verified.tests['test-results'][0].tests.scopes[0].success, true);
  assert.equal(verified.enCours, false);
  assert.equal(verified.explication.passed, true);
  assert.equal(verified.scenarios.length, 1);
  assert.equal(verified.scenarios[0].scope, 'JeanDupont');
  assert.equal(verified.scenarios[0].test_reussi, true);
  assert.equal(verified.perimee, false);
  assert.match(verified.journaux.find((file: { nom: string }) => file.nom === 'typecheck.log').contenu, /ok/);
});

test('refuse un nom de programme mal écrit', async () => {
  const response = await fetch(`${base}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectPath: dossier, programme: '../autre' }) });
  assert.equal(response.status, 400);
  assert.match((await response.json() as { error: string }).error, /mal écrit/);
});

test('ne calcule rien à la lecture du volet et produit une nouvelle trace seulement à la vérification', async () => {
  const directory = program('prime-actualisee');
  const before = explanations;
  const read = async () => (await (await fetch(`${base}/?projectPath=${encodeURIComponent(dossier)}`)).json() as any).programmes.find((entry: any) => entry.nom === 'prime-actualisee');
  const initial = await read();
  assert.equal(initial.graphe, null);
  assert.equal(explanations, before);
  const verify = () => fetch(`${base}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectPath: dossier, programme: 'prime-actualisee' }) });
  await verify();
  const verified = await read();
  assert.equal(verified.explication.passed, true);
  assert.equal(explanations, before + 1);
  fs.appendFileSync(path.join(directory, 'test_prime.catala_fr'), '\nTexte fictif ajouté.\n');
  const stale = await read();
  assert.equal(stale.perimee, true);
  assert.equal(stale.graphe, null);
  assert.deepEqual(stale.scenarios, []);
  assert.equal(stale.tests, null);
  assert.equal(explanations, before + 1);
  await verify();
  const updated = await read();
  assert.equal(updated.perimee, false);
  assert.equal(explanations, before + 2);
  assert.notEqual(updated.explication.sources_sha256, verified.explication.sources_sha256);
});

test('notifie les clients existants seulement depuis la boucle locale pour un dossier connu', async () => {
  const messages: string[] = [];
  const client = { readyState: WS_OPEN_STATE, send: (message: string) => messages.push(message) };
  connectedClients.add(client);
  const notify = (cwd: string, loopback = 'yes') => fetch(`${base}/catala-updated`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-loopback': loopback }, body: JSON.stringify({ cwd }) });
  try {
    assert.equal((await notify(dossier, 'no')).status, 403);
    assert.equal((await notify(path.join(root, 'inconnu'))).status, 400);
    assert.equal(messages.length, 0);
    assert.equal((await notify(dossier)).status, 200);
    assert.deepEqual(JSON.parse(messages[0]), { type: 'piecemaker-catala-updated', projectPath: dossier });
  } finally { connectedClients.delete(client); }
});


test('local citation transport validates access and the reader reuses current stored verification', async () => {
  const directory = program('citations');
  const file = path.join(directory, 'prime.catala_fr');
  fs.writeFileSync(file, '## Article fictif | LEGIARTI000000000001\n« Passage exact. »\n');
  const post = (endpoint: string, body: unknown, loopback = 'yes') => fetch(`${base}/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-loopback': loopback }, body: JSON.stringify(body) });
  assert.equal((await post('catala-citations', { cwd: dossier, programme: 'citations' }, 'no')).status, 403);
  assert.equal((await post('catala-citations', { cwd: '/inconnu', programme: 'citations' })).status, 400);
  assert.equal((await post('catala-citations', { cwd: dossier, programme: '../autre' })).status, 400);
  const local = await post('catala-citations', { cwd: dossier, programme: 'citations' });
  assert.equal(local.status, 200);
  assert.equal((await local.json() as any).passed, true);
  const verified = await post('verify', { projectPath: dossier, programme: 'citations' });
  const report = (await verified.json() as any).programmes.find((entry: any) => entry.nom === 'citations').citations;
  const before = sourceReads;
  const request = { projectPath: dossier, programme: 'citations', fichier: file, source: 'LEGIARTI000000000001', citation: 'Passage exact.' };
  const opened = await post('citation', request);
  assert.equal((await opened.json() as any).token, report.results[0].token);
  assert.equal(sourceReads, before);
  fs.appendFileSync(file, '\nTexte modifié.\n');
  await post('citation', request);
  assert.equal(sourceReads, before + 1);
});

test('la route propose les documents du skill de style, sans les règles générales', async () => {
  const data = await (await fetch(`${base}/?projectPath=${encodeURIComponent(dossier)}`)).json() as { styles: Array<{ nom: string; regle: string }> };
  assert.ok(data.styles.some((style) => style.regle === 'styles/assignation.md'));
  assert.ok(!data.styles.some((style) => style.regle === 'styles/citations.md'));
});
