import path from 'node:path';

import type { KnowledgeStore } from '../../../plugins/piecemaker-dossier/src/knowledge.js';
import type { KnowledgeQueryInput, KnowledgeUpdateInput } from '../../../plugins/piecemaker-dossier/src/types.js';

import type { createKnowledgePipeline } from './pipeline.js';
import { createKnowledgeScanJobs } from './scan-jobs.js';

type ProjectLookup = {
  getProjectById(projectId: string): { project_id: string; project_path: string } | null;
  getProjectPaths(): Array<{ project_id: string; project_path: string; custom_project_name?: string | null }>;
};

/** Le Python écrit les `.md` d'après le nom des pièces : on ne renomme pas pendant une conversion. */
export const CONVERSION_RUNNING = 'Une conversion est en cours sur ce dossier.';
export const RENAME_RUNNING = 'Un renommage est en cours sur ce dossier.';

function projectId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('projectId is required.');
  return value.trim();
}

export function createKnowledgeService(store: KnowledgeStore, projects: ProjectLookup, pipeline: ReturnType<typeof createKnowledgePipeline>) {
  const scanJobs = createKnowledgeScanJobs();
  const renaming = new Set<string>();
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
    version() {
      return { version: store.dataVersion() };
    },
    projects() {
      const counts = store.mappingCounts();
      return {
        projects: projects.getProjectPaths().map((row) => ({
          projectId: row.project_id,
          name: row.custom_project_name?.trim() || path.basename(row.project_path) || row.project_path,
          mappings: counts.get(row.project_id) || 0,
        })),
      };
    },
    scan(value: unknown, files?: unknown, ocrMissing?: unknown) {
      const id = ensureProject(value);
      if (renaming.has(id)) throw new Error(RENAME_RUNNING);
      const ocrChoice = ocrMissing === 'ask' ? 'ask' : 'continue';
      return {
        job: scanJobs.start(id, async (report, signal) => {
          const result = await pipeline.scan(id, files, report, signal, ocrChoice);
          store.markAnonymizationComplete(id);
          return result;
        }),
      };
    },
    async rename(value: unknown, piecePath: unknown, name: unknown, directory?: unknown) {
      const id = ensureProject(value);
      if (scanJobs.runningForProject(id)) throw new Error(CONVERSION_RUNNING);
      if (renaming.has(id)) throw new Error(RENAME_RUNNING);
      renaming.add(id);
      try {
        return await pipeline.rename(id, piecePath, name, directory);
      } finally {
        renaming.delete(id);
      }
    },
    pieces(value: unknown) {
      return pipeline.pieces(ensureProject(value)).then((pieces) => ({ pieces }));
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
