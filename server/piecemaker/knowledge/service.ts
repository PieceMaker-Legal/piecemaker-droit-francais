import type { KnowledgeStore } from '../../../plugins/piecemaker-dossier/src/knowledge.js';
import { exclusionNodeOperation } from '../../../plugins/piecemaker-dossier/src/scan-result.js';
import type { KnowledgeQueryInput, KnowledgeUpdateInput } from '../../../plugins/piecemaker-dossier/src/types.js';

import { legacyExclusions } from './pipeline.js';
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
  const snapshot = (id: string) => {
    const current = store.snapshot(id);
    if (current.exclusionsInitialized) return current;
    const project = projects.getProjectById(id);
    const values = project ? legacyExclusions(project.project_path) : [];
    if (!values.length) return current;
    const operation = exclusionNodeOperation(values);
    store.update({ projectId: id, operations: [operation] });
    return store.snapshot(id);
  };
  return {
    query(input: KnowledgeQueryInput) {
      return store.query({ ...input, projectId: ensureProject(input.projectId), projectPath: undefined });
    },
    update(input: KnowledgeUpdateInput) {
      return store.update({ ...input, projectId: ensureProject(input.projectId) });
    },
    graph(value: unknown) {
      const id = ensureProject(value);
      return snapshot(id);
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
