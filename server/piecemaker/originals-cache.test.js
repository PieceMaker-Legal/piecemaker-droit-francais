import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createOriginalsCache } = require('./originals-cache.cjs');

test('les appels concurrents sur un même dossier réel partagent une seule marche', async () => {
  let calls = 0;
  let resolveList;
  const pendingList = new Promise((resolve) => {
    resolveList = resolve;
  });
  const cache = createOriginalsCache({
    list: async () => {
      calls += 1;
      return pendingList;
    },
    realpath: () => '/dossiers/affaire',
  });

  const first = cache.listOriginalsCached('/alias/affaire');
  const second = cache.listOriginalsCached('/dossiers/affaire');
  assert.strictEqual(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);

  resolveList([{ path: 'piece.pdf' }]);
  assert.deepEqual(await first, [{ path: 'piece.pdf' }]);
  assert.deepEqual(await second, [{ path: 'piece.pdf' }]);
});

test('l’invalidation force la marche suivante', async () => {
  let calls = 0;
  const cache = createOriginalsCache({
    list: async () => [{ call: ++calls }],
    realpath: () => '/dossiers/affaire',
  });

  assert.deepEqual(await cache.listOriginalsCached('/dossiers/affaire'), [{ call: 1 }]);
  cache.invalidateOriginals('/dossiers/affaire');
  assert.deepEqual(await cache.listOriginalsCached('/dossiers/affaire'), [{ call: 2 }]);
});

test('le TTL expiré force la marche suivante', async () => {
  let calls = 0;
  let currentTime = 100;
  const cache = createOriginalsCache({
    list: async () => [{ call: ++calls }],
    now: () => currentTime,
    realpath: () => '/dossiers/affaire',
    ttlMs: 5_000,
  });

  assert.deepEqual(await cache.listOriginalsCached('/dossiers/affaire'), [{ call: 1 }]);
  currentTime += 5_000;
  assert.deepEqual(await cache.listOriginalsCached('/dossiers/affaire'), [{ call: 2 }]);
});

test('la capacité bornée évince la dernière entrée ajoutée', async () => {
  const calls = new Map();
  const cache = createOriginalsCache({
    list: async (caseRoot) => {
      const nextCall = (calls.get(caseRoot) || 0) + 1;
      calls.set(caseRoot, nextCall);
      return [{ caseRoot, call: nextCall }];
    },
    maxEntries: 2,
    realpath: (caseRoot) => caseRoot,
  });

  await cache.listOriginalsCached('/dossiers/a');
  await cache.listOriginalsCached('/dossiers/b');
  await cache.listOriginalsCached('/dossiers/c');
  assert.deepEqual(await cache.listOriginalsCached('/dossiers/a'), [{ caseRoot: '/dossiers/a', call: 1 }]);
  assert.deepEqual(await cache.listOriginalsCached('/dossiers/b'), [{ caseRoot: '/dossiers/b', call: 2 }]);
});
