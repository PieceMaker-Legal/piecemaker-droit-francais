import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import express from 'express';

import { createOpenPanelRequestsRouter, createOpenPanelsRouter, OPEN_PANELS_FILE } from './open-panels.js';

let home = '';
let base = '';
let close = () => {};

before(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'pm-open-panels-'));
  const app = express();
  app.use(express.json());
  app.use(createOpenPanelsRouter(home, () => ['/dossiers/Dupont']));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

after(async () => {
  close();
  await rm(home, { recursive: true, force: true });
});

const put = (body: unknown) => fetch(`${base}/volets-ouverts`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('enregistre les volets ouverts du dossier', async () => {
  const response = await put({ project: '/dossiers/Dupont', panels: ['files'], document: '/dossiers/Dupont/note.md', focus: {}, last: { kind: 'document', path: '/dossiers/Dupont/note.md' } });
  assert.equal(response.status, 200);
  const stored = JSON.parse(await readFile(path.join(home, OPEN_PANELS_FILE), 'utf8'));
  assert.deepEqual(stored['/dossiers/Dupont'].panels, ['files']);
  assert.equal(stored['/dossiers/Dupont'].document, '/dossiers/Dupont/note.md');
});

test('refuse un dossier inconnu ou des volets invalides', async () => {
  assert.equal((await put({ project: '/ailleurs', panels: [] })).status, 404);
  assert.equal((await put({ project: '/dossiers/Dupont', panels: [1] })).status, 400);
});

test('accepte le volet tampon et ferme un volet', async () => {
  const app = express();
  app.use(express.json());
  app.use(createOpenPanelRequestsRouter(() => ['/dossiers/Dupont']));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const json = (url: string, init?: RequestInit) => fetch(`${origin}${url}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const opened = await json('/open-panel', { method: 'POST', body: JSON.stringify({ project: '/dossiers/Dupont', tab: 'plugin:piecemaker-tampon' }) });
  assert.equal(opened.status, 200);
  const taken = await (await json('/open-panel?project=/dossiers/Dupont')).json() as { request: { tab: string } | null };
  assert.equal(taken.request?.tab, 'plugin:piecemaker-tampon');
  const closed = await json('/close-panel', { method: 'POST', body: JSON.stringify({ project: '/dossiers/Dupont', tab: 'plugin:piecemaker-dossier' }) });
  assert.equal(closed.status, 200);
  const closeTaken = await (await json('/close-panel?project=/dossiers/Dupont')).json() as { request: { tab: string } | null };
  assert.equal(closeTaken.request?.tab, 'plugin:piecemaker-dossier');
  assert.equal((await json('/open-panel', { method: 'POST', body: JSON.stringify({ project: '/dossiers/Dupont', tab: 'inconnu' }) })).status, 400);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
