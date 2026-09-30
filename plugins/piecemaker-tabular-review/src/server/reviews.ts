import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { Provider, Review, ReviewDetail, ReviewDocument, ReviewRow, ReviewStatus, ReviewSummary, RowRequest, Template } from '../shared.js';
import { DOCS_FOLDER, reviewCategory } from '../shared.js';
import { resolveMarkdownDocument } from './documents.js';
import { assertReviewFile, docsDirectory, reviewDirectory, toPosix, UserError, writeFileAtomic } from './paths.js';

const MAX_ROWS = 500;
const MAX_DOCUMENTS_PER_ROW = 50;

export type ReviewSettings = {
  provider: Provider;
  model: string;
  concurrency: number;
};

const locks = new Map<string, Promise<unknown>>();

export function reviewKey(project: string, file: string): string {
  return `${project}\u0000${file}`;
}

export function sanitizeFilename(value: string): string {
  return value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 180)
    .trim();
}

export function reviewBasename(date: Date, templateName: string, title: string): string {
  const stamp = [date.getFullYear() % 100, date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
  const template = /^tabular review/i.test(templateName) ? templateName : `Tabular Review ${templateName}`;
  return sanitizeFilename(`${stamp} - ${template} - ${title}`);
}

function uniquePath(directory: string, basename: string, extension: string): string {
  let candidate = path.join(directory, `${basename}${extension}`);
  for (let attempt = 2; fs.existsSync(candidate); attempt += 1) candidate = path.join(directory, `${basename} (${attempt})${extension}`);
  return candidate;
}

export function storeDocument(project: string, name: string, extension: string, content: string): string {
  const directory = docsDirectory(project);
  fs.mkdirSync(directory, { recursive: true });
  const basename = sanitizeFilename(name) || 'document';
  let target = path.join(directory, `${basename}${extension}`);
  for (let attempt = 2; fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== content; attempt += 1) {
    target = path.join(directory, `${basename} (${attempt})${extension}`);
  }
  if (!fs.existsSync(target)) fs.writeFileSync(target, content);
  return `${DOCS_FOLDER}/${path.basename(target)}`;
}

function copyDocument(project: string, source: string, copies: Map<string, ReviewDocument>): ReviewDocument {
  const existing = copies.get(source);
  if (existing) return existing;
  const content = fs.readFileSync(source, 'utf8');
  const extension = path.extname(source);
  const document = {
    source: toPosix(path.relative(project, source)),
    copy: storeDocument(project, path.basename(source, extension), extension, content),
    chars: content.length,
  };
  copies.set(source, document);
  return document;
}

export function writeNewReview(project: string, review: Review): string {
  const target = uniquePath(reviewDirectory(project), reviewBasename(new Date(review.createdAt), review.templateName, review.title), '.json');
  writeFileAtomic(target, `${JSON.stringify(review, null, 2)}\n`);
  return path.basename(target);
}

export function createReview(project: string, template: Template, title: string, rows: RowRequest[], settings: ReviewSettings): { file: string; review: Review } {
  const cleanTitle = typeof title === 'string' ? title.trim().slice(0, 120) : '';
  if (!cleanTitle) throw new UserError('Donnez un nom à la tabular review.');
  if (!Array.isArray(rows) || !rows.length) throw new UserError('Sélectionnez au moins un document.');
  if (rows.length > MAX_ROWS) throw new UserError(`Une tabular review contient au plus ${MAX_ROWS} lignes.`);
  const resolvedRows = rows.map((row) => {
    const documents = Array.isArray(row?.documents) ? row.documents : [];
    if (!documents.length) throw new UserError('Chaque ligne doit contenir au moins un document.');
    if (documents.length > MAX_DOCUMENTS_PER_ROW) throw new UserError(`Une ligne regroupe au plus ${MAX_DOCUMENTS_PER_ROW} documents.`);
    return { label: typeof row.label === 'string' ? row.label.trim().slice(0, 200) : '', sources: documents.map((document) => resolveMarkdownDocument(project, document)) };
  });

  const copies = new Map<string, ReviewDocument>();
  const reviewRows: ReviewRow[] = resolvedRows.map(({ label, sources }) => {
    const documents = sources.map((source) => copyDocument(project, source, copies));
    return {
      id: randomUUID(),
      label: label || path.basename(documents[0].source, path.extname(documents[0].source)),
      documents,
      status: 'pending',
    };
  });

  const now = new Date();
  const review: Review = {
    version: 1,
    title: cleanTitle,
    templateName: template.name,
    category: 'documents',
    projectPath: project,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    provider: settings.provider,
    model: settings.model,
    concurrency: settings.concurrency,
    columns: template.columns.map((column, index) => ({ ...column, index })),
    rows: reviewRows,
    cells: {},
  };
  return { file: writeNewReview(project, review), review };
}

export function readReview(project: string, file: string): Review {
  const target = assertReviewFile(project, file);
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8')) as Review;
  } catch {
    throw new UserError(`Tabular review illisible : ${file}`);
  }
}

export function updateReview(project: string, file: string, mutate: (review: Review) => void): Promise<Review> {
  const key = reviewKey(project, file);
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => {
    const review = readReview(project, file);
    mutate(review);
    review.updatedAt = new Date().toISOString();
    writeFileAtomic(assertReviewFile(project, file), `${JSON.stringify(review, null, 2)}\n`);
    return review;
  });
  locks.set(key, next);
  void next.finally(() => {
    if (locks.get(key) === next) locks.delete(key);
  }).catch(() => undefined);
  return next;
}

export function deriveStatus(review: Review, running: boolean): ReviewStatus {
  if (running) return 'running';
  const statuses = review.rows.map((row) => row.status);
  if (statuses.some((status) => status === 'pending' || status === 'running')) return 'interrupted';
  if (statuses.some((status) => status === 'cancelled')) return 'cancelled';
  if (statuses.some((status) => status === 'error')) return 'partial';
  return 'done';
}

export function reviewDetail(project: string, file: string, running: boolean): ReviewDetail {
  const review = readReview(project, file);
  return { project, file, status: deriveStatus(review, running), review };
}

export function listReviews(projects: string[], isRunning: (project: string, file: string) => boolean): ReviewSummary[] {
  const summaries: ReviewSummary[] = [];
  for (const project of projects) {
    const directory = reviewDirectory(project);
    let files: string[];
    try {
      files = fs.readdirSync(directory).filter((file) => file.endsWith('.json') && !file.startsWith('.'));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const review = readReview(project, file);
        if (review.version !== 1 || !Array.isArray(review.rows)) continue;
        summaries.push({
          project,
          file,
          title: review.title,
          templateName: review.templateName,
          category: reviewCategory(review),
          ...(review.research ? { query: review.research.query } : {}),
          createdAt: review.createdAt,
          status: deriveStatus(review, isRunning(project, file)),
          rowCount: review.rows.length,
          doneCount: review.rows.filter((row) => row.status === 'done').length,
          columnCount: review.columns.length,
          provider: review.provider,
          model: review.model,
        });
      } catch {
        continue;
      }
    }
  }
  return summaries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
