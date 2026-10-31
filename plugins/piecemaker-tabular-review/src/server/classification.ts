import fs from 'node:fs';
import path from 'node:path';

import type { ClassificationFolder, Review } from '../shared.js';
import { classificationColumn, classifyColumn, DEFAULT_CLASSIFICATION, REVIEW_FOLDER } from '../shared.js';
import { listDrafts, upsertDraft } from './drafts.js';
import { UserError, writeFileAtomic } from './paths.js';
import { listReviews, readReview, updateReview } from './reviews.js';
import { MAX_COLUMNS } from './templates.js';

const MAX_FOLDERS = 30;
const MAX_NAME = 200;
const MAX_EXPLANATION = 500;

const treeFile = (project: string) => path.join(project, '.piecemaker', 'arborescence.json');

function folderName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
  const segments = name.split('/').map((segment) => segment.trim());
  const invalid = !name || name.length > MAX_NAME || segments[0] === REVIEW_FOLDER
    || segments.some((segment) => !segment || segment.startsWith('.') || /[:*?"<>|\u0000-\u001f]/.test(segment));
  if (invalid) throw new UserError(`Nom de dossier invalide : ${String(value)}`);
  return segments.join('/');
}

function normalizeFolders(value: unknown): ClassificationFolder[] {
  if (!Array.isArray(value) || !value.length) throw new UserError('L’arborescence contient au moins un dossier.');
  if (value.length > MAX_FOLDERS) throw new UserError(`L’arborescence contient au plus ${MAX_FOLDERS} dossiers.`);
  const folders = value.map((entry) => {
    const input = (entry ?? {}) as Record<string, unknown>;
    return { name: folderName(input.name), explanation: typeof input.explanation === 'string' ? input.explanation.trim().slice(0, MAX_EXPLANATION) : '' };
  });
  if (new Set(folders.map((folder) => folder.name.toLowerCase())).size !== folders.length) throw new UserError('Deux dossiers portent le même nom.');
  return folders;
}

export function readClassification(project: string): ClassificationFolder[] {
  try {
    return normalizeFolders(JSON.parse(fs.readFileSync(treeFile(project), 'utf8')));
  } catch {
    return DEFAULT_CLASSIFICATION;
  }
}

export async function saveClassification(project: string, value: unknown): Promise<ClassificationFolder[]> {
  const folders = normalizeFolders(value);
  writeFileAtomic(treeFile(project), `${JSON.stringify(folders, null, 2)}\n`);
  for (const { file } of listReviews([project], () => false)) {
    if (!classifyColumn(readReview(project, file).columns)) continue;
    await updateReview(project, file, (review) => {
      const column = classifyColumn(review.columns);
      if (column) Object.assign(column, classificationColumn(folders, column.name));
    });
  }
  for (const draft of listDrafts([project])) {
    if (!classifyColumn(draft.columns)) continue;
    upsertDraft({ ...draft, columns: draft.columns.map((column) => (column.action === 'classify' ? classificationColumn(folders, column.name) : column)) });
  }
  return folders;
}

export function addClassification(project: string, file: string): Promise<Review> {
  const folders = readClassification(project);
  return updateReview(project, file, (review) => {
    if (classifyColumn(review.columns)) return;
    if (review.category === 'recherche-juridique') throw new UserError('Une recherche juridique ne se classe pas.');
    if (review.columns.length >= MAX_COLUMNS) throw new UserError(`Une analyse tabulaire contient au plus ${MAX_COLUMNS} questions.`);
    const index = Math.max(-1, ...review.columns.map((entry) => entry.index)) + 1;
    review.columns.push({ index, ...classificationColumn(folders) });
  });
}
