import assert from 'node:assert/strict';
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
