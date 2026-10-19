import express from 'express';

import { reasoningExample } from './program.js';
import type { createReasoningService } from './program.js';

export function createReasoningRouter(service: ReturnType<typeof createReasoningService>, cite: (cwd: string, id: string, quote: string) => Promise<string>) {
  const router = express.Router();
  const fail = (response: express.Response, error: unknown) => response.status(400).json({ error: error instanceof Error ? error.message : 'Raisonnement indisponible.' });
  const handle = (run: (body: Record<string, unknown>) => unknown) => async (request: express.Request, response: express.Response) => {
    try {
      const body = { ...request.query, ...(request.body ?? {}) } as Record<string, unknown>;
      if (typeof body.projectPath !== 'string') throw new TypeError('projectPath requis.');
      response.json(await run(body));
    } catch (error) { fail(response, error); }
  };
  router.get('/example', (_request, response) => { reasoningExample().then((snapshot) => response.json(snapshot), (error: unknown) => fail(response, error)); });
  router.get('/', handle((body) => service.read(body.projectPath as string)));
  router.post('/citation', express.json(), handle(async (body) => {
    if (typeof body.source !== 'string' || typeof body.citation !== 'string') throw new TypeError('source et citation requis.');
    return { token: await cite(body.projectPath as string, body.source, body.citation) };
  }));
  router.post('/verify', express.json(), handle((body) => service.verify(body.projectPath as string)));
  router.post('/simulate', express.json(), handle((body) => service.simulate(body.projectPath as string, body.faits)));
  router.post('/test', express.json(), (request, response) => {
    const { projectPath } = request.body ?? {};
    if (typeof projectPath !== 'string') { fail(response, new TypeError('projectPath requis.')); return; }
    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache');
    response.flushHeaders();
    const write = (line: object) => response.write(`${JSON.stringify(line)}\n`);
    service.test(projectPath, (entry) => write({ entry }))
      .then((snapshot) => write({ snapshot }), (error: unknown) => write({ error: error instanceof Error ? error.message : 'Test impossible.' }))
      .finally(() => response.end());
  });
  router.post('/dismiss', express.json(), handle((body) => {
    if (typeof body.id !== 'string') throw new TypeError('id requis.');
    return service.dismiss(body.projectPath as string, body.id, body.restore === true);
  }));
  router.post('/reliability', express.json(), handle((body) => {
    if (typeof body.piece !== 'string' || ![true, false, null].includes(body.reliable as boolean | null)) throw new TypeError('piece et reliable (true, false ou null) requis.');
    return service.rate(body.projectPath as string, body.piece, body.reliable as boolean | null);
  }));
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
