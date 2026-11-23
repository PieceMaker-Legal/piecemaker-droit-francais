import type Database from 'better-sqlite3';

type Connection = InstanceType<typeof Database>;

export type StoredPremise = { id: string; title: string; description: string; single: boolean; by: string; at: string; lofClass?: string };
export type StoredRelation = { source: string; relation: string; target: string; citation: string; value: string; origin: string; at: string; dismissed: boolean; piece?: string };
export type StoredExam = { source: string; motif: string; by: string; at: string; empreinte: string };
export type StoredReviewLink = { premise: string; file: string; column: number; by: string; at: string };
export type OkfRecords = { premises: StoredPremise[]; relations: StoredRelation[]; exams: StoredExam[]; reviews?: StoredReviewLink[] };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS piecemaker_okf_premises (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  single_value INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS piecemaker_okf_relations (
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  target_id TEXT NOT NULL,
  citation TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, source_id, relation, target_id),
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS piecemaker_okf_exams (
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  motif TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  empreinte TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, source_id),
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS piecemaker_okf_reviews (
  project_id TEXT NOT NULL,
  premise_id TEXT NOT NULL,
  review_file TEXT NOT NULL,
  column_index INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, premise_id, review_file, column_index),
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS piecemaker_okf_imports (
  project_id TEXT PRIMARY KEY NOT NULL,
  imported_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
`;

/** The OKF data that is authoritative: premises, cited links and examinations. The .md fiches are views generated from it. */
function addColumn(database: Connection, table: string, column: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
}

export function createOkfStore(database: Connection) {
  database.exec(SCHEMA);
  addColumn(database, 'piecemaker_okf_premises', 'lof_class');
  addColumn(database, 'piecemaker_okf_relations', 'piece');
  const statements = {
    premises: database.prepare('SELECT id, title, description, single_value, created_by, updated_at, lof_class FROM piecemaker_okf_premises WHERE project_id=? ORDER BY id'),
    relations: database.prepare('SELECT source_id, relation, target_id, citation, value, origin, updated_at, dismissed, piece FROM piecemaker_okf_relations WHERE project_id=? ORDER BY source_id, relation, target_id'),
    exams: database.prepare('SELECT source_id, motif, created_by, updated_at, empreinte FROM piecemaker_okf_exams WHERE project_id=? ORDER BY source_id'),
    upsertPremise: database.prepare(`INSERT INTO piecemaker_okf_premises(project_id, id, title, description, single_value, created_by, updated_at, lof_class) VALUES(@projectId, @id, @title, @description, @single, @by, @at, @lofClass)
      ON CONFLICT(project_id, id) DO UPDATE SET single_value=MAX(single_value, excluded.single_value), lof_class=CASE WHEN lof_class='' THEN excluded.lof_class ELSE lof_class END, updated_at=CASE WHEN excluded.single_value>single_value OR (lof_class='' AND excluded.lof_class<>'') THEN excluded.updated_at ELSE updated_at END`),
    upsertRelation: database.prepare(`INSERT INTO piecemaker_okf_relations(project_id, source_id, relation, target_id, citation, value, origin, updated_at, dismissed, piece) VALUES(@projectId, @source, @relation, @target, @citation, @value, @origin, @at, @dismissed, @piece)
      ON CONFLICT(project_id, source_id, relation, target_id) DO UPDATE SET citation=excluded.citation, value=excluded.value, origin=excluded.origin, updated_at=excluded.updated_at, dismissed=excluded.dismissed, piece=excluded.piece`),
    deleteRelation: database.prepare('DELETE FROM piecemaker_okf_relations WHERE project_id=? AND source_id=? AND relation=? AND target_id=?'),
    stated: database.prepare('SELECT 1 FROM piecemaker_okf_relations WHERE project_id=@projectId AND dismissed=0 AND (target_id=@id OR source_id=@id) LIMIT 1'),
    deletePremise: database.prepare('DELETE FROM piecemaker_okf_premises WHERE project_id=? AND id=?'),
    
    upsertExam: database.prepare(`INSERT INTO piecemaker_okf_exams(project_id, source_id, motif, created_by, updated_at, empreinte) VALUES(@projectId, @source, @motif, @by, @at, @empreinte)
      ON CONFLICT(project_id, source_id) DO UPDATE SET motif=excluded.motif, created_by=excluded.created_by, updated_at=excluded.updated_at, empreinte=excluded.empreinte`),
    deleteExam: database.prepare('DELETE FROM piecemaker_okf_exams WHERE project_id=? AND source_id=?'),
    renameSource: database.prepare('UPDATE OR REPLACE piecemaker_okf_relations SET source_id=@to WHERE project_id=@projectId AND source_id=@from'),
    renameTarget: database.prepare('UPDATE OR REPLACE piecemaker_okf_relations SET target_id=@to WHERE project_id=@projectId AND target_id=@from'),
    renamePiece: database.prepare('UPDATE piecemaker_okf_relations SET piece=@to WHERE project_id=@projectId AND piece=@from'),
    renameExam: database.prepare('UPDATE OR REPLACE piecemaker_okf_exams SET source_id=@to WHERE project_id=@projectId AND source_id=@from'),
    reviews: database.prepare('SELECT premise_id, review_file, column_index, created_by, updated_at FROM piecemaker_okf_reviews WHERE project_id=? ORDER BY premise_id, review_file, column_index'),
    upsertReview: database.prepare(`INSERT INTO piecemaker_okf_reviews(project_id, premise_id, review_file, column_index, created_by, updated_at) VALUES(@projectId, @premise, @file, @column, @by, @at)
      ON CONFLICT(project_id, premise_id, review_file, column_index) DO UPDATE SET created_by=excluded.created_by, updated_at=excluded.updated_at`),
    deleteReview: database.prepare('DELETE FROM piecemaker_okf_reviews WHERE project_id=? AND premise_id=? AND review_file=? AND column_index=?'),
    deleteReviewsOf: database.prepare('DELETE FROM piecemaker_okf_reviews WHERE project_id=? AND premise_id=?'),
    reviewed: database.prepare('SELECT 1 FROM piecemaker_okf_reviews WHERE project_id=? AND premise_id=? LIMIT 1'),
    imported: database.prepare('SELECT 1 FROM piecemaker_okf_imports WHERE project_id=?'),
    markImported: database.prepare('INSERT OR IGNORE INTO piecemaker_okf_imports(project_id, imported_at) VALUES(?, ?)'),
  };

  return {
    records(projectId: string): OkfRecords {
      return {
        premises: (statements.premises.all(projectId) as Array<Record<string, string | number>>).map((row) => ({ id: String(row.id), title: String(row.title), description: String(row.description), single: row.single_value === 1, by: String(row.created_by), at: String(row.updated_at), lofClass: String(row.lof_class) })),
        relations: (statements.relations.all(projectId) as Array<Record<string, string | number>>).map((row) => ({ source: String(row.source_id), relation: String(row.relation), target: String(row.target_id), citation: String(row.citation), value: String(row.value), origin: String(row.origin), at: String(row.updated_at), dismissed: row.dismissed === 1, piece: String(row.piece) })),
        exams: (statements.exams.all(projectId) as Array<Record<string, string>>).map((row) => ({ source: row.source_id, motif: row.motif, by: row.created_by, at: row.updated_at, empreinte: row.empreinte })),
        reviews: (statements.reviews.all(projectId) as Array<Record<string, string | number>>).map((row) => ({ premise: String(row.premise_id), file: String(row.review_file), column: Number(row.column_index), by: String(row.created_by), at: String(row.updated_at) })),
      };
    },
    upsertPremise(projectId: string, premise: StoredPremise): void {
      statements.upsertPremise.run({ projectId, id: premise.id, title: premise.title, description: premise.description, single: premise.single ? 1 : 0, by: premise.by, at: premise.at, lofClass: premise.lofClass ?? '' });
    },
    upsertRelation(projectId: string, relation: StoredRelation): void {
      statements.upsertRelation.run({ projectId, ...relation, piece: relation.piece ?? '', dismissed: relation.dismissed ? 1 : 0 });
    },
    deleteRelation(projectId: string, source: string, relation: string, target: string): void {
      statements.deleteRelation.run(projectId, source, relation, target);
    },
    /** A LOF fiche lives while a relation or a linked review touches it: removing the last one removes it. */
    dropUnstatedPremise(projectId: string, id: string): void {
      if (statements.stated.get({ projectId, id }) || statements.reviewed.get(projectId, id)) return;
      database.transaction(() => { statements.deletePremise.run(projectId, id); statements.deleteReviewsOf.run(projectId, id); })();
    },
    /** Links a tabular review column to a LOF fiche: its positive rows become the pieces that establish it. */
    upsertReviewLink(projectId: string, link: StoredReviewLink): void {
      statements.upsertReview.run({ projectId, ...link });
    },
    deleteReviewLink(projectId: string, premise: string, file: string, column: number): boolean {
      return statements.deleteReview.run(projectId, premise, file, column).changes > 0;
    },
    setExam(projectId: string, exam: StoredExam): void {
      statements.upsertExam.run({ projectId, ...exam });
    },
    clearExam(projectId: string, source: string): void {
      statements.deleteExam.run(projectId, source);
    },
    rename(projectId: string, from: string, to: string): void {
      database.transaction(() => {
        for (const statement of [statements.renameSource, statements.renameTarget, statements.renamePiece, statements.renameExam]) statement.run({ projectId, from, to });
      })();
    },
    /** Imports, once per case, the authoritative parts of fiches written before SQLite held them. */
    importOnce(projectId: string, records: OkfRecords, now: string): void {
      if (statements.imported.get(projectId)) return;
      database.transaction(() => {
        for (const premise of records.premises) this.upsertPremise(projectId, premise);
        for (const relation of records.relations) this.upsertRelation(projectId, relation);
        for (const exam of records.exams) this.setExam(projectId, exam);
        statements.markImported.run(projectId, now);
      })();
    },
    transaction<T>(work: () => T): T {
      return database.transaction(work)();
    },
  };
}

export type OkfStore = ReturnType<typeof createOkfStore>;
