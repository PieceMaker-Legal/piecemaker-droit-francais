import express from 'express';

import { featureNamed } from './vendor/mcp/features/catalogue.mjs';
import { openComments } from './vendor/mcp/features/store.mjs';

type Projects = { getProjectPathById(id: string): string | null };

const STATUS: Record<string, number> = { invalid_argument: 400, conflict: 409, not_found: 404 };

export function createFeatureCommentsRouter(projects: Projects) {
  const router = express.Router();
  router.post('/feature-comments', express.json({ limit: '256kb' }), (request, response) => {
    const root = projects.getProjectPathById(typeof request.query.projectId === 'string' ? request.query.projectId : '');
    if (!root) return void response.status(404).json({ error: 'Dossier introuvable.' });
    const { feature, id, text, anchor } = request.body ?? {};
    try {
      featureNamed(String(feature));
    } catch (error) {
      return void response.status(400).json({ error: (error as Error).message });
    }
    if (typeof text !== 'string' || (id !== undefined && typeof id !== 'string') || (anchor !== undefined && (typeof anchor !== 'object' || Array.isArray(anchor)))) {
      return void response.status(400).json({ error: 'Commentaire invalide.' });
    }
    void openComments(root).open(feature, anchor ?? null, text, 'lawyer', id)
      .then((thread: unknown) => response.status(201).json(thread))
      .catch((error: { code?: string; message: string }) => response.status(STATUS[error.code ?? ''] ?? 500).json({ error: error.message }));
  });
  return router;
}
