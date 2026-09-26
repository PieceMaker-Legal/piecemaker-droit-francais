import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type Database from 'better-sqlite3';

type LegacyProject = {
  project_id: string;
  project_path: string;
  custom_project_name: string | null;
  isStarred: number | null;
  isArchived: number | null;
};

export type LegacyImportReport = { source: string; imported: string[]; skipped: string[] };

const NODE_COLUMNS = 'id,kind,label,search_text,aliases_json,data_json,origin,created_at,updated_at';
const LINK_COLUMNS = 'from_node_id,to_node_id,relation,data_json,origin,created_at,updated_at';
const MAPPING_COLUMNS = 'node_id,real_value,masked_value,search_text,data_json,origin,created_at,updated_at';

export function legacyDatabasePath(): string {
  return path.join(os.homedir(), '.cloudcli', 'auth.db');
}

function sameFile(left: string, right: string): boolean {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

function legacyHasTable(database: Database.Database, table: string): boolean {
  return Boolean(database.prepare(`SELECT 1 FROM legacy.sqlite_master WHERE type='table' AND name=?`).get(table));
}

function hasKnowledge(database: Database.Database, projectId: string): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM piecemaker_mappings WHERE project_id=?
    UNION ALL SELECT 1 FROM piecemaker_anonymization_status WHERE project_id=?
    LIMIT 1
  `).get(projectId, projectId));
}

function targetProjectId(database: Database.Database, legacy: LegacyProject): string {
  const existing = database.prepare('SELECT project_id FROM projects WHERE project_path=?').get(legacy.project_path) as { project_id: string } | undefined;
  if (existing) return existing.project_id;
  database.prepare(`
    INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived)
    VALUES (?, ?, ?, ?, ?)
  `).run(legacy.project_id, legacy.project_path, legacy.custom_project_name, legacy.isStarred ?? 0, legacy.isArchived ?? 0);
  return legacy.project_id;
}

function copyProject(database: Database.Database, sourceId: string, targetId: string, withStatus: boolean): void {
  database.prepare('DELETE FROM piecemaker_links WHERE project_id=?').run(targetId);
  database.prepare('DELETE FROM piecemaker_mappings WHERE project_id=?').run(targetId);
  database.prepare('DELETE FROM piecemaker_nodes WHERE project_id=?').run(targetId);
  database.prepare(`INSERT INTO piecemaker_nodes (project_id,${NODE_COLUMNS}) SELECT ?,${NODE_COLUMNS} FROM legacy.piecemaker_nodes WHERE project_id=?`).run(targetId, sourceId);
  database.prepare(`INSERT INTO piecemaker_links (project_id,${LINK_COLUMNS}) SELECT ?,${LINK_COLUMNS} FROM legacy.piecemaker_links WHERE project_id=?`).run(targetId, sourceId);
  database.prepare(`INSERT INTO piecemaker_mappings (project_id,${MAPPING_COLUMNS}) SELECT ?,${MAPPING_COLUMNS} FROM legacy.piecemaker_mappings WHERE project_id=?`).run(targetId, sourceId);
  if (withStatus) {
    database.prepare(`INSERT OR IGNORE INTO piecemaker_anonymization_status (project_id, completed_at) SELECT ?, completed_at FROM legacy.piecemaker_anonymization_status WHERE project_id=?`).run(targetId, sourceId);
  }
}

export function importLegacyKnowledge(database: Database.Database, source = legacyDatabasePath()): LegacyImportReport | null {
  const target = database.name;
  if (!fs.existsSync(source) || (target && sameFile(source, target))) return null;
  database.exec('CREATE TABLE IF NOT EXISTS piecemaker_legacy_imports (source TEXT PRIMARY KEY NOT NULL, imported_at TEXT NOT NULL)');
  const resolvedSource = path.resolve(source);
  if (database.prepare('SELECT 1 FROM piecemaker_legacy_imports WHERE source=?').get(resolvedSource)) return null;
  const report: LegacyImportReport = { source: resolvedSource, imported: [], skipped: [] };
  database.prepare('ATTACH DATABASE ? AS legacy').run(resolvedSource);
  try {
    database.transaction(() => {
      if (legacyHasTable(database, 'piecemaker_nodes') && legacyHasTable(database, 'projects')) {
        const withStatus = legacyHasTable(database, 'piecemaker_anonymization_status');
        const projects = database.prepare(`
          SELECT p.project_id, p.project_path, p.custom_project_name, p.isStarred, p.isArchived
          FROM legacy.projects p
          WHERE EXISTS (SELECT 1 FROM legacy.piecemaker_nodes n WHERE n.project_id=p.project_id AND n.id NOT LIKE 'system:%')
          ORDER BY p.project_path
        `).all() as LegacyProject[];
        for (const project of projects) {
          const targetId = targetProjectId(database, project);
          if (hasKnowledge(database, targetId)) {
            report.skipped.push(project.project_path);
            continue;
          }
          copyProject(database, project.project_id, targetId, withStatus);
          report.imported.push(project.project_path);
        }
      }
      database.prepare('INSERT INTO piecemaker_legacy_imports (source, imported_at) VALUES (?, ?)').run(resolvedSource, new Date().toISOString());
    })();
  } finally {
    database.exec('DETACH DATABASE legacy');
  }
  return report;
}
