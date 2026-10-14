import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';

import express, { type Request, type Response } from 'express';

import { projectsDb } from '@/modules/database/index.js';

export const OPEN_PANELS_FILE = 'volets-ouverts.json';

type KnownProjects = () => string[];

const defaultKnownProjects: KnownProjects = () => projectsDb.getProjectPaths().map((row) => row.project_path);

const MAX_BODY_LENGTH = 20_000;
const pendingPanelRequests = new Map<string, Array<{ id: string; tab: string; view?: string; review?: string; draft?: string; document?: string; expiresAt?: number }>>();
const deliveredPanelRequests = new Map<string, { project: string; receivedAt: number }>();

function resolveKnownProject(project: string, knownProjects: KnownProjects) {
  return knownProjects().filter((known) => project === known || project.startsWith(`${known}${path.sep}`)).sort((left, right) => right.length - left.length)[0];
}

function readStore(file: string): Record<string, unknown> {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function createOpenPanelsRouter(home: string, knownProjects: KnownProjects = defaultKnownProjects) {
  const router = express.Router();
  const file = path.join(home, OPEN_PANELS_FILE);
  let store: Record<string, unknown> | null = null;

  router.put('/volets-ouverts', (request: Request, response: Response) => {
    const { project, panels, document, focus, last } = request.body ?? {};
    if (typeof project !== 'string' || !Array.isArray(panels) || panels.some((tab) => typeof tab !== 'string')) {
      return response.status(400).json({ error: 'Invalid panels' });
    }
    if (!knownProjects().includes(project)) return response.status(404).json({ error: 'Unknown project' });
    const entry = { panels, document: typeof document === 'string' ? document : null, focus: focus && typeof focus === 'object' ? focus : {}, last: last ?? null, updatedAt: new Date().toISOString() };
    if (JSON.stringify(entry).length > MAX_BODY_LENGTH) return response.status(413).json({ error: 'Too large' });
    store ??= readStore(file);
    store[project] = entry;
    mkdirSync(home, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(store, null, 2));
    renameSync(temporary, file);
    response.json({ ok: true });
  });

  return router;
}

export function createOpenPanelRequestsRouter(knownProjects: KnownProjects = defaultKnownProjects) {
  const router = express.Router();

  router.post('/open-panel', (request: Request, response: Response) => {
    const { project, tab, view, review, draft, document } = request.body ?? {};
    if (typeof project !== 'string' || typeof tab !== 'string' || !['files', 'plugin:piecemaker-dossier', 'plugin:piecemaker-tabular-review'].includes(tab)) {
      return response.status(400).json({ error: 'Invalid panel request' });
    }
    const knownProject = resolveKnownProject(project, knownProjects);
    if (!knownProject) return response.status(404).json({ error: 'Unknown project' });
    const pending = pendingPanelRequests.get(knownProject) ?? [];
    if (pending.length >= 20) return response.status(429).json({ error: 'Too many pending panel requests' });
    const panelRequest = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      tab,
      ...(typeof view === 'string' ? { view } : {}),
      ...(typeof review === 'string' ? { review } : {}),
      ...(typeof draft === 'string' ? { draft } : {}),
      ...(typeof document === 'string' ? { document } : {}),
      expiresAt: Date.now() + 30_000,
    };
    pending.push(panelRequest);
    pendingPanelRequests.set(knownProject, pending);
    response.json({ id: panelRequest.id });
  });

  router.get('/open-panel', (request: Request, response: Response) => {
    const project = request.query.project;
    if (typeof project !== 'string') return response.status(404).json({ error: 'Unknown project' });
    const knownProject = resolveKnownProject(project, knownProjects);
    if (!knownProject) return response.status(404).json({ error: 'Unknown project' });
    if (typeof request.query.id === 'string') {
      const delivery = deliveredPanelRequests.get(request.query.id);
      deliveredPanelRequests.delete(request.query.id);
      return response.json({ received: delivery?.project === knownProject && Date.now() - delivery.receivedAt <= 30_000 });
    }
    const pending = pendingPanelRequests.get(knownProject) ?? [];
    const now = Date.now();
    const fresh = pending.filter((item) => item.expiresAt !== undefined && item.expiresAt > now);
    const panelRequest = fresh.shift() ?? null;
    if (panelRequest) {
      deliveredPanelRequests.set(panelRequest.id, { project: knownProject, receivedAt: now });
      delete panelRequest.expiresAt;
      if (fresh.length) pendingPanelRequests.set(knownProject, fresh);
      else pendingPanelRequests.delete(knownProject);
      return response.json({ request: panelRequest });
    }
    if (fresh.length) pendingPanelRequests.set(knownProject, fresh);
    else pendingPanelRequests.delete(knownProject);
    response.json({ request: null });
  });

  return router;
}
