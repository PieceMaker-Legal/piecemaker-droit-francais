import express from 'express';

import { DocxDocumentConflictError, DocxReviewError, readDocxReview, readDocxSnapshot, runDocxReview } from '@/modules/piecemaker-docx/index.js';

type Projects = { getProjectPathById(id: string): string | null };

function respond(response: express.Response, operation: () => Promise<unknown>) {
  void Promise.resolve().then(operation).then((result) => response.json(result)).catch((error: unknown) => {
    response.status(error instanceof DocxDocumentConflictError ? 409 : error instanceof DocxReviewError ? error.status : 500)
      .json({ error: error instanceof DocxDocumentConflictError || error instanceof DocxReviewError ? error.message : 'Opération Word impossible.' });
  });
}

export function createDocxReviewRouter(projects: Projects) {
  const router = express.Router();
  router.use('/docx-review', express.json({ limit: '2mb' }));
  const projectOf = (request: express.Request) => {
    const id = typeof request.query.projectId === 'string' ? request.query.projectId : '';
    const project = projects.getProjectPathById(id);
    if (!project) throw new DocxReviewError('Dossier introuvable.', 404);
    return project;
  };
  router.get('/docx-review', (request, response) => respond(response, () => readDocxReview(projectOf(request), String(request.query.path ?? ''))));
  router.get('/docx-review/snapshot', (request, response) => {
    void Promise.resolve().then(() => readDocxSnapshot(projectOf(request), String(request.query.path ?? ''), String(request.query.id ?? '')))
      .then((bytes) => { response.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').send(bytes); })
      .catch(() => response.status(404).json({ error: 'Version introuvable.' }));
  });
  router.post('/docx-review', (request, response) => respond(response, () => {
    const filename = request.query.path;
    if (typeof filename !== 'string' || typeof request.body?.action !== 'string') throw new DocxReviewError('Document et commande requis.');
    if (request.body.author !== undefined && typeof request.body.author !== 'string') throw new DocxReviewError('Auteur invalide.');
    return runDocxReview(projectOf(request), filename, request.body);
  }));
  return router;
}
