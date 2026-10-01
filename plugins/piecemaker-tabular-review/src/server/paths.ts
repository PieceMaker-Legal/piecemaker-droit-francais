import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DOCS_FOLDER, REVIEW_FOLDER } from '../shared.js';

export class UserError extends Error {}

export const PIECEMAKER_HOME = path.join(os.homedir(), '.piecemaker');
export const PLUGIN_HOME = path.join(PIECEMAKER_HOME, 'tabular-review');

function registrySources(file: string): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { sources?: Record<string, unknown> };
    return Object.values(parsed.sources ?? {})
      .flatMap((entries) => (Array.isArray(entries) ? entries : []))
      .filter((entry): entry is string => typeof entry === 'string' && path.isAbsolute(entry))
      .map((entry) => path.resolve(entry));
  } catch {
    return [];
  }
}

export function registeredProjects(): Set<string> {
  return new Set(registrySources(path.join(PIECEMAKER_HOME, 'projects.json')));
}

export function isProtectionLifted(project: string): boolean {
  return fs.existsSync(path.join(project, '.piecemaker', 'protection-bypass.json'));
}

export function protectedProjects(): string[] {
  const anonymized = new Set(registrySources(path.join(PIECEMAKER_HOME, 'anonymized-projects.json')));
  return [...anonymized].filter((project) => fs.existsSync(project) && !isProtectionLifted(project));
}

export function assertProject(value: unknown): string {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new UserError('Dossier invalide.');
  const project = path.resolve(value);
  if (!registeredProjects().has(project)) throw new UserError('Ce dossier n’est pas enregistré dans PieceMaker.');
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) throw new UserError('Dossier introuvable sur le disque.');
  return project;
}

export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function reviewDirectory(project: string): string {
  return path.join(project, REVIEW_FOLDER);
}

export function documentPath(project: string, copy: string): string {
  return path.join(reviewDirectory(project), ...copy.split('/'));
}

export function docsDirectory(project: string): string {
  return path.join(reviewDirectory(project), DOCS_FOLDER);
}

export function assertReviewFile(project: string, value: unknown): string {
  if (typeof value !== 'string' || !value.endsWith('.json') || value !== path.basename(value) || value.startsWith('.')) {
    throw new UserError('Tabular review invalide.');
  }
  const file = path.join(reviewDirectory(project), value);
  if (!fs.existsSync(file)) throw new UserError('Tabular review introuvable.');
  return file;
}

export function writeFileAtomic(file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, file);
}

export function toPosix(relative: string): string {
  return relative.split(path.sep).join('/');
}
