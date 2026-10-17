import express from 'express';

import { checkDraft } from './draft.js';
import { reasoningExample } from './program.js';
import type { createReasoningService } from './program.js';

export function createReasoningRouter(service: ReturnType<typeof createReasoningService>) {
  const router = express.Router();
  const fail = (response: express.Response, error: unknown) => response.status(400).json({ error: error instanceof Error ? error.message : 'Programme indisponible.' });
  router.get('/example', (_request, response) => response.json(reasoningExample()));
  router.get('/', (request, response) => {
    try {
      if (typeof request.query.projectPath !== 'string') throw new TypeError('projectPath requis.');
      response.json(service.read(request.query.projectPath));
    } catch (error) { fail(response, error); }
  });
  router.post('/review', express.json(), (request, response) => {
    try {
      const { projectPath, id, decision, note } = request.body ?? {};
      if (typeof projectPath !== 'string' || typeof id !== 'string') throw new TypeError('projectPath et id requis.');
      response.json(service.review(projectPath, id, decision ?? null, note));
    } catch (error) { fail(response, error); }
  });
  router.post('/draft-check', express.json(), async (request, response) => {
    try {
      const { projectPath, file } = request.body ?? {};
      if (typeof projectPath !== 'string' || typeof file !== 'string') throw new TypeError('projectPath et file requis.');
      response.json(await checkDraft(projectPath, file, service.read(projectPath)));
    } catch (error) { fail(response, error); }
  });
  return router;
}
