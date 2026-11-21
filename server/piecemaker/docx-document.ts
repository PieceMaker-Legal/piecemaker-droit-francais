import path from 'path';

import express, { type Request, type Response } from 'express';

import { projectsDb } from '@/modules/database/index.js';
import { DocxDocumentConflictError, readDocxDocumentVersion, saveDocxDocument } from '@/modules/piecemaker-docx/index.js';

import { externalRegularFile } from './file-links.js';
import { openArtifacts } from './vendor/mcp/artifacts/artifacts.mjs';

const MAX_DOCX_BYTES = '100mb';

async function resolveDocxPath(request: Request): Promise<{ filePath: string; projectRoot: string } | null> {
  const projectId = typeof request.query.projectId === 'string' ? request.query.projectId : '';
  const filePath = typeof request.query.path === 'string' ? request.query.path : '';
  const projectRoot = projectId ? projectsDb.getProjectPathById(projectId) : null;
  if (!projectRoot || !filePath.toLowerCase().endsWith('.docx')) return null;
  const resolved = path.resolve(projectRoot, filePath);
  const allowedPath = resolved.startsWith(path.resolve(projectRoot) + path.sep) ? resolved : await externalRegularFile(projectRoot, filePath);
  return allowedPath ? { filePath: allowedPath, projectRoot } : null;
}

export function createDocxDocumentRouter() {
  const router = express.Router();
  router.get('/docx-document/version', async (request: Request, response: Response) => {
    const document = await resolveDocxPath(request);
    if (!document) return response.status(400).json({ error: 'Invalid docx path' });
    const { filePath, projectRoot } = document;
    try {
      const version = await readDocxDocumentVersion(filePath);
      const artifact = request.query.includeArtifact === 'true' && openArtifacts(projectRoot).hasDocument(path.relative(projectRoot, filePath));
      response.json({ version, ...(artifact && { artifact: true }) });
    } catch {
      response.status(404).json({ error: 'File not found' });
    }
  });

  router.put('/docx-document', express.raw({ type: () => true, limit: MAX_DOCX_BYTES }), async (request: Request, response: Response) => {
    const document = await resolveDocxPath(request);
    if (!document || !Buffer.isBuffer(request.body) || request.body.length === 0) {
      return response.status(400).json({ error: 'Invalid docx payload' });
    }
    const expectedVersion = request.get('If-Match');
    if (expectedVersion !== undefined && (!expectedVersion.trim() || !Number.isFinite(Number(expectedVersion)))) {
      return response.status(400).json({ error: 'Invalid document version' });
    }
    try {
      const version = await saveDocxDocument(document.filePath, request.body, expectedVersion === undefined ? undefined : Number(expectedVersion));
      response.json({ version });
    } catch (error) {
      response.status(error instanceof DocxDocumentConflictError ? 409 : 500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
