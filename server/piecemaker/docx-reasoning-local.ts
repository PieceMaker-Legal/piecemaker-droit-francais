import express from 'express';

import { runDocxReasoningAction } from './docx-reasoning-files.js';

export function createDocxReasoningLocalRouter(projects: { getProjectPath(folder: string): unknown }, isLocal: (request: express.Request) => boolean) {
  const router = express.Router();
  router.post('/docx-reasoning', express.json({ limit: '1mb' }), async (request, response) => {
    if (!isLocal(request)) return response.status(403).json({ erreur: 'Réservé aux appels locaux.' });
    if (typeof request.body?.cwd !== 'string' || !projects.getProjectPath(request.body.cwd)) return response.status(404).json({ erreur: 'Dossier non enregistré.' });
    try { response.json({ resultat: await runDocxReasoningAction(request.body) }); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const status = code === 'EEXIST' ? 409 : code === 'ENOENT' ? 404 : error instanceof TypeError || error instanceof SyntaxError ? 400 : 500;
      response.status(status).json({ erreur: error instanceof Error ? error.message : 'Opération DOCX impossible.' });
    }
  });
  return router;
}
