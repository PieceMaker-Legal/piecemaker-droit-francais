import { AsyncLocalStorage } from 'node:async_hooks';

import type express from 'express';

export function createCitationReviewContext(preferences: (userId: number) => Record<string, unknown>, localUsers: () => Array<{ id: number }>) {
  const context = new AsyncLocalStorage<{ request: express.Request; local: boolean }>();
  const scope = (local: boolean): express.RequestHandler => (request, _response, next) => context.run({ request, local }, next);
  const select = () => {
    const current = context.getStore();
    const request = current?.request as (express.Request & { user?: { id?: number } }) | undefined;
    let userId = Number(request?.user?.id);
    if (!Number.isSafeInteger(userId) || userId < 1) {
      if (!current?.local) throw new Error('Utilisateur de la vérification indisponible.');
      const users = localUsers();
      if (users.length !== 1) throw new Error('La vérification locale nécessite un seul compte PieceMaker actif.');
      userId = users[0].id;
    }
    const provider = request?.body?.provider ?? preferences(userId).selectedProvider ?? 'claude';
    if (typeof provider !== 'string') throw new TypeError('Fournisseur de vérification invalide.');
    return { provider, userId };
  };
  return { scope, select };
}
