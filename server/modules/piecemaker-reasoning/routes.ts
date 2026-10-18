import express from 'express';

import { reasoningExample } from './program.js';
import type { createReasoningService } from './program.js';

export function createReasoningRouter(service: ReturnType<typeof createReasoningService>) {
  const router = express.Router();
  const fail = (response: express.Response, error: unknown) => response.status(400).json({ error: error instanceof Error ? error.message : 'Raisonnement indisponible.' });
  router.get('/example', (_request, response) => response.json(reasoningExample()));
  router.get('/', (request, response) => {
    try {
      if (typeof request.query.projectPath !== 'string') throw new TypeError('projectPath requis.');
      response.json(service.read(request.query.projectPath));
    } catch (error) { fail(response, error); }
  });
  router.post('/review', express.json(), (request, response) => {
    try {
      const { projectPath, id, status, note } = request.body ?? {};
      if (typeof projectPath !== 'string' || typeof id !== 'string') throw new TypeError('projectPath et id requis.');
      response.json(service.review(projectPath, id, status ?? null, note));
    } catch (error) { fail(response, error); }
  });
  router.post('/appreciation', express.json(), (request, response) => {
    try {
      const { projectPath, id, value, force, appreciation, note } = request.body ?? {};
      if (typeof projectPath !== 'string' || typeof id !== 'string') throw new TypeError('projectPath et id requis.');
      response.json(service.appreciate(projectPath, id, { value, force: force ?? null, appreciation: appreciation ?? '', note }));
    } catch (error) { fail(response, error); }
  });
  router.post('/test', express.json(), (request, response) => {
    const { projectPath } = request.body ?? {};
    if (typeof projectPath !== 'string') { fail(response, new TypeError('projectPath requis.')); return; }
    service.test(projectPath).then((snapshot) => response.json(snapshot), (error: unknown) => fail(response, error));
  });
  return router;
}

export function createReasoningLocalRouter(service: ReturnType<typeof createReasoningService>, isLoopback: (request: express.Request) => boolean) {
  const router = express.Router();
  router.post('/reasoning', express.json(), (request, response) => {
    if (!isLoopback(request)) { response.status(403).json({ erreur: 'Réservé aux appels locaux.' }); return; }
    const { cwd, ...input } = request.body ?? {};
    if (typeof cwd !== 'string' || !cwd) { response.status(400).json({ erreur: 'cwd requis.' }); return; }
    service.command(cwd, input).then((resultat) => response.json({ resultat }), (error: unknown) => response.status(400).json({ erreur: error instanceof Error ? error.message : 'Commande impossible.' }));
  });
  return router;
}
