import express, { type Request, type Response } from 'express';

import type { KeepAwake } from './keep-awake.js';

export function createKeepAwakeRouter(keepAwake: KeepAwake) {
  const router = express.Router();

  router.get('/keep-awake', (_request: Request, response: Response) => {
    response.json({ active: keepAwake.active() });
  });

  router.post('/keep-awake', async (request: Request, response: Response) => {
    if (typeof request.body?.enabled !== 'boolean') return response.status(400).json({ error: 'enabled attendu' });
    try {
      if (request.body.enabled) await keepAwake.start();
      else await keepAwake.stop();
      response.json({ active: keepAwake.active() });
    } catch {
      response.status(500).json({ error: 'maintien d’éveil indisponible' });
    }
  });

  return router;
}
