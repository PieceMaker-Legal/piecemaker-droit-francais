import express, { type Request, type Response } from 'express';

import type { KeepAwake } from './keep-awake.js';

export function createKeepAwakeRouter(keepAwake: KeepAwake) {
  const router = express.Router();

  router.get('/keep-awake', (_request: Request, response: Response) => {
    response.json({ active: keepAwake.active() });
  });

  router.post('/keep-awake', (request: Request, response: Response) => {
    if (typeof request.body?.enabled !== 'boolean') return response.status(400).json({ error: 'enabled attendu' });
    if (request.body.enabled) keepAwake.start();
    else keepAwake.stop();
    response.json({ active: keepAwake.active() });
  });

  return router;
}
