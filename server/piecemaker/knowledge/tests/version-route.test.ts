import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';
import express from 'express';

import { KnowledgeStore } from '../../../../plugins/piecemaker-dossier/src/knowledge.js';
import type { createKnowledgePipeline } from '../pipeline.js';
import { createKnowledgeRouter } from '../routes.js';
import { createKnowledgeService } from '../service.js';

test('la route de version change après une écriture faite par une autre connexion', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-knowledge-version-'));
  const databasePath = path.join(directory, 'auth.db');
  const appConnection = new Database(databasePath);
  appConnection.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT NOT NULL UNIQUE)');
  appConnection.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('project-1', '/cases/one');
  const store = new KnowledgeStore(appConnection);
  const projects = { getProjectById: () => null, getProjectPaths: () => [] };
  const service = createKnowledgeService(store, projects, {} as unknown as ReturnType<typeof createKnowledgePipeline>);
  const app = express();
  app.use('/api/piecemaker', createKnowledgeRouter(service));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const otherConnection = new Database(databasePath);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Adresse HTTP indisponible.');
    const read = async () => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/piecemaker/knowledge/version`);
      assert.equal(response.status, 200);
      return (await response.json() as { version: number }).version;
    };
    const first = await read();
    assert.equal(typeof first, 'number');
    assert.ok(Number.isInteger(first));
    assert.equal(await read(), first);

    store.update({ projectId: 'project-1', operations: [{ op: 'upsertNode', node: { id: 'entity:A', kind: 'person', label: 'Jean Dupont' } }] });
    assert.equal(await read(), first);

    otherConnection.prepare("UPDATE piecemaker_nodes SET label='Jean Durand' WHERE id='entity:A'").run();
    const second = await read();
    assert.notEqual(second, first);
    assert.equal(await read(), second);
  } finally {
    otherConnection.close();
    server.close();
    appConnection.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
