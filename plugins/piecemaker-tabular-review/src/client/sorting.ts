import type { Cell, ColumnAction, Review, ReviewRow } from '../shared.js';
import { isCellFilled, NOT_FOUND_SUMMARY, REVIEW_FOLDER } from '../shared.js';

/** Code d'anonymisation → nom réel, tiré du graphe du dossier. */
export type Pseudonym = { masked: string; real: string };

/** Pièce originale du dossier, telle que la liste PieceMaker. */
export type CasePiece = { path: string; status: string; markdown: string | null };

export type PlannedChange = { row: ReviewRow; piece: string; name?: string; directory?: string };

/** Réponse d'une colonne d'action, ramenée à une valeur brute : vide si rien n'est à appliquer. */
export function actionValue(cell: Cell | undefined): string {
  if (!isCellFilled(cell)) return '';
  const line = cell.summary.split('\n').map((entry) => entry.trim()).find(Boolean) ?? '';
  const value = line
    .replace(/^[-*]\s+/, '')
    .replace(/[*`]/g, '')
    .replace(/^[«"“\s]+|[»"”\s]+$/g, '')
    .replace(/[.\s]+$/, '');
  return value.toLowerCase() === NOT_FOUND_SUMMARY.toLowerCase() ? '' : value;
}

/** Remplace chaque code d'anonymisation par le nom réel, les codes les plus longs d'abord. */
export function depseudonymize(value: string, pseudonyms: Pseudonym[]): string {
  return [...pseudonyms]
    .filter((entry) => entry.masked && entry.real)
    .sort((left, right) => right.masked.length - left.masked.length)
    .reduce((text, entry) => text.split(entry.masked).join(entry.real.replace(/[\\/:*?"<>|]/g, '-')), value);
}

function columnValue(review: Review, row: ReviewRow, action: ColumnAction): string {
  const column = review.columns.find((entry) => entry.action === action);
  return column ? actionValue(review.cells[row.id]?.[String(column.index)]) : '';
}

/** Changement à appliquer à une ligne de tri, ou `null` s'il n'y a rien à faire. */
export function plannedChange(review: Review, row: ReviewRow, pseudonyms: Pseudonym[]): PlannedChange | null {
  if (!row.piece) return null;
  const extension = row.piece.match(/\.[^./]+$/)?.[0] ?? '';
  const rawName = depseudonymize(columnValue(review, row, 'rename'), pseudonyms);
  const name = extension && rawName.toLowerCase().endsWith(extension.toLowerCase()) ? rawName.slice(0, -extension.length) : rawName;
  const directory = depseudonymize(columnValue(review, row, 'move'), pseudonyms).replace(/^\/+|\/+$/g, '');
  const currentName = row.piece.split('/').pop()!.slice(0, extension ? -extension.length : undefined);
  const currentDirectory = row.piece.includes('/') ? row.piece.slice(0, row.piece.lastIndexOf('/')) : '';
  const change: PlannedChange = { row, piece: row.piece };
  if (name && name !== currentName) change.name = name;
  if (directory && directory !== currentDirectory) change.directory = directory;
  return change.name || change.directory ? change : null;
}

/** Chemin de la pièce une fois le changement appliqué. */
export function targetPath(change: PlannedChange): string {
  const extension = change.piece.match(/\.[^./]+$/)?.[0] ?? '';
  const name = change.name ?? change.piece.split('/').pop()!.slice(0, extension ? -extension.length : undefined);
  const directory = change.directory ?? (change.piece.includes('/') ? change.piece.slice(0, change.piece.lastIndexOf('/')) : '');
  return `${directory ? `${directory}/` : ''}${name}${extension}`;
}

/** Pièces du dossier absentes du tri, hors exports des tabular reviews. */
export function newPieces(review: Review, pieces: CasePiece[]): CasePiece[] {
  const known = new Set(review.rows.map((row) => row.piece));
  return pieces.filter((piece) => !known.has(piece.path) && piece.path.split('/')[0] !== REVIEW_FOLDER);
}
