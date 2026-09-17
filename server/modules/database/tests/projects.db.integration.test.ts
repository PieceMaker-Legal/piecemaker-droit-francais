import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'projects-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

test('projectsDb.createProjectPath returns created for fresh paths', async () => {
  await withIsolatedDatabase(() => {
    const created = projectsDb.createProjectPath('/workspace/new-project');

    assert.equal(created.outcome, 'created');
    assert.ok(created.project);
    assert.equal(created.project?.project_path, '/workspace/new-project');
    assert.equal(created.project?.isArchived, 0);
  });
});

test('projectsDb.createProjectPath returns reactivated_archived for archived duplicates', async () => {
  await withIsolatedDatabase(() => {
    const initial = projectsDb.createProjectPath('/workspace/archived-project', 'Archived Project');
    assert.equal(initial.outcome, 'created');
    assert.ok(initial.project);

    projectsDb.updateProjectIsArchived('/workspace/archived-project', true);

    const reused = projectsDb.createProjectPath('/workspace/archived-project', 'Renamed Project');
    assert.equal(reused.outcome, 'reactivated_archived');
    assert.ok(reused.project);
    assert.equal(reused.project?.project_id, initial.project?.project_id);
    assert.equal(reused.project?.isArchived, 0);
  });
});

test('projectsDb.createProjectPath returns active_conflict for active duplicates', async () => {
  await withIsolatedDatabase(() => {
    const initial = projectsDb.createProjectPath('/workspace/active-project');
    assert.equal(initial.outcome, 'created');
    assert.ok(initial.project);

    const conflict = projectsDb.createProjectPath('/workspace/active-project');
    assert.equal(conflict.outcome, 'active_conflict');
    assert.ok(conflict.project);
    assert.equal(conflict.project?.project_id, initial.project?.project_id);
    assert.equal(conflict.project?.isArchived, 0);
  });
});

test('projectsDb.getProjectPaths reads anonymization completion directly from SQLite', async () => {
  await withIsolatedDatabase(() => {
    const created = projectsDb.createProjectPath('/workspace/anonymized-project');
    assert.ok(created.project);

    projectsDb.getProjectPaths();
    getConnection().prepare(`
      INSERT INTO piecemaker_anonymization_status (project_id, completed_at)
      VALUES (?, ?)
    `).run(created.project.project_id, new Date().toISOString());

    const project = projectsDb.getProjectPaths()[0];
    assert.equal(project.anonymization_complete, 1);
  });
});

test('projectsDb.getProjectPaths backfills anonymization completion from existing mappings', async () => {
  await withIsolatedDatabase(() => {
    const created = projectsDb.createProjectPath('/workspace/legacy-scanned-project');
    assert.ok(created.project);
    const db = getConnection();
    db.exec(`
      CREATE TABLE IF NOT EXISTS piecemaker_nodes (
        project_id TEXT NOT NULL,
        id TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        search_text TEXT NOT NULL DEFAULT '',
        aliases_json TEXT NOT NULL DEFAULT '[]',
        data_json TEXT NOT NULL DEFAULT '{}',
        origin TEXT NOT NULL DEFAULT 'gliner',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, id)
      );
      CREATE TABLE IF NOT EXISTS piecemaker_mappings (
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        real_value TEXT NOT NULL,
        masked_value TEXT NOT NULL,
        search_text TEXT NOT NULL DEFAULT '',
        data_json TEXT NOT NULL DEFAULT '{}',
        origin TEXT NOT NULL DEFAULT 'gliner',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, node_id, real_value)
      );
    `);
    db.prepare(`
      INSERT INTO piecemaker_nodes(project_id,id,kind,label,search_text,aliases_json,data_json,origin,created_at,updated_at)
      VALUES (?, 'person-1', 'person', 'Alice', 'alice', '[]', '{}', 'gliner', ?, ?)
    `).run(created.project.project_id, new Date().toISOString(), new Date().toISOString());
    db.prepare(`
      INSERT INTO piecemaker_mappings(project_id,node_id,real_value,masked_value,search_text,data_json,origin,created_at,updated_at)
      VALUES (?, 'person-1', 'Alice', 'PERSONNE_PHYSIQUE_01', 'alice', '{}', 'gliner', ?, ?)
    `).run(created.project.project_id, new Date().toISOString(), new Date().toISOString());

    const project = projectsDb.getProjectPaths()[0];
    assert.equal(project.anonymization_complete, 1);
  });
});
