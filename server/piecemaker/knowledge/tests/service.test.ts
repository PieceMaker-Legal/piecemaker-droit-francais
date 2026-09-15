import assert from 'node:assert/strict';
import test from 'node:test';

import type { KnowledgeStore } from '../../../../plugins/piecemaker-dossier/src/knowledge.js';
import type { KnowledgeSnapshot } from '../../../../plugins/piecemaker-dossier/src/types.js';
import type { createKnowledgePipeline } from '../pipeline.js';
import { createKnowledgeService } from '../service.js';

const snapshot: KnowledgeSnapshot = {
  projectId: 'project-1',
  nodes: [
    { id: 'person-1', projectId: 'project-1', kind: 'person', label: 'Mme Dupont', aliases: [], data: {}, origin: 'gliner', createdAt: '', updatedAt: '' },
    { id: 'document-1', projectId: 'project-1', kind: 'document', label: 'Contrat.pdf', aliases: [], data: {}, origin: 'gliner', createdAt: '', updatedAt: '' },
  ],
  links: [
    { projectId: 'project-1', fromNodeId: 'document-1', toNodeId: 'person-1', relation: 'mentions', data: {}, origin: 'gliner' },
  ],
  mappings: [
    { projectId: 'project-1', nodeId: 'person-1', real: 'Mme Dupont', masked: 'PERSONNE_PHYSIQUE_01', data: {}, origin: 'gliner' },
  ],
};

function service() {
  const store = {
    query: (input: unknown) => ({ input }),
    update: (input: unknown) => ({ input }),
    snapshot: () => snapshot,
  } as unknown as KnowledgeStore;
  const projects = {
    getProjectById: (projectId: string) => projectId === 'project-1'
      ? { project_id: projectId, project_path: '/project' }
      : null,
  };
  const pipeline = {
    scan: async (projectId: string, files?: unknown) => ({ projectId, files }),
  } as unknown as ReturnType<typeof createKnowledgePipeline>;
  return createKnowledgeService(store, projects, pipeline);
}

test('knowledge service rejects unknown projects before accessing storage', () => {
  assert.throws(() => service().overview('missing'), /Project not found/);
});

test('knowledge service builds mapping, chronology and graph views from one snapshot', () => {
  const current = service();
  assert.equal(current.mapping('project-1').nodes.length, 1);
  assert.equal(current.chronology('project-1').documents.length, 1);
  assert.equal(current.chronology('project-1').links.length, 1);
  assert.deepEqual(current.graph('project-1'), snapshot);
});

test('knowledge service sends scans to the existing pipeline with the registered project', async () => {
  const result = await service().scan('project-1', ['piece.pdf']);
  assert.deepEqual(result, { projectId: 'project-1', files: ['piece.pdf'] });
});
