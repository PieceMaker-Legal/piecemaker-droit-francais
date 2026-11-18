import fs from 'node:fs';

import type { ClassificationFolder, Review } from '../shared.js';
import { saveOntology } from '../../../../server/piecemaker/okf/ontology.js';
import { dropProposal, proposeOntology, readProposal } from '../../../../server/piecemaker/okf/ontology-proposal.js';
import { normalizeArborescence, ontologyFile, readArborescence } from '../../../../server/piecemaker/okf/sealed.js';
import { isTechnicalPath } from '../../../../server/piecemaker/vendor/piecemaker-plugin/scripts/lib/technical-paths.cjs';
import { classificationColumn, classifyColumn } from '../shared.js';
import { listDrafts, upsertDraft } from './drafts.js';
import { registeredProjects, UserError } from './paths.js';
import { listReviews, readReview, updateReview } from './reviews.js';
import { MAX_COLUMNS } from './templates.js';

// L'arborescence est commune à tous les dossiers : elle vit dans l'ontologie scellée (~/.piecemaker/ontologie.json).
// Aucun dossier de l'arborescence ne désigne un dossier technique (`.piecemaker`, pièces converties, exports…).
function normalizeFolders(value: unknown): ClassificationFolder[] {
  let folders: ClassificationFolder[];
  try {
    folders = normalizeArborescence(value);
  } catch (error) {
    throw new UserError(error instanceof Error ? error.message : String(error));
  }
  const technical = folders.find((folder) => isTechnicalPath(folder.name));
  if (technical) throw new UserError(`Nom de dossier réservé à PieceMaker : ${technical.name}`);
  return folders;
}

export function readClassification(_project?: string): ClassificationFolder[] {
  return readArborescence();
}

export async function saveClassification(project: string, value: unknown): Promise<ClassificationFolder[]> {
  const folders = normalizeFolders(value);
  saveOntology(project, { arborescence: folders });
  dropClassificationProposal();
  // L'arborescence est commune : les colonnes Classement de tous les dossiers suivent.
  const projects = [...new Set([project, ...registeredProjects()])];
  for (const { project: owner, file } of await listReviews(projects, () => false)) {
    if (!classifyColumn((await readReview(owner, file)).columns)) continue;
    await updateReview(owner, file, (review) => {
      const column = classifyColumn(review.columns);
      if (column) Object.assign(column, classificationColumn(folders, column.name));
    });
  }
  for (const draft of listDrafts(projects)) {
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

export function readClassificationProposal(_project?: string): ClassificationProposal | null {
  const pending = readProposal();
  return pending?.arborescence ? { dossiers: pending.arborescence, motif: pending.motif, date: pending.date } : null;
}

export function proposeClassification(project: string, value: unknown, motif: unknown): ClassificationProposal {
  const reason = typeof motif === 'string' ? motif.trim() : '';
  if (reason.length > 1000) throw new UserError('motif : 1000 caractères au plus.');
  const dossiers = normalizeFolders(value);
  const proposal = proposeOntology(project, { arborescence: dossiers, ...(reason ? { motif: reason } : {}) });
  return { dossiers, motif: proposal.motif, date: proposal.date };
}

export function dropClassificationProposal(_project?: string): void {
  dropProposal('arborescence');
}

/** Lignes de chaque dossier dans ontologie.json, pour que l'assistant les cite. */
export function classificationLines(_project: string, folders: ClassificationFolder[]): ClassificationLines {
  const file = ontologyFile();
  if (!fs.existsSync(file)) return { lignes: {}, total: 0 };
  const lines = fs.readFileSync(file, 'utf8').replace(/\n$/, '').split('\n');
  const from = lines.findIndex((line) => line.trim().startsWith('"arborescence"'));
  if (from < 0) return { fichier: file, lignes: {}, total: lines.length };
  const found: ClassificationLines['lignes'] = {};
  for (const { name } of folders) {
    const index = lines.findIndex((line, at) => at > from && line.trim().replace(/,$/, '') === `"name": ${JSON.stringify(name)}`);
    if (index < 0) continue;
    let start = index;
    while (start > 0 && lines[start].trim() !== '{') start -= 1;
    let end = index;
    while (end < lines.length - 1 && !lines[end].trim().startsWith('}')) end += 1;
    found[name] = { debut: start + 1, fin: end + 1 };
  }
  return { fichier: file, lignes: found, total: lines.length };
}
