import assert from 'node:assert/strict';
import test from 'node:test';

import type express from 'express';

import { createCitationReviewContext } from './reasoning-review-context.js';

const request = (userId?: number, provider?: unknown) => ({ user: userId ? { id: userId } : undefined, body: { provider } }) as unknown as express.Request;
const scoped = <T>(middleware: express.RequestHandler, req: express.Request, run: () => Promise<T>) => new Promise<T>((resolve, reject) => {
  middleware(req, {} as express.Response, () => { run().then(resolve, reject); });
});

test('deux requêtes concurrentes conservent chacune le compte et le fournisseur choisis', async () => {
  const context = createCitationReviewContext((id) => ({ selectedProvider: id === 1 ? 'mistral' : 'codex' }), () => [{ id: 1 }]);
  const results = await Promise.all([1, 2].map((id) => scoped(context.scope(false), request(id), async () => {
    await new Promise((resolve) => setTimeout(resolve, id === 1 ? 10 : 0));
    return context.select();
  })));
  assert.deepEqual(results, [{ userId: 1, provider: 'mistral' }, { userId: 2, provider: 'codex' }]);
  await scoped(context.scope(false), request(1, 'claude'), async () => assert.deepEqual(context.select(), { userId: 1, provider: 'claude' }));
  assert.throws(() => context.select(), /Utilisateur/);
});

test('la commande locale suit le fournisseur enregistré et refuse un compte ambigu', async () => {
  let users = [{ id: 2 }];
  const context = createCitationReviewContext(() => ({ selectedProvider: 'mistral' }), () => users);
  await scoped(context.scope(true), request(), async () => assert.deepEqual(context.select(), { userId: 2, provider: 'mistral' }));
  users = [{ id: 1 }, { id: 2 }];
  await scoped(context.scope(true), request(), async () => assert.throws(() => context.select(), /seul compte/));
  await scoped(context.scope(false), request(), async () => assert.throws(() => context.select(), /Utilisateur/));
  const defaults = createCitationReviewContext(() => ({}), () => [{ id: 1 }]);
  await scoped(defaults.scope(true), request(), async () => assert.deepEqual(defaults.select(), { userId: 1, provider: 'claude' }));
});
