import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';

import express, { type Request, type Response } from 'express';

import { projectsDb } from '@/modules/database/index.js';

export const OPEN_PANELS_FILE = 'volets-ouverts.json';

type KnownProjects = () => string[];

const defaultKnownProjects: KnownProjects = () => projectsDb.getProjectPaths().map((row) => row.project_path);

const MAX_BODY_LENGTH = 20_000;
const ALLOWED_TABS = ['files', 'plugin:piecemaker-dossier', 'plugin:piecemaker-tabular-review', 'plugin:piecemaker-tampon'];
type PanelRequest = { id: string; tab: string; view?: string; review?: string; draft?: string; document?: string; expiresAt?: number };
type Delivery = { project: string; receivedAt: number; completedAt?: number };

const pendingPanelRequests = new Map<string, PanelRequest[]>();
const deliveredPanelRequests = new Map<string, Delivery>();
const pendingCloseRequests = new Map<string, PanelRequest[]>();
const deliveredCloseRequests = new Map<string, Delivery>();

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

function pruneDelivered(store: Map<string, Delivery>, now: number) {
  for (const [id, delivery] of store) {
    if (now - delivery.receivedAt > 30_000) store.delete(id);
  }
}

function enqueueRequest(
  pendingStore: Map<string, PanelRequest[]>,
  deliveredStore: Map<string, Delivery>,
  knownProject: string,
  fields: { tab: string; view?: string; review?: string; draft?: string; document?: string },
) {
  const now = Date.now();
  pruneDelivered(deliveredStore, now);
  const pending = pendingStore.get(knownProject) ?? [];
  if (pending.length >= 20) return null;
  const panelRequest: PanelRequest = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    tab: fields.tab,
    ...(typeof fields.view === 'string' ? { view: fields.view } : {}),
    ...(typeof fields.review === 'string' ? { review: fields.review } : {}),
    ...(typeof fields.draft === 'string' ? { draft: fields.draft } : {}),
    ...(typeof fields.document === 'string' ? { document: fields.document } : {}),
    expiresAt: now + 30_000,
  };
  pending.push(panelRequest);
  pendingStore.set(knownProject, pending);
  return panelRequest;
}

function takeRequest(
  pendingStore: Map<string, PanelRequest[]>,
  deliveredStore: Map<string, Delivery>,
  knownProject: string,
) {
  const pending = pendingStore.get(knownProject) ?? [];
  const now = Date.now();
  const fresh = pending.filter((item) => item.expiresAt !== undefined && item.expiresAt > now);
  const panelRequest = fresh.shift() ?? null;
  if (panelRequest) {
    deliveredStore.set(panelRequest.id, { project: knownProject, receivedAt: now });
    delete panelRequest.expiresAt;
  }
  if (fresh.length) pendingStore.set(knownProject, fresh);
  else pendingStore.delete(knownProject);
  return panelRequest;
}

function acknowledgeRequest(deliveredStore: Map<string, Delivery>, knownProject: string, id: string) {
  const delivery = deliveredStore.get(id);
  if (!delivery || delivery.project !== knownProject || Date.now() - delivery.receivedAt > 30_000) return false;
  delivery.completedAt = Date.now();
  return true;
}

function completedRequest(deliveredStore: Map<string, Delivery>, knownProject: string, id: string) {
  const delivery = deliveredStore.get(id);
  const fresh = delivery?.project === knownProject && Date.now() - delivery.receivedAt <= 30_000;
  if (delivery && !fresh) deliveredStore.delete(id);
  return Boolean(fresh && delivery.completedAt !== undefined);
}

export function createOpenPanelRequestsRouter(knownProjects: KnownProjects = defaultKnownProjects) {
  const router = express.Router();

  router.post('/open-panel', (request: Request, response: Response) => {
    const { project, tab, view, review, draft, document } = request.body ?? {};
    if (typeof project !== 'string' || typeof tab !== 'string' || !ALLOWED_TABS.includes(tab)) {
      return response.status(400).json({ error: 'Invalid panel request' });
    }
    const knownProject = resolveKnownProject(project, knownProjects);
    if (!knownProject) return response.status(404).json({ error: 'Unknown project' });
    const panelRequest = enqueueRequest(pendingPanelRequests, deliveredPanelRequests, knownProject, {
      tab,
      ...(typeof view === 'string' ? { view } : {}),
      ...(typeof review === 'string' ? { review } : {}),
      ...(typeof draft === 'string' ? { draft } : {}),
      ...(typeof document === 'string' ? { document } : {}),
    });
    if (!panelRequest) return response.status(429).json({ error: 'Too many pending panel requests' });
    response.json({ id: panelRequest.id });
  });

  router.get('/open-panel', (request: Request, response: Response) => {
    const project = request.query.project;
    if (typeof project !== 'string') return response.status(404).json({ error: 'Unknown project' });
    const knownProject = resolveKnownProject(project, knownProjects);
    if (!knownProject) return response.status(404).json({ error: 'Unknown project' });
    if (typeof request.query.id === 'string') {
      return response.json({ completed: completedRequest(deliveredPanelRequests, knownProject, request.query.id) });
    }
    response.json({ request: takeRequest(pendingPanelRequests, deliveredPanelRequests, knownProject) });
  });

  router.post('/open-panel/ack', (request: Request, response: Response) => {
    const { project, id } = request.body ?? {};
    if (typeof project !== 'string' || typeof id !== 'string') return response.status(400).json({ error: 'Invalid panel acknowledgement' });
    const knownProject = resolveKnownProject(project, knownProjects);
    if (!knownProject) return response.status(404).json({ error: 'Unknown project' });
    return response.json({ acknowledged: acknowledgeRequest(deliveredPanelRequests, knownProject, id) });
  });

  router.post('/close-panel', (request: Request, response: Response) => {
    const { project, tab, document } = request.body ?? {};
    if (typeof project !== 'string' || typeof tab !== 'string' || !ALLOWED_TABS.includes(tab)) {
      return response.status(400).json({ error: 'Invalid panel close request' });
    }
    const knownProject = resolveKnownProject(project, knownProjects);
    if (!knownProject) return response.status(404).json({ error: 'Unknown project' });
    const panelRequest = enqueueRequest(pendingCloseRequests, deliveredCloseRequests, knownProject, {
      tab,
      ...(typeof document === 'string' ? { document } : {}),
    });
    if (!panelRequest) return response.status(429).json({ error: 'Too many pending panel requests' });
    response.json({ id: panelRequest.id });
  });

  router.get('/close-panel', (request: Request, response: Response) => {
    const project = request.query.project;
    if (typeof project !== 'string') return response.status(404).json({ error: 'Unknown project' });
    const knownProject = resolveKnownProject(project, knownProjects);
    if (!knownProject) return response.status(404).json({ error: 'Unknown project' });
    if (typeof request.query.id === 'string') {
      return response.json({ completed: completedRequest(deliveredCloseRequests, knownProject, request.query.id) });
    }
    response.json({ request: takeRequest(pendingCloseRequests, deliveredCloseRequests, knownProject) });
  });

  router.post('/close-panel/ack', (request: Request, response: Response) => {
    const { project, id } = request.body ?? {};
    if (typeof project !== 'string' || typeof id !== 'string') return response.status(400).json({ error: 'Invalid panel acknowledgement' });
    const knownProject = resolveKnownProject(project, knownProjects);
    if (!knownProject) return response.status(404).json({ error: 'Unknown project' });
    return response.json({ acknowledged: acknowledgeRequest(deliveredCloseRequests, knownProject, id) });
  });

  return router;
}
