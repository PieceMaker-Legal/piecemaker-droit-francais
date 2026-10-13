import path from 'node:path';

import type BetterSqlite3 from 'better-sqlite3';

type PieceRow = { label: string | null; doc_date: string | null; nature: string | null; path: string | null };
type Database = Pick<BetterSqlite3.Database, 'prepare'>;

const stem = (file: string) => path.basename(file, path.extname(file)).toLowerCase();
const frenchDate = (date: string) => date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');

export function formatPieceTitle(piece: Partial<PieceRow> | undefined, docId: string) {
  const label = piece?.label ?? '';
  const dated = /^(\d{4}-\d{2}-\d{2})_(.+)$/.exec(path.basename(label, path.extname(label)));
  if (dated) return `${dated[2].replace(/_/g, ' ')} (${frenchDate(dated[1])})`;
  if (piece?.nature && piece.doc_date) return `${piece.nature.charAt(0).toUpperCase()}${piece.nature.slice(1)} du ${frenchDate(piece.doc_date)}`;
  if (label) return path.basename(label, path.extname(label));
  return path.basename(docId, path.extname(docId));
}

export function createPieceTitleResolver(database: () => Database) {
  return (cwd: string, docId: string) => {
    try {
      const project = database().prepare(
        "SELECT project_id FROM projects WHERE ? = project_path OR ? LIKE project_path || '/%' ORDER BY length(project_path) DESC LIMIT 1",
      ).get(cwd, cwd) as { project_id: string } | undefined;
      const pieces = project ? database().prepare(
        "SELECT label, doc_date, json_extract(data_json, '$.nature') AS nature, json_extract(data_json, '$.path') AS path FROM piecemaker_nodes WHERE project_id = ? AND kind = 'document'",
      ).all(project.project_id) as PieceRow[] : [];
      return formatPieceTitle(pieces.find((piece) => piece.path && stem(piece.path) === stem(docId)), docId);
    } catch {
      return formatPieceTitle(undefined, docId);
    }
  };
}
