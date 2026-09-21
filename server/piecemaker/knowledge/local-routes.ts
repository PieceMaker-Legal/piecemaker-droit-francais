import express from 'express';

import type { createKnowledgeService } from './service.js';

type KnowledgeService = ReturnType<typeof createKnowledgeService>;

type ProjectPathLookup = {
  getProjectPath(projectPath: string): { project_id: string; project_path: string } | null;
};

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLoopback(request: express.Request): boolean {
  return LOOPBACK_ADDRESSES.has(request.socket.remoteAddress || '');
}

function statusFor(error: unknown): number {
  if (error instanceof TypeError) return 400;
  if (error instanceof Error && error.message === 'Project not found.') return 404;
  return 500;
}

export function createKnowledgeLocalRouter(
  getService: () => KnowledgeService,
  projects: ProjectPathLookup,
) {
  const router = express.Router();

  router.use((request, response, next) => {
    if (!isLoopback(request)) {
      response.status(403).json({ error: 'Local scan is restricted to loopback callers.' });
      return;
    }
    next();
  });

  const resolveProjectId = (body: unknown): string => {
    const source = (body ?? {}) as { projectId?: unknown; folder?: unknown };
    if (typeof source.projectId === 'string' && source.projectId.trim()) return source.projectId.trim();
    if (typeof source.folder !== 'string' || !source.folder.trim()) {
      throw new TypeError('folder or projectId is required.');
    }
    const project = projects.getProjectPath(source.folder.trim());
    if (!project) throw new Error('Project not found.');
    return project.project_id;
  };

  const respond = (operation: () => unknown | Promise<unknown>, response: express.Response) => {
    Promise.resolve().then(operation).then((result) => response.json(result)).catch((error: unknown) => {
      response.status(statusFor(error)).json({ error: error instanceof Error ? error.message : 'Local scan failed.' });
    });
  };

  router.post('/scan', (request, response) => respond(() => {
    const id = resolveProjectId(request.body);
    return { projectId: id, ...getService().scan(id, request.body?.files) };
  }, response));

  router.get('/scan/job', (request, response) => respond(() => {
    const id = typeof request.query.projectId === 'string' && request.query.projectId.trim()
      ? request.query.projectId.trim()
      : resolveProjectId({ folder: request.query.folder });
    return { projectId: id, ...getService().scanJob(request.query.id, id) };
  }, response));

  router.post('/scan/cancel', (request, response) => respond(() => {
    const id = resolveProjectId(request.body);
    return { projectId: id, ...getService().cancelScan(request.body?.id, id) };
  }, response));

  return router;
}
