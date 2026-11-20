import fs from 'node:fs';
import path from 'node:path';

import { REVIEW_FOLDER, cellAuthor, documentTitleCell, isPositiveCell, sameDocument } from '../../../plugins/piecemaker-tabular-review/src/shared.js';
import type { Review, ReviewRow } from '../../../plugins/piecemaker-tabular-review/src/shared.js';

import { squash, text } from './bundle.js';

export type ReviewAuthor = 'human' | 'agent';
/** Une ligne positive d'une revue liée : une pièce qui établit la prémisse, signée de son auteur. */
export type ReviewRowPiece = { row: string; label: string; resource: string; value: string; citation: string; author: ReviewAuthor; checkedAt?: string };
export type ReviewLinkView = { fichier: string; titre: string; colonne: number; question: string; by: string; at: string; lignes: ReviewRowPiece[]; erreur?: string };
export type ReviewCatalogEntry = { fichier: string; titre: string; colonnes: Array<{ index: number; nom: string; format: string }> };

const isReview = (value: unknown): value is Review => Boolean(value) && Array.isArray((value as Review).columns) && Array.isArray((value as Review).rows);

/** Le nom d'un fichier de revue : un .json posé à la racine du dossier des revues. */
export function reviewFileName(value: unknown): string {
  const name = text(value).replace(/^.*[\\/]/, '');
  if (!name || !name.endsWith('.json') || name.startsWith('.')) throw new TypeError(`revue : donner le nom du fichier .json de la revue tabulaire (dossier « ${REVIEW_FOLDER} »).`);
  return name;
}

function readReviewFile(projectPath: string, file: string): Review | null {
  const filePath = path.join(projectPath, REVIEW_FOLDER, file);
  if (!fs.existsSync(filePath)) return null;
  try {
    const review = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return isReview(review) ? review : null;
  } catch {
    return null;
  }
}

/** Les revues qu'on peut lier à une prémisse : celles qui portent sur les pièces du dossier. */
export function reviewCatalog(projectPath: string): ReviewCatalogEntry[] {
  const directory = path.join(projectPath, REVIEW_FOLDER);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => name.endsWith('.json') && !name.startsWith('.')).sort().flatMap((fichier) => {
    const review = readReviewFile(projectPath, fichier);
    if (!review || review.category === 'recherche-juridique') return [];
    return [{ fichier, titre: text(review.title) || fichier, colonnes: review.columns.map((column) => ({ index: column.index, nom: text(column.name), format: column.format })) }];
  });
}

/** La colonne visée par son index ou par son nom. */
export function reviewColumn(projectPath: string, file: string, column: unknown): { review: Review; index: number } {
  const review = readReviewFile(projectPath, file);
  if (!review) throw new TypeError(`revue : aucune revue tabulaire ${file} dans « ${REVIEW_FOLDER} ».`);
  if (review.category === 'recherche-juridique') throw new TypeError('revue : une recherche juridique cite des décisions, pas des pièces du dossier ; lier une revue des pièces.');
  const given = typeof column === 'number' ? String(column) : text(column);
  const fold = (value: string) => value.toLocaleLowerCase('fr').normalize('NFC');
  const found = review.columns.find((entry) => String(entry.index) === given) || review.columns.find((entry) => fold(text(entry.name)) === fold(given));
  if (!found) throw new TypeError(`colonne : aucune colonne « ${given} » dans ${file}. Colonnes : ${review.columns.map((entry) => `${entry.index} « ${entry.name} »`).join(', ')}.`);
  return { review, index: found.index };
}

const rowResource = (projectPath: string, row: ReviewRow, cited: string): string => {
  const source = row.documents.find((document) => cited && sameDocument(document.source, cited))?.source || row.piece || row.documents[0]?.source || '';
  return source ? path.relative(projectPath, path.resolve(projectPath, source)).split(path.sep).join('/').normalize('NFC') : '';
};

/** Les lignes positives de la colonne liée, lues dans la revue à chaque lecture : une revue relancée ou vérifiée remonte aussitôt. */
export function reviewRowPieces(projectPath: string, file: string, column: number): { titre: string; question: string; lignes: ReviewRowPiece[]; erreur?: string } {
  const review = readReviewFile(projectPath, file);
  const target = review?.columns.find((entry) => entry.index === column);
  if (!review || !target) return { titre: file, question: '', lignes: [], erreur: review ? `colonne ${column} absente de la revue` : 'revue tabulaire introuvable' };
  const lignes = review.rows.flatMap((row) => {
    const cell = review.cells?.[row.id]?.[String(column)];
    if (row.status !== 'done' || !isPositiveCell(target, cell)) return [];
    const cited = cell.citations?.find((citation) => citation.verified) || cell.citations?.[0];
    const resource = rowResource(projectPath, row, cited?.document || '');
    if (!resource || /^https?:/i.test(resource) || resource.startsWith('..')) return [];
    return [{ row: row.id, label: text(row.label) || resource, resource, value: squash(cell.summary), citation: squash(cited?.quote || ''), author: cellAuthor(cell), ...(cell.checked?.at ? { checkedAt: cell.checked.at } : {}) }];
  });
  return { titre: text(review.title) || file, question: text(target.name), lignes };
}

function readReviews(projectPath: string): Review[] {
  const directory = path.join(projectPath, REVIEW_FOLDER);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      try {
        const review = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) as Review;
        return Array.isArray(review?.columns) && Array.isArray(review?.rows) ? [review] : [];
      } catch {
        return [];
      }
    })
    .sort((left, right) => text(left.updatedAt).localeCompare(text(right.updatedAt)));
}

export function documentMetadataFromReviews(projectPath: string): Map<string, { title?: string; titleCitation?: string; nature?: string }> {
  const metadata = new Map<string, { title?: string; titleCitation?: string; nature?: string }>();
  for (const review of readReviews(projectPath)) {
    if (review.category === 'recherche-juridique') continue;
    const named = (names: string[]) => names.map((name) => review.columns.find((column) => text(column?.name).trim().toLocaleLowerCase('fr').normalize('NFC') === name)).find(Boolean);
    const natureColumn = named(['nature', 'type de document', 'type de pièce', 'type']);
    for (const row of review.rows) {
      const titleCell = documentTitleCell(review, row);
      const title = text(titleCell?.summary);
      const titleCitation = text(titleCell?.citations?.find((citation) => citation.verified)?.quote);
      const nature = natureColumn && text(review.cells?.[row.id]?.[natureColumn.index]?.summary);
      for (const source of [row.piece, ...(row.documents || []).map((document) => document.source)]) {
        if (!source) continue;
        const resource = path.relative(projectPath, path.resolve(projectPath, source)).normalize('NFC');
        metadata.set(resource, { ...metadata.get(resource), ...(title ? { title, titleCitation } : {}), ...(nature ? { nature } : {}) });
      }
    }
  }
  return metadata;
}
