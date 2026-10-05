import assert from 'node:assert/strict';
import test from 'node:test';

import type { KnowledgeStore } from '../../../../plugins/piecemaker-dossier/src/knowledge.js';
import type { KnowledgeSnapshot } from '../../../../plugins/piecemaker-dossier/src/types.js';
import type { createKnowledgePipeline } from '../pipeline.js';
import { OcrRequiredError } from '../scan-jobs.js';
import { CONVERSION_RUNNING, createKnowledgeService, RENAME_RUNNING } from '../service.js';

const snapshot: KnowledgeSnapshot = {
  projectId: 'project-1',
  nodes: [
    { id: 'person-1', projectId: 'project-1', kind: 'person', label: 'Mme Dupont', aliases: [], data: {}, createdAt: '', updatedAt: '' },
    { id: 'document-1', projectId: 'project-1', kind: 'document', label: 'Contrat.pdf', aliases: [], data: {}, createdAt: '', updatedAt: '' },
  ],
  links: [
    { projectId: 'project-1', fromNodeId: 'document-1', toNodeId: 'person-1', relation: 'mentions', data: {} },
  ],
  mappings: [
    { projectId: 'project-1', nodeId: 'person-1', real: 'Mme Dupont', masked: 'PERSONNE_PHYSIQUE_01', data: {} },
  ],
};

const scanCalls: { projectId: string; files?: unknown }[] = [];
const renameCalls: unknown[][] = [];
const scanSignals: (AbortSignal | undefined)[] = [];
const scanOcrChoices: unknown[] = [];
let completionMarks = 0;
let scanFailure: Error | null = null;

function service() {
  scanCalls.length = 0;
  renameCalls.length = 0;
  scanSignals.length = 0;
  scanOcrChoices.length = 0;
  completionMarks = 0;
  scanFailure = null;
  const store = {
    query: (input: unknown) => ({ input }),
    update: (input: unknown) => ({ input }),
    snapshot: () => snapshot,
    markAnonymizationComplete: () => { completionMarks += 1; },
    mappingCounts: () => new Map([['project-1', 3]]),
  } as unknown as KnowledgeStore;
  const projects = {
    getProjectById: (projectId: string) => projectId === 'project-1'
      ? { project_id: projectId, project_path: '/project' }
      : null,
    getProjectPaths: () => [
      { project_id: 'project-1', project_path: '/cases/dupont', custom_project_name: null },
      { project_id: 'project-2', project_path: '/cases/exemple', custom_project_name: 'Société Exemple' },
    ],
  };
  const pipeline = {
    scan: async (projectId: string, files?: unknown, _report?: unknown, signal?: AbortSignal, ocrMissing?: unknown) => {
      scanCalls.push({ projectId, files });
      scanSignals.push(signal);
      scanOcrChoices.push(ocrMissing);
      if (scanFailure) throw scanFailure;
      return { projectId, files };
    },
    rename: async (...args: unknown[]) => {
      renameCalls.push(args);
      return { previous: 'piece.pdf', current: '2024-01-09_Jugement.pdf', markdown: null };
    },
  } as unknown as ReturnType<typeof createKnowledgePipeline>;
  return createKnowledgeService(store, projects, pipeline);
}

test('knowledge service rejects unknown projects before accessing storage', () => {
  assert.throws(() => service().graph('missing'), /Project not found/);
});

test('knowledge service returns the graph snapshot for a registered project', () => {
  assert.deepEqual(service().graph('project-1'), snapshot);
});

test('knowledge service lists every case with its display name and pseudonym count', () => {
  assert.deepEqual(service().projects(), {
    projects: [
      { projectId: 'project-1', name: 'dupont', mappings: 3 },
      { projectId: 'project-2', name: 'Société Exemple', mappings: 0 },
    ],
  });
});

test('knowledge service sends scans to the existing pipeline with the registered project', async () => {
  const current = service();
  const { job } = current.scan('project-1', ['piece.pdf']);
  assert.equal(job.state, 'running');
  await Promise.resolve();
  assert.deepEqual(scanCalls, [{ projectId: 'project-1', files: ['piece.pdf'] }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completionMarks, 1);
  assert.equal(current.scanJob(job.id).job?.id, job.id);
});

test('knowledge service only asks about missing OCR when the caller requests it', async () => {
  service().scan('project-1', undefined, 'n’importe quoi');
  await Promise.resolve();
  assert.deepEqual(scanOcrChoices, ['continue']);
  service().scan('project-1', undefined, 'ask');
  await Promise.resolve();
  assert.deepEqual(scanOcrChoices, ['ask']);
});

test('knowledge service ends a scan awaiting the OCR decision without marking the case anonymized', async () => {
  const current = service();
  scanFailure = new OcrRequiredError(['scans/bail.pdf']);
  const { job } = current.scan('project-1', undefined, 'ask');
  await new Promise((resolve) => setImmediate(resolve));
  const finished = current.scanJob(job.id).job;
  assert.equal(finished?.state, 'ocr-required');
  assert.deepEqual(finished?.ocrRequired, { files: ['scans/bail.pdf'] });
  assert.equal(finished?.error, null);
  assert.equal(completionMarks, 0);
  assert.equal(current.scanJob(undefined, 'project-1').job, null);
});

test('knowledge service reuses the scan already running for a project', () => {
  const current = service();
  const first = current.scan('project-1').job;
  assert.equal(current.scan('project-1').job.id, first.id);
  assert.equal(current.scanJob(undefined, 'project-1').job?.id, first.id);
});

test('knowledge service cancels the scan running for a project', () => {
  const current = service();
  const { job } = current.scan('project-1');
  assert.equal(current.cancelScan(undefined, 'project-1').job?.state, 'cancelled');
  assert.equal(current.scanJob(job.id).job?.state, 'cancelled');
  assert.equal(scanSignals[0]?.aborted, true);
});

test('knowledge service renames a piece through the pipeline of the registered project', async () => {
  const result = await service().rename('project-1', 'piece.pdf', '2024-01-09_Jugement');
  assert.deepEqual(renameCalls, [['project-1', 'piece.pdf', '2024-01-09_Jugement', undefined]]);
  assert.equal(result.current, '2024-01-09_Jugement.pdf');
});

test('knowledge service refuses to rename a piece while a conversion runs', async () => {
  const current = service();
  current.scan('project-1');
  await assert.rejects(current.rename('project-1', 'piece.pdf', '2024-01-09_Jugement'), new RegExp(CONVERSION_RUNNING));
  assert.deepEqual(renameCalls, []);
});

test('knowledge service refuses a conversion while a rename is in flight', async () => {
  const current = service();
  const renaming = current.rename('project-1', 'piece.pdf', '2024-01-09_Jugement');
  assert.throws(() => current.scan('project-1'), new RegExp(RENAME_RUNNING));
  await assert.rejects(current.rename('project-1', 'piece.pdf', '2024-01-10_Jugement'), new RegExp(RENAME_RUNNING));
  await renaming;
  assert.equal(scanCalls.length, 0);
  current.scan('project-1');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scanCalls.length, 1);
});
