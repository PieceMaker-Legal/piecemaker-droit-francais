import { Router } from 'express';

import type { createCitationStore } from './citation-store.js';

export function createCitationsRouter(store: ReturnType<typeof createCitationStore>, sessionExists: (id: string) => boolean) {
  const router = Router();
  router.get('/citations/:token', async (request, response) => {
    const snapshot = await store.read(String(request.params.token), { forViewing: true });
    response.setHeader('Cache-Control', 'no-store');
    if (!snapshot || !sessionExists(snapshot.sessionId)) {
      response.status(404).json({ error: 'Source indisponible.' });
      return;
    }
    const { sessionId: _sessionId, ...source } = snapshot;
    response.json(source);
  });
  return router;
}
