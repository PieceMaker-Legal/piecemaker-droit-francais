import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { createCitationStore } from './citation-store.js';
import { createCitationsRouter } from './citations.routes.js';

test('source authentifiée, positions conservées et session supprimée refusée', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pm-citation-route-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createCitationStore(directory);
  const token = await store.save({
    sessionId: 'session', title: 'Pièce', source: 'Extrait réel.',
    citation: { ref: 1, verified: true, quotes: [{ quote: 'Extrait réel.', verification: { verified: true } }] },
    ranges: [{ start: 0, end: 13, quoteIndex: 0 }],
  });
  let sessionExists = true;
  const app = express();
  app.use('/api/piecemaker', (request, response, next) => {
    if (request.headers.authorization !== 'Bearer test') { response.sendStatus(401); return; }
    next();
  }, createCitationsRouter(store, () => sessionExists));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/piecemaker/citations/${token}`;
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url, { headers: { authorization: 'Bearer test' } });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json() as Partial<NonNullable<Awaited<ReturnType<typeof store.read>>>>;
  assert.equal(body.source, 'Extrait réel.');
  assert.deepEqual(body.ranges, [{ start: 0, end: 13, quoteIndex: 0 }]);
  assert.equal(body.sessionId, undefined);
  sessionExists = false;
  assert.equal((await fetch(url, { headers: { authorization: 'Bearer test' } })).status, 404);
});

test('une décision absente du tour reste consultable depuis le cache sans devenir vérifiée rétroactivement', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pm-citation-cached-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createCitationStore(directory);
  const id = 'JURITEXT000007048138';
  const token = await store.save({
    sessionId: 'session', title: id, source: '',
    citation: { ref: 1, decision_id: id, verified: false, quotes: [
      { quote: 'passage réel', verification: { verified: false } },
      { quote: 'citation inventée', verification: { verified: false } },
    ] },
    ranges: [],
  });
  await mkdir(path.join(directory, 'decisions'));
  await writeFile(path.join(directory, 'decisions', `${id}.json`), JSON.stringify({ id, texte: 'Avant. Passage réel. Après.' }));
  const view = await store.read(token, { forViewing: true });
  assert.equal(view?.sourceOrigin, 'decision-cache');
  assert.equal(view?.source, 'Avant. Passage réel. Après.');
  assert.equal(view?.citation.verified, false);
  assert.equal(view?.citation.quotes[0].verification?.verified, false);
  assert.deepEqual(view?.ranges, [{ start: 7, end: 19, quoteIndex: 0 }]);
  assert.equal((await store.read(token))?.source, '');
});
