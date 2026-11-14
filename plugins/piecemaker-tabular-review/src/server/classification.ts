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
const proposalFile = (project: string) => path.join(project, '.piecemaker', 'arborescence.proposition.json');

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
    const type = typeof input.type === 'string' ? input.type.trim().normalize('NFC') : '';
    if (type && (type.length > 60 || ['Premise', 'Partie', 'Non classé'].includes(type) || /[\/\\\u0000-\u001f]/.test(type))) throw new UserError('Type principal invalide.');
    return { ...(type ? { type } : {}), name: folderName(input.name), explanation: typeof input.explanation === 'string' ? input.explanation.trim().slice(0, MAX_EXPLANATION) : '' };
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
  dropClassificationProposal(project);
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

export type ClassificationProposal = { dossiers: ClassificationFolder[]; motif: string; date: string };
export type ClassificationLines = { fichier?: string; lignes: Record<string, { debut: number; fin: number }>; total: number };

export function readClassificationProposal(project: string): ClassificationProposal | null {
  try {
    const stored = JSON.parse(fs.readFileSync(proposalFile(project), 'utf8'));
    return { dossiers: normalizeFolders(stored.dossiers), motif: typeof stored.motif === 'string' ? stored.motif : '', date: typeof stored.date === 'string' ? stored.date : '' };
  } catch {
    return null;
  }
}

export function proposeClassification(project: string, value: unknown, motif: unknown): ClassificationProposal {
  const reason = typeof motif === 'string' ? motif.trim() : '';
  if (reason.length > 1000) throw new UserError('motif : 1000 caractères au plus.');
  const proposal = { dossiers: normalizeFolders(value), motif: reason, date: new Date().toISOString() };
  writeFileAtomic(proposalFile(project), `${JSON.stringify(proposal, null, 2)}\n`);
  return proposal;
}

export function dropClassificationProposal(project: string): void {
  fs.rmSync(proposalFile(project), { force: true });
}

export function classificationLines(project: string, folders: ClassificationFolder[]): ClassificationLines {
  if (!fs.existsSync(treeFile(project))) return { lignes: {}, total: 0 };
  const lines = fs.readFileSync(treeFile(project), 'utf8').replace(/\n$/, '').split('\n');
  const found: ClassificationLines['lignes'] = {};
  for (const { name } of folders) {
    const index = lines.findIndex((line) => line.trim().replace(/,$/, '') === `"name": ${JSON.stringify(name)}`);
    if (index < 0) continue;
    let start = index;
    while (start > 0 && lines[start].trim() !== '{') start -= 1;
    let end = index;
    while (end < lines.length - 1 && !lines[end].trim().startsWith('}')) end += 1;
    found[name] = { debut: start + 1, fin: end + 1 };
  }
  return { fichier: treeFile(project), lignes: found, total: lines.length };
}
