import express from 'express';

import type { createReasoningService } from '../modules/piecemaker-reasoning/program.js';

import { runActeAction } from './acte-files.js';

export function createActeLocalRouter(reasoning: ReturnType<typeof createReasoningService>, isLocal: (request: express.Request) => boolean) {
  const router = express.Router();
  router.post('/acte', express.json({ limit: '1mb' }), async (request, response) => {
    if (!isLocal(request)) return response.status(403).json({ erreur: 'Réservé aux appels locaux.' });
    try { response.json({ resultat: await runActeAction(request.body, (cwd, name) => reasoning.verify(cwd, true, undefined, name)) }); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      response.status(code === 'ENOENT' ? 404 : error instanceof TypeError || error instanceof SyntaxError ? 400 : 500).json({ erreur: error instanceof Error ? error.message : 'Opération sur l’acte impossible.' });
    }
  });
  return router;
}
