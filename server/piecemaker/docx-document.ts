import { randomUUID } from 'crypto';
import { open, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import path from 'path';

import express, { type Request, type Response } from 'express';

import { projectsDb } from '@/modules/database/index.js';

import { externalRegularFile } from './file-links.js';
import { checkDocxReasoning } from './docx-reasoning-check.js';
import { readDocxReasoning } from './docx-reasoning.js';
import { modelHash, readReferencedModel } from './docx-reasoning-reference.js';
import type { DocxModelReference } from './docx-reasoning-reference.js';

const MAX_DOCX_BYTES = '100mb';

function reasoningCwd(request: Request): string {
  return typeof request.query.projectId === 'string' ? projectsDb.getProjectPathById(request.query.projectId) ?? '' : '';
}

async function resolveDocxPath(request: Request): Promise<string | null> {
  const projectId = typeof request.query.projectId === 'string' ? request.query.projectId : '';
  const filePath = typeof request.query.path === 'string' ? request.query.path : '';
  const projectRoot = projectId ? projectsDb.getProjectPathById(projectId) : null;
  if (!projectRoot || !filePath.toLowerCase().endsWith('.docx')) return null;
  const resolved = path.resolve(projectRoot, filePath);
  return resolved.startsWith(path.resolve(projectRoot) + path.sep) ? resolved : externalRegularFile(projectRoot, filePath);
}

async function readVersion(filePath: string): Promise<number> {
  return (await stat(filePath)).mtimeMs;
}

export function createDocxDocumentRouter() {
  const router = express.Router();
  const references = new Map<string, { version: number; reference: DocxModelReference | null }>();
  const reasoningVersion = async (filePath: string, cwd: string, version: number, bytes?: Uint8Array, verified = false) => {
    let cached = references.get(filePath);
    if (!cached || cached.version !== version) {
      let reference: DocxModelReference | null = null;
      try {
        const model = await readDocxReasoning(bytes ?? await readFile(filePath));
        if (model.version === 2) reference = model.reference;
      } catch {}
      cached = { version, reference };
      if (references.size >= 64) references.delete(references.keys().next().value!);
      references.set(filePath, cached);
    }
    if (!cached.reference) return null;
    if (verified) return cached.reference.sha256;
    try { return (await readReferencedModel(cwd, cached.reference)).sha256; }
    catch (error) { return `error:${modelHash(error instanceof Error ? error.message : String(error))}`; }
  };

  router.get('/docx-document/version', async (request: Request, response: Response) => {
    const filePath = await resolveDocxPath(request);
    if (!filePath) return response.status(400).json({ error: 'Invalid docx path' });
    try {
      const version = await readVersion(filePath);
      response.json({ version, reasoningVersion: await reasoningVersion(filePath, reasoningCwd(request), version) });
    } catch {
      response.status(404).json({ error: 'File not found' });
    }
  });

  router.get('/docx-document/reasoning', async (request: Request, response: Response) => {
    const filePath = await resolveDocxPath(request);
    if (!filePath) return response.status(400).json({ error: 'Invalid docx path' });
    try {
      const file = await open(filePath, 'r');
      try {
        const version = (await file.stat()).mtimeMs;
        const bytes = await file.readFile();
        const reasoning = await checkDocxReasoning(bytes, reasoningCwd(request));
        response.json({ version, reasoning, reasoningVersion: await reasoningVersion(filePath, reasoningCwd(request), version, bytes, reasoning.status === 'tested') });
      } finally { await file.close(); }
    } catch {
      response.status(404).json({ error: 'File not found' });
    }
  });

  router.put('/docx-document', express.raw({ type: () => true, limit: MAX_DOCX_BYTES }), async (request: Request, response: Response) => {
    const filePath = await resolveDocxPath(request);
    if (!filePath || !Buffer.isBuffer(request.body) || request.body.length === 0) {
      return response.status(400).json({ error: 'Invalid docx payload' });
    }
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, request.body);
      const version = await readVersion(temporaryPath);
      await rename(temporaryPath, filePath);
      const reasoning = await checkDocxReasoning(request.body, reasoningCwd(request));
      response.json({ version, reasoning, reasoningVersion: await reasoningVersion(filePath, reasoningCwd(request), version, request.body, reasoning.status === 'tested') });
    } catch (error) {
      await rm(temporaryPath, { force: true });
      response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
