import fs from 'node:fs';
import path from 'node:path';

import type { MarkdownDocument } from '../shared.js';
import { REVIEW_FOLDER } from '../shared.js';
import { isInside, toPosix, UserError } from './paths.js';

const MAX_DOCUMENTS = 5000;
const MAX_DEPTH = 12;

export function listMarkdownDocuments(project: string): MarkdownDocument[] {
  const documents: MarkdownDocument[] = [];
  const pending: { directory: string; depth: number }[] = [{ directory: project, depth: 0 }];
  while (pending.length && documents.length < MAX_DOCUMENTS) {
    const { directory, depth } = pending.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const skipped = entry.name === 'node_modules' || (depth === 0 && entry.name === REVIEW_FOLDER);
        if (depth < MAX_DEPTH && !skipped) pending.push({ directory: absolute, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      try {
        const stats = fs.statSync(absolute);
        documents.push({ path: toPosix(path.relative(project, absolute)), size: stats.size, modifiedAt: stats.mtime.toISOString() });
      } catch {
        continue;
      }
      if (documents.length >= MAX_DOCUMENTS) break;
    }
  }
  return documents.sort((left, right) => left.path.localeCompare(right.path, 'fr'));
}

export function resolveMarkdownDocument(project: string, relative: unknown): string {
  if (typeof relative !== 'string' || !relative.toLowerCase().endsWith('.md')) throw new UserError('Seuls les documents Markdown (.md) peuvent être analysés.');
  const absolute = path.resolve(project, relative);
  if (!isInside(project, absolute)) throw new UserError(`Document hors du dossier : ${relative}`);
  const segments = path.relative(project, absolute).split(path.sep);
  if (segments.some((segment) => segment.startsWith('.')) || segments[0] === REVIEW_FOLDER) throw new UserError(`Document non autorisé : ${relative}`);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new UserError(`Document introuvable : ${relative}`);
  return absolute;
}
