import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';

import type express from 'express';

import { createOrchestratorLocalRouter, createOrchestratorRouter } from '../routes.js';

const root = '/dossier-fictif';
const callPath = '/orchestrateur/call';
const payload = { root, session_key: 'cle-fictive', tool: 'read_memory', args: {} };

function request(router: express.Router, method: string, url: string, body?: unknown) {
  return new Promise<{ status: number; value: unknown }>((resolve, reject) => {
    let status = 200;
    const req = { method, url, body, headers: {}, query: {}, user: { id: 7 } };
    const res = {
      status(code: number) { status = code; return res; },
      json(value: unknown) { resolve({ status, value }); },
    };
    router(req as unknown as express.Request, res as express.Response, error => reject(error ?? new Error('Route absente.')));
  });
}

test('La route locale refuse un appel distant avant de transmettre la clé', async () => {
  const call = mock.fn(async () => []);
  const router = createOrchestratorLocalRouter({ call }, () => false);
  assert.equal((await request(router, 'POST', callPath, payload)).status, 403);
  assert.equal(call.mock.callCount(), 0);
});

test('La route locale transmet les paramètres et renvoie le résultat du service', async () => {
  const call = mock.fn(async (..._args: unknown[]) => ({ text: 'Mémoire fictive', revision: 1, updatedAt: null }));
  const router = createOrchestratorLocalRouter({ call }, () => true);
  assert.deepEqual(await request(router, 'POST', callPath, payload), { status: 200, value: { text: 'Mémoire fictive', revision: 1, updatedAt: null } });
  assert.deepEqual(call.mock.calls[0].arguments, [root, payload.session_key, payload.tool, payload.args]);
});

test('Un projet inconnu est refusé et le service reçoit seulement le message du projet connu', async () => {
  const postUserMessage = mock.fn(() => { throw Object.assign(new Error('Message refusé'), { code: 400 }); });
  const service = { postUserMessage, isCentral: () => false } as unknown as Parameters<typeof createOrchestratorRouter>[0];
  const router = createOrchestratorRouter(service, { getProjectPaths: () => [{ project_id: 'p1', project_path: root }] });
  assert.equal((await request(router, 'POST', '/message', { project: '/autre-dossier', text: 'Bonjour' })).status, 404);
  assert.deepEqual(await request(router, 'POST', '/message', { project: root, text: 'Bonjour', userId: 15 }), {
    status: 400, value: { error: 'Message refusé' },
  });
  assert.equal(postUserMessage.mock.callCount(), 1);
  assert.deepEqual(postUserMessage.mock.calls[0].arguments, [root, 'Bonjour', 7]);
});

test('L’agent central est accepté hors des dossiers et sa session renvoie l’identifiant du projet', async () => {
  const central = '/agent-central-fictif';
  const state = mock.fn(() => ({ ok: true }));
  const centralSession = mock.fn(async () => ({ project: central, sessionId: 's1', provider: 'claude' }));
  const service = { state, centralSession, isCentral: (project: string) => project === central } as unknown as Parameters<typeof createOrchestratorRouter>[0];
  const rows: Array<{ project_id: string; project_path: string }> = [];
  const router = createOrchestratorRouter(service, { getProjectPaths: () => rows });
  const get = (url: string, query: Record<string, string>) => new Promise<{ status: number; value: unknown }>((resolve, reject) => {
    let status = 200;
    const req = { method: 'GET', url, query, headers: {}, user: { id: 7 } };
    const res = { status(code: number) { status = code; return res; }, json(value: unknown) { resolve({ status, value }); } };
    router(req as unknown as express.Request, res as express.Response, error => reject(error ?? new Error('Route absente.')));
  });
  assert.equal((await get('/state?project=' + encodeURIComponent(central), { project: central })).status, 200);
  assert.equal((await get('/state?project=%2Fautre', { project: '/autre' })).status, 404);
  rows.push({ project_id: 'p-central', project_path: central });
  assert.deepEqual(await request(router, 'POST', '/central/session', {}), {
    status: 200, value: { project: central, sessionId: 's1', provider: 'claude', projectId: 'p-central' },
  });
  assert.deepEqual(centralSession.mock.calls[0].arguments, [7]);
});

test('L’agent central lit et modifie la paire About.md et Roadmap.json d’un dossier, sous le contrôle du Hérisson', async t => {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pm-paire-')));
  const central = path.join(base, 'PieceMaker Agent');
  const dupont = path.join(base, 'Dossier Dupont');
  mkdirSync(path.join(base, 'home'), { recursive: true });
  mkdirSync(dupont, { recursive: true });
  writeFileSync(path.join(base, 'home', 'brain.json'), JSON.stringify({ path: central }));
  const previous = process.env.PIECEMAKER_HOME;
  process.env.PIECEMAKER_HOME = path.join(base, 'home');
  t.after(() => { if (previous === undefined) delete process.env.PIECEMAKER_HOME; else process.env.PIECEMAKER_HOME = previous; rmSync(base, { recursive: true, force: true }); });
  const service = { isCentral: (project: string) => project === central } as unknown as Parameters<typeof createOrchestratorRouter>[0];
  const router = createOrchestratorRouter(service, { getProjectPaths: () => [{ project_id: 'p1', project_path: dupont }] });
  const call = (method: string, url: string, input: Record<string, unknown>) => new Promise<{ status: number; value: Record<string, unknown> }>((resolve, reject) => {
    let status = 200;
    const req = { method, url, query: method === 'GET' ? input : {}, body: method === 'GET' ? {} : input, headers: {}, user: { id: 7 } };
    const res = { status(code: number) { status = code; return res; }, json(value: Record<string, unknown>) { resolve({ status, value }); } };
    router(req as unknown as express.Request, res as unknown as express.Response, error => reject(error ?? new Error('Route absente.')));
  });
  const pair = await call('GET', '/case', { project: central, folder: dupont });
  assert.equal(pair.status, 200);
  assert.deepEqual([pair.value.name, pair.value.about, pair.value.roadmap], ['Dossier Dupont', '', {}]);
  assert.equal((await call('GET', '/case', { project: dupont, folder: dupont })).status, 403);
  assert.equal((await call('GET', '/case', { project: central, folder: path.join(base, 'Societe Exemple') })).status, 404);
  assert.equal((await call('PUT', '/case/about', { project: central, folder: dupont, text: '# Dossier Dupont\n\nStatut : en cours' })).status, 200);
  assert.equal(readFileSync(path.join(central, 'projects', 'Dossier Dupont', 'About.md'), 'utf8'), '# Dossier Dupont\n\nStatut : en cours\n');
  assert.equal((await call('PUT', '/case/about', { project: central, folder: dupont, text: Array.from({ length: 201 }, () => 'x').join('\n') })).status, 400);
  const suivis = { 'appel-suivi.json': { echeances: { audience: { intitule: 'Audience de plaidoirie', kind: 'hearing', date: '2026-12-01' } } } };
  const saved = await call('PUT', '/case/roadmap', { project: central, folder: dupont, roadmap: { suivis } });
  assert.deepEqual(saved.value.roadmap, { suivis });
  const refused = await call('PUT', '/case/roadmap', { project: central, folder: dupont, roadmap: { suivis, etapes: { mappingValide: '2026-01-01' } } });
  assert.equal(refused.status, 400);
  assert.match(String(refused.value.error), /"etapes" cannot be changed/);
});
