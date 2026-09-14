import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import express from 'express';

import { createLibraryRouter } from './routes.js';
import type { createLibraryStore } from './store.js';

test('DELETE /catalog/:id removes a skill from the library', async () => {
  const id = 'a'.repeat(64);
  const deleted: string[] = [];
  const store = {
    deleteEntry(entryId: string) {
      deleted.push(entryId);
      return { ok: true };
    },
  } as unknown as ReturnType<typeof createLibraryStore>;
  const app = express();
  app.use(express.json());
  app.use(createLibraryRouter(store));
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Adresse HTTP indisponible.');
    const response = await fetch(`http://127.0.0.1:${address.port}/catalog/${id}`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(deleted, [id]);
  } finally {
    server.close();
  }
});
