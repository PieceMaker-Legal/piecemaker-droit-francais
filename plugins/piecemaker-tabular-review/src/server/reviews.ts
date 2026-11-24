import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { Cell, Provider, Review, ReviewDetail, ReviewDocument, ReviewRow, ReviewStatus, ReviewSummary, RowRequest, Template } from '../shared.js';
import { DOCS_FOLDER, emptyColumns, hasActions, isCaseIndex, lastSearchDate, reviewCategory, withIndexName } from '../shared.js';
import { resolveMarkdownDocument } from './documents.js';
import { assertReviewFile, docsDirectory, documentPath, isInside, reviewDirectory, toPosix, UserError, writeFileAtomic } from './paths.js';
import { HostIndexConflict, hostIndexOrigin, readHostIndex, removeHostIndex, writeHostIndex } from './host-index.js';
import type { HostIndex } from './host-index.js';
import { MAX_COLUMNS, normalizeColumn } from './templates.js';

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
  const template = /^analyse tabulaire/i.test(templateName) ? templateName : `Analyse Tabulaire ${templateName}`;
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

/** Le Case index tenu par l'hôte (SQLite), s'il porte ce nom de fichier. */
async function hostIndexOf(project: string, file: string): Promise<HostIndex | null> {
  const stored = await readHostIndex(project);
  return stored && stored.fichier === file ? stored : null;
}

export function writeNewReviewFile(project: string, review: Review): string {
  const target = uniquePath(reviewDirectory(project), reviewBasename(new Date(review.createdAt), review.templateName, review.title), '.json');
  writeFileAtomic(target, `${JSON.stringify(review, null, 2)}\n`);
  return path.basename(target);
}

/** Une nouvelle revue : le Case index va dans SQLite (l'hôte en régénère le .json), les autres revues restent des .json. */
export async function writeNewReview(project: string, review: Review): Promise<string> {
  const target = uniquePath(reviewDirectory(project), reviewBasename(new Date(review.createdAt), review.templateName, review.title), '.json');
  if (isCaseIndex(review) && hostIndexOrigin()) {
    await writeHostIndex(project, path.basename(target), review);
    return path.basename(target);
  }
  writeFileAtomic(target, `${JSON.stringify(review, null, 2)}\n`);
  return path.basename(target);
}

/** Pièce originale d'une ligne de tri : chemin relatif au dossier, sans remontée ni dossier caché. */
function piecePath(value: unknown): string {
  const piece = typeof value === 'string' ? value.trim() : '';
  if (!piece || path.posix.isAbsolute(piece) || piece.split('/').some((segment) => !segment || segment === '..' || segment.startsWith('.'))) {
    throw new UserError(`Pièce invalide : ${String(value)}`);
  }
  return piece;
}

/** Lignes prêtes à analyser ; en tri des pièces, chacune porte une seule pièce et son Markdown. */
function buildRows(project: string, rows: RowRequest[], sorting: boolean, copies = new Map<string, ReviewDocument>()): ReviewRow[] {
  const resolvedRows = rows.map((row) => {
    const documents = Array.isArray(row?.documents) ? row.documents : [];
    if (!documents.length) throw new UserError('Chaque ligne doit contenir au moins un document.');
    if (documents.length > MAX_DOCUMENTS_PER_ROW) throw new UserError(`Une ligne regroupe au plus ${MAX_DOCUMENTS_PER_ROW} documents.`);
    if (sorting && documents.length !== 1) throw new UserError('En tri des pièces, chaque ligne porte une seule pièce.');
    return {
      label: typeof row.label === 'string' ? row.label.trim().slice(0, 200) : '',
      sources: documents.map((document) => resolveMarkdownDocument(project, document)),
      ...(sorting || row.piece ? { piece: piecePath(row.piece) } : {}),
    };
  });
  return resolvedRows.map(({ label, sources, piece }) => {
    const documents = sources.map((source) => copyDocument(project, source, copies));
    return {
      id: randomUUID(),
      label: label || path.basename(documents[0].source, path.extname(documents[0].source)),
      documents,
      status: 'pending',
      ...(piece ? { piece } : {}),
    };
  });
}

export async function createReview(project: string, template: Template, title: string, rows: RowRequest[], settings: ReviewSettings): Promise<{ file: string; review: Review; created: boolean }> {
  const cleanTitle = typeof title === 'string' ? title.trim().slice(0, 120) : '';
  if (!cleanTitle) throw new UserError('Donnez un nom à l’analyse tabulaire.');
  const existing = isCaseIndex({ title: cleanTitle, templateName: template.name }) ? (await listReviews([project], () => false)).find(isCaseIndex) : undefined;
  if (existing) return { file: existing.file, review: await readReview(project, existing.file), created: false };
  if (!Array.isArray(rows) || !rows.length) throw new UserError('Sélectionnez au moins un document.');
  if (rows.length > MAX_ROWS) throw new UserError(`Une analyse tabulaire contient au plus ${MAX_ROWS} lignes.`);
  const sorting = hasActions(template.columns);
  const reviewRows = buildRows(project, rows, sorting);

  const now = new Date();
  const review: Review = {
    version: 1,
    title: cleanTitle,
    templateName: template.name,
    category: sorting ? 'tri-pieces' : 'documents',
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
  return { file: await writeNewReview(project, review), review, created: true };
}

/** Une revue : le Case index est lu dans SQLite (via l'hôte), les autres dans leur .json. */
export async function readReview(project: string, file: string): Promise<Review> {
  const stored = await hostIndexOf(project, file);
  if (stored) return withIndexName(stored.review);
  return readReviewFile(project, file);
}

export function readReviewFile(project: string, file: string): Review {
  const target = assertReviewFile(project, file);
  try {
    return withIndexName(JSON.parse(fs.readFileSync(target, 'utf8')) as Review);
  } catch {
    throw new UserError(`Analyse tabulaire illisible : ${file}`);
  }
}

export function updateReview(project: string, file: string, mutate: (review: Review) => void): Promise<Review> {
  const key = reviewKey(project, file);
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    for (let attempt = 0; ; attempt += 1) {
      const stored = await hostIndexOf(project, file);
      if (!stored) break;
      const review = withIndexName(stored.review);
      mutate(review);
      review.updatedAt = new Date().toISOString();
      try {
        await writeHostIndex(project, file, review, stored.revision);
        return review;
      } catch (error) {
        if (!(error instanceof HostIndexConflict) || attempt >= 2) throw error;
      }
    }
    const review = readReviewFile(project, file);
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

/** Ajoute à un tri des pièces les lignes des pièces nouvelles ; renvoie leurs identifiants. */
export async function appendRows(project: string, file: string, rows: RowRequest[]): Promise<string[]> {
  if (!Array.isArray(rows) || !rows.length) return [];
  let added: string[] = [];
  await updateReview(project, file, (review) => {
    const category = reviewCategory(review);
    if (category === 'recherche-juridique') throw new UserError('Une recherche juridique ne reçoit pas de documents.');
    const sorting = category === 'tri-pieces';
    const known = new Set(review.rows.map((row) => row.piece));
    const documentsKey = (documents: string[]) => JSON.stringify([...documents].sort());
    const knownDocuments = new Set(review.rows.map((row) => documentsKey(row.documents.map((document) => document.source))));
    const fresh = buildRows(project, sorting ? rows.filter((row) => !known.has(row.piece)) : rows.filter((row) => !knownDocuments.has(documentsKey(row.documents))), sorting);
    if (review.rows.length + fresh.length > MAX_ROWS) throw new UserError(`Une analyse tabulaire contient au plus ${MAX_ROWS} lignes.`);
    review.rows.push(...fresh);
    added = fresh.map((row) => row.id);
  });
  return added;
}

/** Remplace une réponse par une saisie de l'utilisateur, sans citation exigée. */
export function editCell(project: string, file: string, rowId: unknown, column: unknown, summary: unknown): Promise<Review> {
  const value = typeof summary === 'string' ? summary.trim().slice(0, 4000) : '';
  return updateReview(project, file, (review) => {
    const row = review.rows.find((entry) => entry.id === rowId);
    const target = review.columns.find((entry) => entry.index === Number(column));
    if (!row || !target) throw new UserError('Cellule introuvable.');
    if (row.status === 'running') throw new UserError('Attendez la fin de l’analyse de cette ligne pour la modifier.');
    const cells = review.cells[row.id] ?? (review.cells[row.id] = {});
    if (!value) {
      delete cells[String(target.index)];
      return;
    }
    const previous: Cell | undefined = cells[String(target.index)];
    cells[String(target.index)] = { summary: value, flag: previous?.flag ?? 'grey', reasoning: previous?.reasoning ?? '', ...(previous?.citations ? { citations: previous.citations } : {}), edited: true };
    if (!emptyColumns(review, row.id).length) Object.assign(row, { status: 'done', error: undefined });
  });
}

/** Marque une réponse comme vérifiée par l'avocat, ou retire la marque. Une nouvelle analyse de la cellule l'efface. */
export function checkCell(project: string, file: string, rowId: unknown, column: unknown, checked: unknown): Promise<Review> {
  return updateReview(project, file, (review) => {
    const row = review.rows.find((entry) => entry.id === rowId);
    const target = review.columns.find((entry) => entry.index === Number(column));
    const cell = row && target ? review.cells[row.id]?.[String(target.index)] : undefined;
    if (!row || !target || !cell) throw new UserError('Cellule introuvable.');
    if (row.status === 'running') throw new UserError('Attendez la fin de l’analyse de cette ligne pour la vérifier.');
    if (checked === false) delete cell.checked;
    else cell.checked = { at: new Date().toISOString() };
  });
}

/** Ajoute une question (colonne sans index) ou modifie celle d'une colonne. Sans titre, une question reçoit le début de son texte. */
export async function saveQuestion(project: string, file: string, column: unknown, prompt: unknown, title: unknown, format?: unknown, tags?: unknown): Promise<Review> {
  const text = typeof prompt === 'string' ? prompt.trim().slice(0, 4000) : '';
  if (!text) throw new UserError('Écrivez la question à poser.');
  const given = typeof title === 'string' ? title.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
  return updateReview(project, file, (review) => {
    if (column === undefined || column === null) {
      if (review.columns.length >= MAX_COLUMNS) throw new UserError(`Une analyse tabulaire contient au plus ${MAX_COLUMNS} questions.`);
      const index = Math.max(-1, ...review.columns.map((entry) => entry.index)) + 1;
      review.columns.push({ index, ...normalizeColumn({ name: given || text.replace(/\s+/g, ' ').slice(0, 60), prompt: text, format, tags }) });
      return;
    }
    const target = review.columns.find((entry) => entry.index === Number(column));
    if (!target) throw new UserError('Question introuvable.');
    Object.assign(target, { name: given || target.name, prompt: text });
  });
}

/** Enregistre qu'une ligne a été appliquée : la pièce porte désormais son nouveau chemin. */
export function markApplied(project: string, file: string, rowId: unknown, current: unknown, markdown: unknown): Promise<Review> {
  return updateReview(project, file, (review) => {
    const row = review.rows.find((entry) => entry.id === rowId);
    if (!row) throw new UserError('Ligne introuvable.');
    const next = piecePath(current);
    row.applied = { at: new Date().toISOString(), from: row.piece ?? row.documents[0]?.source ?? next };
    row.piece = next;
    row.label = path.posix.basename(next, path.posix.extname(next));
    if (typeof markdown === 'string' && markdown && row.documents[0]) row.documents[0].source = markdown;
  });
}

export function deriveStatus(review: Review, running: boolean): ReviewStatus {
  if (running) return 'running';
  const statuses = review.rows.map((row) => row.status);
  if (statuses.some((status) => status === 'pending' || status === 'running')) return 'interrupted';
  if (statuses.some((status) => status === 'cancelled')) return 'cancelled';
  if (statuses.some((status) => status === 'error')) return 'partial';
  return 'done';
}

export async function reviewDetail(project: string, file: string, running: boolean): Promise<ReviewDetail> {
  const review = await readReview(project, file);
  return { project, file, status: deriveStatus(review, running), review };
}

export async function listReviews(projects: string[], isRunning: (project: string, file: string) => boolean): Promise<ReviewSummary[]> {
  const summaries: ReviewSummary[] = [];
  for (const project of projects) {
    const directory = reviewDirectory(project);
    const index = await readHostIndex(project).catch(() => null);
    let files: string[];
    try {
      files = fs.readdirSync(directory).filter((file) => file.endsWith('.json') && !file.startsWith('.'));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const review = index?.fichier === file ? withIndexName(index.review) : readReviewFile(project, file);
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
          ...(review.research ? { updatable: Boolean(review.research.filters), searchedAt: lastSearchDate(review) } : {}),
        });
      } catch {
        continue;
      }
    }
  }
  return summaries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function referencedCopies(project: string, excludedFile: string): Set<string> {
  const referenced = new Set<string>();
  for (const file of fs.readdirSync(reviewDirectory(project)).filter((entry) => entry.endsWith('.json') && !entry.startsWith('.') && entry !== excludedFile)) {
    try {
      for (const row of readReviewFile(project, file).rows) for (const document of row.documents) referenced.add(document.copy);
    } catch {
      continue;
    }
  }
  return referenced;
}

export async function deleteReview(project: string, file: string): Promise<void> {
  const target = assertReviewFile(project, file);
  const review = await readReview(project, file);
  if (await hostIndexOf(project, file)) await removeHostIndex(project);
  const shared = referencedCopies(project, file);
  const docs = docsDirectory(project);
  for (const copy of new Set(review.rows.flatMap((row) => row.documents.map((document) => document.copy)))) {
    const copyPath = documentPath(project, copy);
    if (!shared.has(copy) && isInside(docs, copyPath)) fs.rmSync(copyPath, { force: true });
  }
  const basename = path.basename(file, '.json');
  for (const extension of ['docx', 'pdf']) fs.rmSync(path.join(reviewDirectory(project), `${basename}.${extension}`), { force: true });
  fs.rmSync(target);
  if (fs.existsSync(docs) && !fs.readdirSync(docs).length) fs.rmdirSync(docs);
}
