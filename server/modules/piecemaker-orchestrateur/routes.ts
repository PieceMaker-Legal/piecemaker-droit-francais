import path from 'node:path';

import express from 'express';

import { readCasePair, writeCaseAbout, writeCaseRoadmap } from './case-pair.js';
import type { createOrchestratorService } from './service.js';

type Service = ReturnType<typeof createOrchestratorService>;
type Projects = { getProjectPaths(): Array<{ project_id: string; project_path: string }> };
type Request = express.Request & { user?: { id?: number } };

async function send(response: express.Response, run: () => unknown) {
  try {
    response.json(await run());
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : null;
    const status = typeof code === 'number' && Number.isInteger(code) && code >= 400 && code < 600 ? code : 500;
    response.status(status).json({ error: error instanceof Error ? error.message : 'Erreur du service.' });
  }
}

export function createOrchestratorRouter(service: Service, projects: Projects, brain?: { move(value: unknown): { path: string } }) {
  const router = express.Router();
  router.use(express.json({ limit: '30mb' }));

  function route(run: (root: string, request: Request) => unknown) {
    return (request: Request, response: express.Response) => send(response, () => {
      const project = request.method === 'GET' ? request.query.project : request.body?.project;
      const root = typeof project === 'string' && path.isAbsolute(project)
        && (projects.getProjectPaths().find(row => path.resolve(row.project_path) === path.resolve(project))?.project_path
          ?? (service.isCentral(project) ? project : null));
      if (!root) throw Object.assign(new Error('Dossier introuvable.'), { code: 404 });
      return run(root, request);
    });
  }

  const projectId = (root: string) => projects.getProjectPaths().find(row => path.resolve(row.project_path) === path.resolve(root))?.project_id ?? null;
  router.get('/central', (_request, response) => send(response, () => {
    const central = service.central();
    return { ...central, projectId: projectId(central.project) };
  }));
  router.put('/central/brain', (request: Request, response) => send(response, () => {
    if (!brain) throw Object.assign(new Error('Brain indisponible.'), { code: 404 });
    const wanted = typeof request.body?.path === 'string' ? path.resolve(request.body.path.trim()) : '';
    const current = service.central().project;
    if (wanted && projects.getProjectPaths().some(row => path.resolve(row.project_path) === wanted && path.resolve(row.project_path) !== path.resolve(current))) {
      throw Object.assign(new Error('Ce dossier est un dossier juridique : choisissez un dossier à part pour le brain.'), { code: 400 });
    }
    brain.move(request.body?.path);
    const central = service.central();
    return { ...central, projectId: projectId(central.project) };
  }));
  router.post('/central/session', (request: Request, response) => send(response, async () => {
    const session = await service.centralSession(request.user?.id ?? null);
    return { ...session, projectId: projectId(session.project) };
  }));
  router.get('/state', route(async (root, { user }) => {
    const state = await service.state(root, user?.id ?? null);
    return state.central ? { ...state, projectIds: Object.fromEntries(state.dossiers.map(dossier => [dossier.path, projectId(dossier.path)])) } : state;
  }));
  router.get('/session', route(root => ({ sessionId: service.sessionId(root) })));
  router.post('/session', route((root, { user }) => service.session(root, user?.id ?? null)));
  router.post('/message', route((root, { body, user }) => service.postUserMessage(root, body.text, user?.id ?? null)));
  router.post('/decision', route((root, { body }) => service.chooseDecision(root, body.decisionId, body.option)));
  router.post('/widget', route((root, { body }) => service.widgetAction(root, body.messageId, body.actionId, body.text)));
  router.post('/approval', route((root, { body }) => service.approval(root, body.messageId, body.allow)));
  router.post('/folder', route((root, { body }) => service.folder(root, body.messageId, body.allow)));
  router.post('/setup', route((root, { body }) => service.setup(root, body.messageId, body.accept)));
  router.post('/react', route((root, { body }) => service.react(root, body.messageId, body.emoji, body.on)));
  router.post('/file', route((root, { body }) => service.addFile(root, body.name, body.content)));
  router.put('/settings', route((root, { body: { project, ...settings } }) => service.updateSettings(root, settings)));
  router.put('/memory', route((root, { body }) => service.updateMemory(root, body.text, body.revision)));
  router.put('/deliverable', route((root, { body }) => service.updateDeliverable(root, body.id, body.state)));
  router.post('/thread/resolve', route((root, { body }) => service.resolveThread(root, body.threadId, body.resolved)));
  router.post('/thread/stop', route((root, { body }) => service.stopThread(root, body.threadId)));
  router.post('/schedule/cancel', route((root, { body }) => service.cancelScheduled(root, body.kind, body.id)));
  router.post('/recycle', route(root => service.recycle(root)));
  router.post('/dream', route(root => service.dream(root)));
  const caseFolder = (root: string, folder: unknown) => {
    if (!service.isCentral(root)) throw Object.assign(new Error('Réservé à l’agent central.'), { code: 403 });
    const found = typeof folder === 'string' && path.isAbsolute(folder) ? projects.getProjectPaths().find(row => path.resolve(row.project_path) === path.resolve(folder) && !service.isCentral(row.project_path)) : undefined;
    if (!found) throw Object.assign(new Error('Dossier introuvable.'), { code: 404 });
    return found.project_path;
  };
  router.get('/case', route((root, { query }) => readCasePair(caseFolder(root, query.folder))));
  router.put('/case/about', route((root, { body }) => writeCaseAbout(caseFolder(root, body.folder), body.text)));
  router.put('/case/roadmap', route((root, { body }) => writeCaseRoadmap(caseFolder(root, body.folder), body.roadmap)));
  return router;
}

export function createOrchestratorLocalRouter(service: Pick<Service, 'call'>, isLoopback: (request: express.Request) => boolean) {
  const router = express.Router();
  router.post('/orchestrateur/call', (request, response, next) => {
    if (isLoopback(request)) next();
    else response.status(403).json({ error: 'Réservé aux appels locaux.' });
  }, express.json(), (request, response) => {
    const { root, session_key, tool, args } = request.body ?? {};
    if (typeof root !== 'string' || !path.isAbsolute(root) || typeof session_key !== 'string' || typeof tool !== 'string') {
      response.status(400).json({ error: 'Dossier, clé de session et outil requis.' });
      return;
    }
    return send(response, () => service.call(root, session_key, tool, args));
  });
  return router;
}
