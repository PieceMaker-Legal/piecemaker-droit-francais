import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReviewInvocation } from '../modules/piecemaker-reasoning/citation-review-model.js';

import { createCitationTransport } from './reasoning-review-transport.js';

const invocation = { provider: 'mistral', userId: 7, model: 'mistral-small-latest', cwd: '/dossier-fictif', prompt: 'Vérifiez uniquement les citations.', payload: '{"affirmations":[]}', schema: { type: 'object', properties: { verifications: { type: 'array' } } } } as unknown as ReviewInvocation;

test('Mistral utilise le compte de la requête, le proxy et le schéma strict puis ferme le client même après une erreur', async () => {
  const events: string[] = [];
  let inProject = false;
  let fail = false;
  const transport = createCitationTransport({
    runInCase: async (cwd, run) => { assert.equal(cwd, invocation.cwd); inProject = true; try { return await run(); } finally { inProject = false; } },
    ensureProxy: () => { assert.ok(inProject); events.push('proxy'); },
    authenticate: (userId) => {
      assert.equal(userId, 7);
      assert.ok(inProject);
      events.push('auth');
      return { client: { chat: { complete: async (request: any) => {
        assert.equal(request.model, 'mistral-small-latest');
        assert.deepEqual(request.messages, [{ role: 'system', content: invocation.prompt }, { role: 'user', content: invocation.payload }]);
        assert.equal(request.tools, undefined);
        assert.equal(request.responseFormat.type, 'json_schema');
        assert.equal(request.responseFormat.jsonSchema.strict, true);
        if (fail) throw new Error('Transport refusé');
        return { choices: [{ message: { content: '{"verifications":[]}' } }] };
      } } } as any, close: async () => { events.push('close'); } };
    },
  });
  assert.deepEqual(await transport(invocation), { verifications: [] });
  fail = true;
  await assert.rejects(transport(invocation), /Transport refusé/);
  assert.deepEqual(events, ['proxy', 'auth', 'close', 'proxy', 'auth', 'close']);
});

test('un proxy indisponible empêche la création du client et toute requête', async () => {
  let connected = false;
  const transport = createCitationTransport({ runInCase: async (_cwd, run) => run(), ensureProxy: () => { throw new Error('Proxy indisponible'); }, authenticate: () => { connected = true; throw new Error('Ne doit pas démarrer'); } });
  await assert.rejects(transport(invocation), /Proxy indisponible/);
  assert.equal(connected, false);
});
