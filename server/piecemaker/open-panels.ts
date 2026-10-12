import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';

import express, { type Request, type Response } from 'express';

import { projectsDb } from '@/modules/database/index.js';

export const OPEN_PANELS_FILE = 'volets-ouverts.json';

type KnownProjects = () => string[];

const defaultKnownProjects: KnownProjects = () => projectsDb.getProjectPaths().map((row) => row.project_path);

const MAX_BODY_LENGTH = 20_000;

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
