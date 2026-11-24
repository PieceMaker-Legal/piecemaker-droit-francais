import fs from 'node:fs';
import path from 'node:path';

import type Database from 'better-sqlite3';

import { REVIEW_FOLDER, isCaseIndex } from '../../../plugins/piecemaker-tabular-review/src/shared.js';
import type { Cell, Review, ReviewColumn, ReviewRow } from '../../../plugins/piecemaker-tabular-review/src/shared.js';

type Connection = InstanceType<typeof Database>;

/** Le Case index, tel que l'analyse tabulaire le remplit : SQLite fait foi, le .json du dossier « Tabular Review » en est une vue régénérée. */
export type StoredIndex = { file: string; review: Review; revision: number };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS piecemaker_index_reviews (
  project_id TEXT PRIMARY KEY NOT NULL,
  file TEXT NOT NULL,
  title TEXT NOT NULL,
  template_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS piecemaker_index_columns (
  project_id TEXT NOT NULL,
  column_index INTEGER NOT NULL,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'text',
  data TEXT NOT NULL,
  PRIMARY KEY (project_id, column_index),
  FOREIGN KEY (project_id) REFERENCES piecemaker_index_reviews(project_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS piecemaker_index_rows (
  project_id TEXT NOT NULL,
  row_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  piece TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (project_id, row_id),
  FOREIGN KEY (project_id) REFERENCES piecemaker_index_reviews(project_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS piecemaker_index_cells (
  project_id TEXT NOT NULL,
  row_id TEXT NOT NULL,
  column_index INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  PRIMARY KEY (project_id, row_id, column_index),
  FOREIGN KEY (project_id, row_id) REFERENCES piecemaker_index_rows(project_id, row_id) ON DELETE CASCADE
);
`;

export class IndexConflictError extends Error {
  constructor() {
    super('Case index modifié entre-temps : relire puis réessayer.');
  }
}

const json = (value: unknown) => JSON.stringify(value ?? null);
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;

/** Nom du .json du Case index : un nom de fichier simple posé dans « Tabular Review ». */
export function indexFileName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name.endsWith('.json') || name.startsWith('.') || /[\\/]/.test(name)) throw new TypeError('fichier : nom du .json du Case index attendu.');
  return name;
}

function isReview(value: unknown): value is Review {
  return Boolean(value) && typeof value === 'object' && Array.isArray((value as Review).columns) && Array.isArray((value as Review).rows);
}

/** La vue .json du Case index, réécrite d'un bloc après chaque écriture dans SQLite. */
export function writeIndexView(projectPath: string, file: string, review: Review): void {
  const directory = path.join(projectPath, REVIEW_FOLDER);
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, file);
  const temporary = path.join(directory, `.${file}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(review, null, 2)}\n`);
  fs.renameSync(temporary, target);
}

/** Le Case index d'un dossier encore tenu dans un .json : le plus récent de ceux qui sont le Case index. */
export function legacyIndexFile(projectPath: string): { file: string; review: Review } | null {
  const directory = path.join(projectPath, REVIEW_FOLDER);
  if (!fs.existsSync(directory)) return null;
  const found = fs.readdirSync(directory).filter((name) => name.endsWith('.json') && !name.startsWith('.')).flatMap((file) => {
    try {
      const review = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')) as unknown;
      return isReview(review) && isCaseIndex(review) ? [{ file, review }] : [];
    } catch {
      return [];
    }
  });
  return found.sort((left, right) => String(right.review.updatedAt).localeCompare(String(left.review.updatedAt)))[0] ?? null;
}

export function createIndexStore(database: Connection) {
  database.exec(SCHEMA);
  const statements = {
    review: database.prepare('SELECT file, revision, data FROM piecemaker_index_reviews WHERE project_id=?'),
    columns: database.prepare('SELECT data FROM piecemaker_index_columns WHERE project_id=? ORDER BY position'),
    rows: database.prepare('SELECT data FROM piecemaker_index_rows WHERE project_id=? ORDER BY position'),
    cells: database.prepare('SELECT row_id, column_index, data FROM piecemaker_index_cells WHERE project_id=?'),
    upsertReview: database.prepare(`INSERT INTO piecemaker_index_reviews(project_id, file, title, template_name, created_at, updated_at, revision, data) VALUES(@projectId, @file, @title, @templateName, @createdAt, @updatedAt, @revision, @data)
      ON CONFLICT(project_id) DO UPDATE SET file=excluded.file, title=excluded.title, template_name=excluded.template_name, created_at=excluded.created_at, updated_at=excluded.updated_at, revision=excluded.revision, data=excluded.data`),
    clearColumns: database.prepare('DELETE FROM piecemaker_index_columns WHERE project_id=?'),
    clearRows: database.prepare('DELETE FROM piecemaker_index_rows WHERE project_id=?'),
    clearCells: database.prepare('DELETE FROM piecemaker_index_cells WHERE project_id=?'),
    deleteReview: database.prepare('DELETE FROM piecemaker_index_reviews WHERE project_id=?'),
    column: database.prepare('INSERT INTO piecemaker_index_columns(project_id, column_index, position, name, prompt, format, data) VALUES(?, ?, ?, ?, ?, ?, ?)'),
    row: database.prepare('INSERT INTO piecemaker_index_rows(project_id, row_id, position, label, piece, source, status, data) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'),
    cell: database.prepare('INSERT INTO piecemaker_index_cells(project_id, row_id, column_index, summary, data) VALUES(?, ?, ?, ?, ?)'),
  };

  const read = (projectId: string): StoredIndex | null => {
    const head = statements.review.get(projectId) as { file: string; revision: number; data: string } | undefined;
    if (!head) return null;
    const cells: Review['cells'] = {};
    for (const entry of statements.cells.all(projectId) as Array<{ row_id: string; column_index: number; data: string }>) {
      (cells[entry.row_id] ??= {})[String(entry.column_index)] = parse<Cell>(entry.data);
    }
    const review: Review = {
      ...parse<Omit<Review, 'columns' | 'rows' | 'cells'>>(head.data),
      columns: (statements.columns.all(projectId) as Array<{ data: string }>).map((entry) => parse<ReviewColumn>(entry.data)),
      rows: (statements.rows.all(projectId) as Array<{ data: string }>).map((entry) => parse<ReviewRow>(entry.data)),
      cells,
    };
    return { file: head.file, review, revision: head.revision };
  };

  const write = database.transaction((projectId: string, file: string, review: Review, expected?: number): number => {
    const current = statements.review.get(projectId) as { revision: number } | undefined;
    if (expected !== undefined && (current?.revision ?? 0) !== expected) throw new IndexConflictError();
    const revision = (current?.revision ?? 0) + 1;
    const { columns, rows, cells, ...head } = review;
    statements.clearCells.run(projectId);
    statements.clearRows.run(projectId);
    statements.clearColumns.run(projectId);
    statements.upsertReview.run({ projectId, file, title: head.title, templateName: head.templateName, createdAt: head.createdAt, updatedAt: head.updatedAt, revision, data: json(head) });
    columns.forEach((column, position) => statements.column.run(projectId, column.index, position, column.name ?? '', column.prompt ?? '', column.format ?? 'text', json(column)));
    const known = new Set<string>();
    rows.forEach((row, position) => {
      if (known.has(row.id)) return;
      known.add(row.id);
      statements.row.run(projectId, row.id, position, row.label ?? '', row.piece ?? '', row.documents?.[0]?.source ?? '', row.status, json(row));
    });
    for (const [rowId, byColumn] of Object.entries(cells ?? {})) {
      if (!known.has(rowId)) continue;
      for (const [column, cell] of Object.entries(byColumn ?? {})) {
        if (!cell || !Number.isInteger(Number(column))) continue;
        statements.cell.run(projectId, rowId, Number(column), String(cell.summary ?? ''), json(cell));
      }
    }
    return revision;
  });

  return {
    read,
    /** Remplace le Case index ; `expected` refuse l'écriture si un autre l'a modifié depuis la lecture. */
    write(projectId: string, file: string, review: Review, expected?: number): number {
      if (!isReview(review)) throw new TypeError('review : Case index attendu (colonnes, lignes, cellules).');
      return write(projectId, indexFileName(file), review, expected);
    },
    remove(projectId: string): void {
      statements.clearCells.run(projectId);
      statements.clearRows.run(projectId);
      statements.clearColumns.run(projectId);
      statements.deleteReview.run(projectId);
    },
  };
}

export type IndexStore = ReturnType<typeof createIndexStore>;

/** Le Case index, repris une fois du .json s'il n'est pas encore dans SQLite. */
export function loadIndex(store: IndexStore, projectId: string, projectPath: string): StoredIndex | null {
  const stored = store.read(projectId);
  if (stored) return stored;
  const legacy = legacyIndexFile(projectPath);
  if (!legacy) return null;
  store.write(projectId, legacy.file, legacy.review);
  return store.read(projectId);
}
