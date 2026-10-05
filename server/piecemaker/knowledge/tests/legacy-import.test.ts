import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { KnowledgeStore } from '../../../../plugins/piecemaker-dossier/src/knowledge.js';
import { importLegacyKnowledge } from '../legacy-import.js';

const PROJECTS_SQL = `CREATE TABLE projects (
  project_id TEXT PRIMARY KEY NOT NULL,
  project_path TEXT NOT NULL UNIQUE,
  custom_project_name TEXT DEFAULT NULL,
  isStarred BOOLEAN DEFAULT 0,
  isArchived BOOLEAN DEFAULT 0
)`;

const LEGACY_SCHEMA_SQL = `
CREATE TABLE piecemaker_nodes (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  data_json TEXT NOT NULL DEFAULT '{}',
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);
CREATE TABLE piecemaker_links (
  project_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, from_node_id, to_node_id, relation)
);
CREATE TABLE piecemaker_mappings (
  project_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  real_value TEXT NOT NULL,
  masked_value TEXT NOT NULL,
  search_text TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, node_id, real_value)
);
CREATE TABLE piecemaker_anonymization_status (
  project_id TEXT PRIMARY KEY NOT NULL,
  completed_at TEXT NOT NULL
);
`;

function openDatabase(file: string, legacy = false): Database.Database {
  const database = new Database(file);
  database.pragma('foreign_keys = ON');
  database.exec(PROJECTS_SQL);
  if (legacy) database.exec(LEGACY_SCHEMA_SQL);
  else new KnowledgeStore(database);
  return database;
}

function seedAnalysis(database: Database.Database, projectId: string, masked: string, legacy = false): void {
  const now = new Date().toISOString();
  const originColumn = legacy ? ',origin' : '';
  const originValue = legacy ? ",'gliner'" : '';
  database.prepare(`INSERT INTO piecemaker_nodes (project_id,id,kind,label,search_text,created_at,updated_at${originColumn}) VALUES (?,?,?,?,?,?,?${originValue})`)
    .run(projectId, 'person:1', 'person', masked, masked.toLowerCase(), now, now);
  database.prepare(`INSERT INTO piecemaker_nodes (project_id,id,kind,label,search_text,data_json,created_at,updated_at${originColumn}) VALUES (?,?,?,?,?,?,?,?${originValue})`)
    .run(projectId, 'document:1', 'document', 'piece.pdf', 'piece.pdf', JSON.stringify({ nature: 'contrat', doc_date_iso: '2024-03-05' }), now, now);
  database.prepare(`INSERT INTO piecemaker_links (project_id,from_node_id,to_node_id,relation,created_at,updated_at${originColumn}) VALUES (?,?,?,?,?,?${originValue})`)
    .run(projectId, 'document:1', 'person:1', 'mentions', now, now);
  database.prepare(`INSERT INTO piecemaker_mappings (project_id,node_id,real_value,masked_value,search_text,created_at,updated_at${originColumn}) VALUES (?,?,?,?,?,?,?${originValue})`)
    .run(projectId, 'person:1', 'Jean Dupont', masked, 'jean dupont', now, now);
  database.prepare('INSERT INTO piecemaker_anonymization_status (project_id, completed_at) VALUES (?, ?)').run(projectId, now);
}

function count(database: Database.Database, table: string, projectId: string): number {
  return (database.prepare(`SELECT count(*) AS n FROM ${table} WHERE project_id=?`).get(projectId) as { n: number }).n;
}

function workspace() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-import-'));
  const legacyFile = path.join(directory, 'legacy dir', 'auth.db');
  fs.mkdirSync(path.dirname(legacyFile));
  const legacy = openDatabase(legacyFile, true);
  const current = openDatabase(path.join(directory, 'current.db'));
  return { directory, legacyFile, legacy, current };
}

test('imports a legacy analysis under the current project id of the same folder', () => {
  const { legacyFile, legacy, current } = workspace();
  legacy.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('old-id', '/dossiers/alpha');
  seedAnalysis(legacy, 'old-id', 'PERSONNE_01', true);
  legacy.close();
  current.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('new-id', '/dossiers/alpha');
  const now = new Date().toISOString();
  current.prepare(`INSERT INTO piecemaker_nodes (project_id,id,kind,label,search_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run('new-id', 'system:gliner-exclusions', 'other', '', '', now, now);

  const report = importLegacyKnowledge(current, legacyFile);

  assert.deepEqual(report?.imported, ['/dossiers/alpha']);
  assert.equal(count(current, 'piecemaker_nodes', 'new-id'), 2);
  assert.equal(count(current, 'piecemaker_links', 'new-id'), 1);
  assert.equal(count(current, 'piecemaker_mappings', 'new-id'), 1);
  assert.equal(count(current, 'piecemaker_anonymization_status', 'new-id'), 1);
  const piece = current.prepare('SELECT doc_date, data_json FROM piecemaker_nodes WHERE project_id=? AND id=?').get('new-id', 'document:1') as { doc_date: string; data_json: string };
  assert.equal(piece.doc_date, '2024-03-05');
  assert.deepEqual(JSON.parse(piece.data_json), { nature: 'contrat' });
  assert.equal(importLegacyKnowledge(current, legacyFile), null);
});

test('never overwrites a project already analysed in the current database', () => {
  const { legacyFile, legacy, current } = workspace();
  legacy.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('old-id', '/dossiers/alpha');
  seedAnalysis(legacy, 'old-id', 'PERSONNE_01', true);
  legacy.close();
  current.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('new-id', '/dossiers/alpha');
  seedAnalysis(current, 'new-id', 'PERSONNE_09');

  const report = importLegacyKnowledge(current, legacyFile);

  assert.deepEqual(report?.skipped, ['/dossiers/alpha']);
  const masked = current.prepare('SELECT masked_value FROM piecemaker_mappings WHERE project_id=?').all('new-id') as Array<{ masked_value: string }>;
  assert.deepEqual(masked.map((row) => row.masked_value), ['PERSONNE_09']);
});

test('registers a legacy folder missing from the current database with its original id', () => {
  const { legacyFile, legacy, current } = workspace();
  legacy.prepare('INSERT INTO projects (project_id, project_path, custom_project_name) VALUES (?, ?, ?)').run('old-id', '/dossiers/beta', 'Beta');
  seedAnalysis(legacy, 'old-id', 'PERSONNE_01', true);
  legacy.close();

  const report = importLegacyKnowledge(current, legacyFile);

  assert.deepEqual(report?.imported, ['/dossiers/beta']);
  const project = current.prepare('SELECT project_id, custom_project_name FROM projects WHERE project_path=?').get('/dossiers/beta');
  assert.deepEqual({ ...(project as object) }, { project_id: 'old-id', custom_project_name: 'Beta' });
  assert.equal(count(current, 'piecemaker_mappings', 'old-id'), 1);
});

test('does nothing when the legacy database is the current one or absent', () => {
  const { directory, current } = workspace();
  assert.equal(importLegacyKnowledge(current, current.name), null);
  assert.equal(importLegacyKnowledge(current, path.join(directory, 'missing.db')), null);
});
