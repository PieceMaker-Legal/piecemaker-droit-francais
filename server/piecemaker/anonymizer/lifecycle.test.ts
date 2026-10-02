import assert from 'node:assert/strict';
import test from 'node:test';

import { startRequiredAnonymizer } from './lifecycle.js';

test('le démarrage attend écoute et configuration avant de rendre la main', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let ready = false;
  const service = {
    start: () => pending.then(() => { ready = true; }),
    stop: async () => {},
    status: () => ({ enabled: ready, listening: ready }),
  };
  let returned = false;
  const startup = startRequiredAnonymizer(service).then((guard) => { returned = true; return guard; });
  await Promise.resolve();
  assert.equal(returned, false);
  release();
  const guard = await startup;
  assert.equal(returned, true);
  guard();
  ready = false;
  assert.throws(guard, /proxy PII est indisponible/);
});

test('échec du proxy : démarrage refusé et ressources fermées', async () => {
  let stopped = false;
  await assert.rejects(startRequiredAnonymizer({
    start: async () => {},
    stop: async () => { stopped = true; },
    status: () => ({ enabled: false, listening: false }),
  }), /Démarrage IA refusé/);
  assert.equal(stopped, true);
});
