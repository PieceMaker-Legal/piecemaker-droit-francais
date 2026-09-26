import { randomUUID } from 'crypto';
import { rename, rm, stat, writeFile } from 'fs/promises';
import path from 'path';

import express, { type Request, type Response } from 'express';

import { projectsDb } from '@/modules/database/index.js';

const MAX_DOCX_BYTES = '100mb';

function resolveDocxPath(request: Request): string | null {
  const projectId = typeof request.query.projectId === 'string' ? request.query.projectId : '';
  const filePath = typeof request.query.path === 'string' ? request.query.path : '';
  const projectRoot = projectId ? projectsDb.getProjectPathById(projectId) : null;
  if (!projectRoot || !filePath.toLowerCase().endsWith('.docx')) return null;
  const resolved = path.resolve(projectRoot, filePath);
  return resolved.startsWith(path.resolve(projectRoot) + path.sep) ? resolved : null;
}

async function readVersion(filePath: string): Promise<number> {
  return (await stat(filePath)).mtimeMs;
}

export function createDocxDocumentRouter() {
  const router = express.Router();

  router.get('/docx-document/version', async (request: Request, response: Response) => {
    const filePath = resolveDocxPath(request);
    if (!filePath) return response.status(400).json({ error: 'Invalid docx path' });
    try {
      response.json({ version: await readVersion(filePath) });
    } catch {
      response.status(404).json({ error: 'File not found' });
    }
  });

  router.put('/docx-document', express.raw({ type: () => true, limit: MAX_DOCX_BYTES }), async (request: Request, response: Response) => {
    const filePath = resolveDocxPath(request);
    if (!filePath || !Buffer.isBuffer(request.body) || request.body.length === 0) {
      return response.status(400).json({ error: 'Invalid docx payload' });
    }
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, request.body);
      await rename(temporaryPath, filePath);
      response.json({ version: await readVersion(filePath) });
    } catch (error) {
      await rm(temporaryPath, { force: true });
      response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
