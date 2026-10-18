import express from 'express';

type SessionLookup = {
  getSessionByProviderSessionId(id: string): { project_path: string | null } | null;
  getSessionById(id: string): { project_path: string | null } | null;
};

export function createSessionDossierRouter(sessions: SessionLookup, isLoopback: (request: express.Request) => boolean) {
  const router = express.Router();
  router.get('/session-dossier', (request, response) => {
    if (!isLoopback(request)) { response.status(403).json({ erreur: 'Réservé aux appels locaux.' }); return; }
    const session = typeof request.query.session === 'string' ? request.query.session : '';
    const row = session ? sessions.getSessionByProviderSessionId(session) ?? sessions.getSessionById(session) : null;
    response.json({ dossier: row?.project_path ?? null });
  });
  return router;
}
