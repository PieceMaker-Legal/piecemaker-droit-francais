import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { createFeatureCommentsRouter } from './feature-comments.js';

test('le commentaire ancré est écrit dans le fil de la feature', async (context) => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'feature-comments-'));
  context.after(() => rm(project, { recursive: true, force: true }));
  const app = express();
  app.use('/api/piecemaker', createFeatureCommentsRouter({ getProjectPathById: (id: string) => id === 'exemple' ? project : null }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (body: object, projectId = 'exemple') => fetch(`${origin}/api/piecemaker/feature-comments?${new URLSearchParams({ projectId })}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const anchor = { tab: 'plugin:piecemaker-catala', title: 'Délai de préavis', file: '.piecemaker/catala/preavis/preavis.catala_fr', start: 3, end: 5 };
  const created = await post({ feature: 'catala', id: 'ab12cd34', text: 'Vérifier ce délai', anchor });
  assert.equal(created.status, 201);
  const stored = JSON.parse(await readFile(path.join(project, '.piecemaker', 'features', 'comments', 'catala.json'), 'utf8'));
  assert.deepEqual(stored.threads[0].anchor, anchor);
  assert.equal(stored.threads[0].messages[0].author, 'lawyer');
  assert.equal((await post({ feature: 'catala', id: 'ab12cd34', text: 'Encore' })).status, 409);
  assert.equal((await post({ feature: 'nothing', text: 'x' })).status, 400);
  assert.equal((await post({ feature: 'catala', text: '' })).status, 400);
  assert.equal((await post({ feature: 'catala', text: 'x' }, 'autre')).status, 404);
});
