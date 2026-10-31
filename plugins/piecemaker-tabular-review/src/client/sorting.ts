import type { Cell, ColumnAction, MarkdownDocument, Review, ReviewRow } from '../shared.js';
import { classifyColumn, isCellFilled, NOT_FOUND_SUMMARY, REVIEW_FOLDER } from '../shared.js';

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

export function classifiedFolder(review: Review, row: ReviewRow): string {
  const value = columnValue(review, row, 'classify').normalize('NFC').toLowerCase();
  return classifyColumn(review.columns)?.tags?.find((tag) => tag.normalize('NFC').toLowerCase() === value) ?? '';
}

export function pieceOf(row: ReviewRow, pieces: CasePiece[]): string | undefined {
  if (row.piece) return row.piece;
  const source = row.documents[0]?.source.normalize('NFC');
  return pieces.find((piece) => piece.markdown?.normalize('NFC') === source)?.path;
}

/** Changement à appliquer à une ligne, ou `null` s'il n'y a rien à faire. */
export function plannedChange(review: Review, row: ReviewRow, pseudonyms: Pseudonym[], pieces: CasePiece[] = []): PlannedChange | null {
  const piece = pieceOf(row, pieces);
  if (!piece) return null;
  const extension = piece.match(/\.[^./]+$/)?.[0] ?? '';
  const rawName = depseudonymize(columnValue(review, row, 'rename'), pseudonyms);
  const name = extension && rawName.toLowerCase().endsWith(extension.toLowerCase()) ? rawName.slice(0, -extension.length) : rawName;
  const classified = classifiedFolder(review, row);
  const directory = classified || depseudonymize(columnValue(review, row, 'move'), pseudonyms).replace(/^\/+|\/+$/g, '');
  const currentName = piece.split('/').pop()!.slice(0, extension ? -extension.length : undefined);
  const currentDirectory = piece.includes('/') ? piece.slice(0, piece.lastIndexOf('/')) : '';
  const inPlace = currentDirectory.normalize('NFC') === directory.normalize('NFC')
    || Boolean(classified) && currentDirectory.normalize('NFC').startsWith(`${classified.normalize('NFC')}/`);
  const change: PlannedChange = { row, piece };
  if (name && name !== currentName) change.name = name;
  if (directory && !inPlace) change.directory = directory;
  return change.name || change.directory ? change : null;
}

export function classifiedChange(review: Review, row: ReviewRow, pieces: CasePiece[]): (PlannedChange & { directory: string }) | null {
  const change = classifiedFolder(review, row) ? plannedChange(review, row, [], pieces) : null;
  return change?.directory ? { row, piece: change.piece, directory: change.directory } : null;
}

/** Chemin de la pièce une fois le changement appliqué. */
export function targetPath(change: PlannedChange): string {
  const extension = change.piece.match(/\.[^./]+$/)?.[0] ?? '';
  const name = change.name ?? change.piece.split('/').pop()!.slice(0, extension ? -extension.length : undefined);
  const directory = change.directory ?? (change.piece.includes('/') ? change.piece.slice(0, change.piece.lastIndexOf('/')) : '');
  return `${directory ? `${directory}/` : ''}${name}${extension}`;
}

function knownPaths(review: Review): Set<string> {
  return new Set(review.rows.flatMap((row) => [...(row.piece ? [row.piece] : []), ...row.documents.map((document) => document.source)]));
}

/** Pièces du dossier absentes de la revue, hors exports des analyses tabulaires. */
export function newPieces(review: Review, pieces: CasePiece[]): CasePiece[] {
  const known = knownPaths(review);
  return pieces.filter((piece) => !known.has(piece.path) && !(piece.markdown && known.has(piece.markdown)) && piece.path.split('/')[0] !== REVIEW_FOLDER);
}

export function newNotes(review: Review, documents: MarkdownDocument[], pieces: CasePiece[]): MarkdownDocument[] {
  const known = knownPaths(review);
  const converted = new Set(pieces.map((piece) => piece.markdown));
  return documents.filter((document) => !known.has(document.path) && !converted.has(document.path));
}
