import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import express from 'express';

import { createKnowledgeLocalRouter } from '../local-routes.js';
import type { createKnowledgeService } from '../service.js';

type Calls = {
  scan: Array<{ projectId: string; files: unknown }>;
  scanJob: Array<{ id: unknown; projectId: string }>;
  cancelScan: Array<{ id: unknown; projectId: string }>;
};

function harness() {
  const calls: Calls = { scan: [], scanJob: [], cancelScan: [] };
  const service = {
    scan(projectId: string, files: unknown) {
      calls.scan.push({ projectId, files });
      return { job: { id: 'job-1', state: 'running' } };
    },
    scanJob(id: unknown, projectId: string) {
      calls.scanJob.push({ id, projectId });
      return { job: { id, state: 'done', result: { documents: 2 } } };
    },
    cancelScan(id: unknown, projectId: string) {
      calls.cancelScan.push({ id, projectId });
      return { cancelled: true };
    },
  } as unknown as ReturnType<typeof createKnowledgeService>;
  const projects = {
    getProjectPath(projectPath: string) {
      if (projectPath !== '/dossiers/alpha') return null;
      return { project_id: 'project-alpha', project_path: projectPath };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/piecemaker/local', createKnowledgeLocalRouter(() => service, projects));
  return { app, calls };
}

async function withServer(app: express.Express, run: (base: string) => Promise<void>) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Adresse HTTP indisponible.');
    await run(`http://127.0.0.1:${address.port}/api/piecemaker/local`);
  } finally {
    server.close();
  }
}

test('POST /scan résout le dossier en projet et délègue au service partagé', async () => {
  const { app, calls } = harness();
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: '/dossiers/alpha', files: ['Pieces/01.pdf'] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      projectId: 'project-alpha',
      job: { id: 'job-1', state: 'running' },
    });
    assert.deepEqual(calls.scan, [{ projectId: 'project-alpha', files: ['Pieces/01.pdf'] }]);
  });
});

test('GET /scan/job renvoie le travail du projet résolu', async () => {
  const { app, calls } = harness();
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/scan/job?folder=${encodeURIComponent('/dossiers/alpha')}&id=job-1`);
    assert.equal(response.status, 200);
    assert.deepEqual(calls.scanJob, [{ id: 'job-1', projectId: 'project-alpha' }]);
  });
});

test('POST /scan/cancel annule le travail du projet résolu', async () => {
  const { app, calls } = harness();
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/scan/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: '/dossiers/alpha', id: 'job-1' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls.cancelScan, [{ id: 'job-1', projectId: 'project-alpha' }]);
  });
});

test('un dossier inconnu répond 404 et un dossier manquant 400', async () => {
  const { app } = harness();
  await withServer(app, async (base) => {
    const unknown = await fetch(`${base}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: '/dossiers/inconnu' }),
    });
    assert.equal(unknown.status, 404);

    const missing = await fetch(`${base}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(missing.status, 400);
  });
});

test('un appelant hors boucle locale est refusé', async () => {
  const { app, calls } = harness();
  const guarded = express();
  guarded.use((request, _response, next) => {
    Object.defineProperty(request.socket, 'remoteAddress', { value: '203.0.113.7', configurable: true });
    next();
  });
  guarded.use(app);
  await withServer(guarded as unknown as express.Express, async (base) => {
    const response = await fetch(`${base}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: '/dossiers/alpha' }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(calls.scan, []);
  });
});
