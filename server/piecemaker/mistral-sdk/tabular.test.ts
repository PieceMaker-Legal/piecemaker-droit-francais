import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import { createMistralTabularBridge } from './tabular.js';
import type { mistralSdkAuth } from './auth.service.js';

test('tabular delegation stays local, selects one account and confines reading to the authorized Markdown corpus', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mistral-tabular-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const corpus = path.join(home, 'docs');
  await fs.mkdir(corpus);
  await fs.writeFile(path.join(home, 'outside.md'), 'Contenu hors corpus.');
  const requests: unknown[] = [];
  let users = [1];
  const replies = [
    { role: 'assistant', content: null, toolCalls: [{ id: 'abcdef123', function: { name: 'Read', arguments: '{"file_path":"../outside.md"}' } }] },
    { role: 'assistant', content: 'Refus respecté.' },
  ];
  const app = express();
  app.use(express.json());
  app.use('/api/piecemaker/local', createMistralTabularBridge({
    ensureProxy() {}, runInProject(_id, run) { return run(); }, projects: () => [{ project_id: 'example', project_path: home, custom_project_name: null, isStarred: 0, isArchived: 0 }], localUserIds: () => users,
    authenticate: ((userId: number) => {
      assert.equal(userId, 1);
      return { client: { chat: { complete: async (request: unknown) => { requests.push(structuredClone(request)); return { choices: [{ message: replies.shift() }] }; } } }, close: async () => {} };
    }) as unknown as typeof mistralSdkAuth.createClient,
  }));
  app.use((error: { statusCode?: number; message: string }, _request: express.Request, response: express.Response, _next: express.NextFunction) => response.status(error.statusCode || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/piecemaker/local/mistral-sdk`;
  const post = (route: string, body: unknown, token?: string) => fetch(origin + route, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const delegated = await post('/delegation', { project: corpus });
  assert.equal(delegated.status, 200);
  const { token } = await delegated.json() as { token: string };
  assert.match(token, /^[a-f0-9]{64}$/);
  const body = { model: 'mistral-small-latest', system: 'Essai fictif.', mode: 'path', readableDirectory: corpus, messages: [{ role: 'user', content: 'Lire un document.' }] };
  assert.equal((await post('/tabular', body, 'wrong-token')).status, 401);
  const result = await post('/tabular', body, token);
  assert.equal(result.status, 200);
  assert.equal((await result.json() as { response: string }).response, 'Refus respecté.');
  assert.ok(JSON.stringify(requests.at(-1)).includes('Lecture limitée aux Markdown'));
  assert.ok(!JSON.stringify(requests).includes('Contenu hors corpus.'));
  users = [1, 2];
  assert.equal((await post('/delegation', { project: corpus })).status, 409);
  assert.equal((await post('/delegation', { project: path.join(home, '..', 'outside') })).status, 409);
});
