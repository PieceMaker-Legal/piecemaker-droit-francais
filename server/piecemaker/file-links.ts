import { createReadStream } from 'fs';
import { readdir, readFile, realpath, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import express, { type NextFunction, type Request, type Response } from 'express';
import mime from 'mime-types';

import { projectsDb } from '@/modules/database/index.js';

type ProjectRoot = (projectId: string) => string | null;

const defaultProjectRoot: ProjectRoot = (projectId) => projectsDb.getProjectPathById(projectId);

const MAX_REFS = 200;
const INDEX_TTL_MS = 10_000;
const MAX_INDEXED_ENTRIES = 50_000;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);

/**
 * Ramène une citation de fichier à un chemin : `file://`, `~`, et les suffixes
 * de position reconnus par les liens fichier de VS Code (`:12`, `:12:3`,
 * `:line 12, column 3`) ou par GitHub (`#L12`, `#L12-34`, `#L12-L34`).
 */
export function normalizeFileRef(raw: string, home = os.homedir()): string {
  let ref = raw.trim();
  if (ref.startsWith('file://')) {
    try {
      ref = fileURLToPath(ref);
    } catch {
      return '';
    }
  }
  ref = ref
    .replace(/#L\d+(?:-L?\d+)?$/, '')
    .replace(/:line \d+(?:, column \d+)?$/, '')
    .replace(/:\d+(?::\d+)?$/, '');
  if (ref === '~') return home;
  if (ref.startsWith('~/')) return path.join(home, ref.slice(2));
  return ref;
}

async function regularFile(candidate: string): Promise<string | null> {
  try {
    const resolved = await realpath(candidate);
    return (await stat(resolved)).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

type NameIndex = { complete: boolean; byName: Map<string, string[]> };

const nameIndexes = new Map<string, { builtAt: number; index: Promise<NameIndex> }>();

async function buildNameIndex(root: string): Promise<NameIndex> {
  const byName = new Map<string, string[]>();
  const pending = [root];
  let entries = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (++entries > MAX_INDEXED_ENTRIES) return { complete: false, byName };
      const childPath = path.join(directory, child.name);
      if (child.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(child.name)) pending.push(childPath);
        continue;
      }
      const paths = byName.get(child.name) ?? [];
      paths.push(childPath);
      byName.set(child.name, paths);
    }
  }
  return { complete: true, byName };
}

function nameIndex(root: string): Promise<NameIndex> {
  const cached = nameIndexes.get(root);
  if (cached && Date.now() - cached.builtAt < INDEX_TTL_MS) return cached.index;
  const index = buildNameIndex(root);
  nameIndexes.set(root, { builtAt: Date.now(), index });
  return index;
}

/** Un nom seul n'est un lien que s'il désigne un seul fichier du dossier (lien « mot » de VS Code). */
async function uniqueByName(root: string, name: string): Promise<string | null> {
  const index = await nameIndex(root);
  const matches = index.byName.get(name) ?? [];
  return index.complete && matches.length === 1 ? regularFile(matches[0]) : null;
}

/**
 * Chemin réel d'un fichier régulier cité, ou `null`. Un chemin absolu est
 * vérifié où qu'il soit ; un chemin relatif l'est depuis la racine du dossier ;
 * un nom seul introuvable à la racine doit y être unique.
 */
export async function resolveFileRef(projectRoot: string | null, raw: string, home = os.homedir()): Promise<string | null> {
  const ref = normalizeFileRef(raw, home);
  if (!ref || ref.includes('\0')) return null;
  if (path.isAbsolute(ref)) return regularFile(ref);
  if (!projectRoot) return null;
  const relative = await regularFile(path.resolve(projectRoot, ref));
  if (relative || /[\\/]/.test(ref)) return relative;
  return uniqueByName(projectRoot, ref);
}

export function createFileLinksRouter(projectRoot: ProjectRoot = defaultProjectRoot) {
  const router = express.Router();

  router.post('/file-links/resolve', async (request: Request, response: Response) => {
    const { projectId, refs } = request.body ?? {};
    if (!Array.isArray(refs) || refs.length > MAX_REFS || refs.some((ref) => typeof ref !== 'string')) {
      return response.status(400).json({ error: 'Invalid refs' });
    }
    const root = typeof projectId === 'string' && projectId ? projectRoot(projectId) : null;
    response.json({ paths: await Promise.all(refs.map((ref: string) => resolveFileRef(root, ref))) });
  });

  return router;
}

/**
 * Lecture et enregistrement, dans la visionneuse normale, d'un fichier situé
 * hors du dossier ouvert. Monté devant les routes file-tree de CloudCLI : il
 * ne prend que les chemins absolus que celles-ci refuseraient, et laisse passer
 * tout le reste (`next()`).
 */
export function createExternalFileRouter(projectRoot: ProjectRoot = defaultProjectRoot) {
  const router = express.Router();

  const externalFile = async (request: Request, candidate: unknown) => (
    typeof candidate === 'string' ? externalRegularFile(projectRoot(String(request.params.projectId)), candidate) : null
  );

  router.get('/projects/:projectId/file', async (request: Request, response: Response, next: NextFunction) => {
    const file = await externalFile(request, request.query.filePath);
    if (!file) return next();
    try {
      response.json({ content: await readFile(file, 'utf8'), path: file });
    } catch {
      response.status(404).json({ error: 'File not found' });
    }
  });

  router.get('/projects/:projectId/files/content', async (request: Request, response: Response, next: NextFunction) => {
    const file = await externalFile(request, request.query.path);
    if (!file) return next();
    response.setHeader('Content-Type', mime.lookup(file) || 'application/octet-stream');
    const stream = createReadStream(file);
    stream.on('error', () => {
      if (!response.headersSent) response.status(404).json({ error: 'File not found' });
      else response.end();
    });
    stream.pipe(response);
  });

  router.put('/projects/:projectId/file', async (request: Request, response: Response, next: NextFunction) => {
    const { filePath, content } = request.body ?? {};
    const file = await externalFile(request, filePath);
    if (!file) return next();
    if (typeof content !== 'string') return response.status(400).json({ error: 'Content must be a string' });
    try {
      await writeFile(file, content, 'utf8');
      response.json({ success: true, path: file, message: 'File saved successfully' });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

/** Chemin d'un fichier existant hors du dossier, pour la visionneuse docx. */
export async function externalRegularFile(projectRoot: string | null, candidate: string): Promise<string | null> {
  if (!path.isAbsolute(candidate)) return null;
  if (projectRoot && path.resolve(candidate).startsWith(path.resolve(projectRoot) + path.sep)) return null;
  return regularFile(candidate);
}
