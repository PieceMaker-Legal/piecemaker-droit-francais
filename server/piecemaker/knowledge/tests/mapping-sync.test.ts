import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { KnowledgeStore } from '../../../../plugins/piecemaker-dossier/src/knowledge.js';
import type { GlinerMappingDocument } from '../../../../plugins/piecemaker-dossier/src/types.js';
import { createMappingReadyHandler } from '../mapping-sync.js';

function caseStore(): { store: KnowledgeStore; directory: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-mapping-sync-'));
  const databasePath = path.join(directory, 'auth.db');
  const database = new Database(databasePath);
  database.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT NOT NULL UNIQUE)');
  database.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('project-1', '/cases/one');
  database.close();
  return { store: new KnowledgeStore(databasePath), directory };
}

function caseHandler(store: KnowledgeStore): (caseRoot: string, mapping: GlinerMappingDocument) => Promise<void> {
  return createMappingReadyHandler(() => store, {
    getProjectPath: (projectPath) => projectPath === '/cases/one'
      ? { project_id: 'project-1', project_path: projectPath }
      : null,
  });
}

test('mapping output synchronization preserves every variant in SQLite', async () => {
  const { store, directory } = caseStore();
  try {
    await caseHandler(store)('/cases/one', {
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

test('a variant removed from the mapping document disappears from SQLite', async () => {
  const { store, directory } = caseStore();
  try {
    const onMappingReady = caseHandler(store);
    await onMappingReady('/cases/one', {
      mapping: { 'Claire Reynaud': 'AVOCAT_01', Reynaud: 'AVOCAT_01', 'Paul Vidal': 'DIRIGEANT_01' },
      reverse_mapping: { AVOCAT_01: ['Claire Reynaud', 'Reynaud'], DIRIGEANT_01: ['Paul Vidal'] },
      extracted_data: {},
    });
    store.update({
      projectId: 'project-1',
      operations: [{ op: 'upsertMapping', mapping: { nodeId: 'entity:AVOCAT_01', real: 'Me Reynaud', masked: 'AVOCAT_01', origin: 'manual' } }],
    });

    await onMappingReady('/cases/one', {
      mapping: { 'Claire Reynaud': 'AVOCAT_01', 'Paul Vidal': 'DIRIGEANT_01' },
      reverse_mapping: { AVOCAT_01: ['Claire Reynaud'], DIRIGEANT_01: ['Paul Vidal'] },
      extracted_data: {},
      ignored: ['Reynaud'],
    });

    const snapshot = store.snapshot('project-1');
    assert.deepEqual(snapshot.mappings.map((entry) => entry.real), ['Claire Reynaud', 'Me Reynaud', 'Paul Vidal']);
    assert.deepEqual(snapshot.nodes.find((entry) => entry.id === 'entity:AVOCAT_01')?.aliases, []);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('an entity removed from the mapping document keeps no gliner mapping row', async () => {
  const { store, directory } = caseStore();
  try {
    const onMappingReady = caseHandler(store);
    await onMappingReady('/cases/one', {
      mapping: { 'Claire Reynaud': 'AVOCAT_01', 'Paul Vidal': 'DIRIGEANT_01' },
      reverse_mapping: { AVOCAT_01: ['Claire Reynaud'], DIRIGEANT_01: ['Paul Vidal'] },
      extracted_data: {},
    });

    await onMappingReady('/cases/one', {
      mapping: { 'Claire Reynaud': 'AVOCAT_01' },
      reverse_mapping: { AVOCAT_01: ['Claire Reynaud'] },
      extracted_data: {},
      ignored: ['Paul Vidal'],
    });

    const snapshot = store.snapshot('project-1');
    assert.deepEqual(snapshot.mappings.map((entry) => entry.real), ['Claire Reynaud']);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
