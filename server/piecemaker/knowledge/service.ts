import type { KnowledgeStore } from '../../../plugins/piecemaker-dossier/src/knowledge.js';
import type { KnowledgeQueryInput, KnowledgeUpdateInput, NodeKind } from '../../../plugins/piecemaker-dossier/src/types.js';

import { SEARCH_DEPTH, entityCard, entitySearchResult, resolveEntity, validateFields } from './entities.js';
import type { createKnowledgePipeline } from './pipeline.js';
import { createKnowledgeScanJobs } from './scan-jobs.js';

type ProjectLookup = {
  getProjectById(projectId: string): { project_id: string; project_path: string } | null;
};

function projectId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('projectId is required.');
  return value.trim();
}

export function createKnowledgeService(store: KnowledgeStore, projects: ProjectLookup, pipeline: ReturnType<typeof createKnowledgePipeline>) {
  const scanJobs = createKnowledgeScanJobs();
  const ensureProject = (value: unknown): string => {
    const id = projectId(value);
    if (!projects.getProjectById(id)) throw new Error('Project not found.');
    return id;
  };
  return {
    query(input: KnowledgeQueryInput) {
      return store.query({ ...input, projectId: ensureProject(input.projectId), projectPath: undefined });
    },
    update(input: KnowledgeUpdateInput) {
      return store.update({ ...input, projectId: ensureProject(input.projectId) });
    },
    graph(value: unknown) {
      return store.snapshot(ensureProject(value));
    },
    searchEntities(value: unknown, input: { query?: unknown; kind?: unknown; limit?: unknown } = {}) {
      const result = store.query({
        projectId: ensureProject(value),
        query: typeof input.query === 'string' ? input.query : '',
        kind: input.kind === undefined || input.kind === null || input.kind === '' ? undefined : input.kind as NodeKind,
        limit: typeof input.limit === 'number' ? input.limit : undefined,
        depth: SEARCH_DEPTH,
        excludeDocuments: true,
      });
      return entitySearchResult(result);
    },
    updateEntityFields(value: unknown, target: unknown, fields: unknown) {
      const id = ensureProject(value);
      const data = validateFields(fields);
      const node = resolveEntity(store.snapshot(id), target);
      store.update({ projectId: id, operations: [{ op: 'mergeNodeData', nodeId: node.id, data }] });
      const snapshot = store.snapshot(id);
      const updated = snapshot.nodes.find((entry) => entry.id === node.id);
      if (!updated) throw new Error('La fiche a disparu pendant la modification.');
      const mappings = snapshot.mappings.filter((mapping) => mapping.nodeId === node.id);
      return { fields: Object.keys(data), entity: entityCard({ ...updated, mappings, links: [] }, 0) };
    },
    scan(value: unknown, files?: unknown) {
      const id = ensureProject(value);
      return {
        job: scanJobs.start(id, async (report, signal) => {
          const result = await pipeline.scan(id, files, report, signal);
          store.markAnonymizationComplete(id);
          return result;
        }),
      };
    },
    scanJob(jobId: unknown, value?: unknown) {
      const job = scanJobs.get(jobId) || (value ? scanJobs.runningForProject(ensureProject(value)) : null);
      return { job };
    },
    cancelScan(jobId: unknown, value?: unknown) {
      const job = scanJobs.get(jobId) || (value ? scanJobs.runningForProject(ensureProject(value)) : null);
      return { job: scanJobs.cancel(job) };
    },
  };
}
