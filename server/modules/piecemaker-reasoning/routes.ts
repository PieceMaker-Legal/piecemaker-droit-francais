import express from 'express';

import { reasoningExample } from './program.js';
import type { createReasoningService } from './program.js';

export function createReasoningRouter(service: ReturnType<typeof createReasoningService>) {
  const router = express.Router();
  router.get('/example', (_request, response) => response.json(reasoningExample()));
  router.get('/', (request, response) => {
    try {
      if (typeof request.query.projectPath !== 'string') throw new TypeError('projectPath requis.');
      response.json(service.read(request.query.projectPath));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : 'Programme indisponible.' });
    }
  });
  return router;
}
