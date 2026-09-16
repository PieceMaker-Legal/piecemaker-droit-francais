import express from 'express';

import type { createKnowledgeService } from './service.js';

type KnowledgeService = ReturnType<typeof createKnowledgeService>;

function statusFor(error: unknown): number {
  if (error instanceof TypeError) return 400;
  if (error instanceof Error && error.message === 'Project not found.') return 404;
  return 500;
}

export function createKnowledgeRouter(service: KnowledgeService) {
  const router = express.Router();
  const respond = (operation: () => unknown | Promise<unknown>, response: express.Response) => {
    Promise.resolve().then(operation).then((result) => response.json(result)).catch((error: unknown) => {
      response.status(statusFor(error)).json({ error: error instanceof Error ? error.message : 'Knowledge operation failed.' });
    });
  };
  router.get('/knowledge/overview', (request, response) => respond(() => service.overview(request.query.projectId), response));
  router.get('/knowledge/mapping', (request, response) => respond(() => service.mapping(request.query.projectId), response));
  router.get('/knowledge/chronology', (request, response) => respond(() => service.chronology(request.query.projectId), response));
  router.get('/knowledge/graph', (request, response) => respond(() => service.graph(request.query.projectId), response));
  router.get('/knowledge/agents', (request, response) => respond(() => service.agents(request.query.projectId), response));
  router.post('/knowledge/query', (request, response) => respond(() => service.query(request.body), response));
  router.post('/knowledge/update', (request, response) => respond(() => service.update(request.body), response));
  router.post('/knowledge/scan', (request, response) => respond(() => service.scan(request.body?.projectId, request.body?.files), response));
  router.get('/knowledge/scan/job', (request, response) => respond(() => service.scanJob(request.query.id, request.query.projectId), response));
  return router;
}
