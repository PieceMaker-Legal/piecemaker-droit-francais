import { Router } from 'express';

import type { createCitationStore } from './citation-store.js';
import { loadLegifranceBlocks } from './legifrance-html.js';

const TEXT_ID = /^(JURITEXT|CETATEXT|LEGIARTI)\d{12}$/;

export function createCitationsRouter(
  store: ReturnType<typeof createCitationStore>,
  sessionExists: (id: string) => boolean,
  loadBlocks: (id: string) => Promise<string[] | null> = loadLegifranceBlocks,
) {
  const router = Router();
  router.get('/citations/:token/legifrance', async (request, response) => {
    const snapshot = await store.read(String(request.params.token), { forViewing: true });
    response.setHeader('Cache-Control', 'no-store');
    const id = snapshot?.citation.decision_id ?? '';
    if (!snapshot || !sessionExists(snapshot.sessionId) || !TEXT_ID.test(id)) {
      response.status(404).json({ error: 'Page indisponible.' });
      return;
    }
    const blocks = await loadBlocks(id);
    if (!blocks?.length) {
      response.status(404).json({ error: 'Page indisponible.' });
      return;
    }
    response.json({ blocks });
  });
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
