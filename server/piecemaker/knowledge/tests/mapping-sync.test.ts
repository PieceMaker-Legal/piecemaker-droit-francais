import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { KnowledgeStore } from '../../../../plugins/piecemaker-dossier/src/knowledge.js';
import { createMappingReadyHandler } from '../mapping-sync.js';

test('mapping output synchronization preserves every variant in SQLite', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-mapping-sync-'));
  const databasePath = path.join(directory, 'auth.db');
  const database = new Database(databasePath);
  database.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT NOT NULL UNIQUE)');
  database.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('project-1', '/cases/one');
  database.close();

  const store = new KnowledgeStore(databasePath);
  try {
    const onMappingReady = createMappingReadyHandler(() => store, {
      getProjectPath: (projectPath) => projectPath === '/cases/one'
        ? { project_id: 'project-1', project_path: projectPath }
        : null,
    });
    await onMappingReady('/cases/one', {
      mapping: {
        'Claire Reynaud': 'AVOCAT_DEFENDEUR_PERSONNE_MORALE_01',
        Reynaud: 'AVOCAT_DEFENDEUR_PERSONNE_MORALE_01',
      },
      reverse_mapping: {
        AVOCAT_DEFENDEUR_PERSONNE_MORALE_01: ['Claire Reynaud', 'Reynaud'],
      },
      extracted_data: {},
    });

    const snapshot = store.snapshot('project-1');
    const node = snapshot.nodes.find((entry) => entry.id === 'entity:AVOCAT_DEFENDEUR_PERSONNE_MORALE_01');
    assert.deepEqual(node?.aliases, ['Reynaud']);
    assert.deepEqual(snapshot.mappings.map((entry) => entry.real), ['Claire Reynaud', 'Reynaud']);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
