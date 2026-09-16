import fs from 'node:fs';
import path from 'node:path';

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
    overview(value: unknown) {
      const id = ensureProject(value);
      const nodes = snapshot(id).nodes;
      const counts = nodes.reduce<Record<string, number>>((result, node) => {
        result[node.kind] = (result[node.kind] || 0) + 1;
        return result;
      }, {});
      return { projectId: id, counts, total: nodes.length };
    },
    anonymizationStatus() {
      return { projects: store.listAnonymizationStatuses() };
    },
    mapping(value: unknown) {
      const id = ensureProject(value);
      const current = snapshot(id);
      return { projectId: id, nodes: current.nodes.filter((node) => node.kind !== 'document'), mappings: current.mappings, exclusions: current.exclusions || [] };
    },
    chronology(value: unknown) {
      const id = ensureProject(value);
      const current = snapshot(id);
      const documents = current.nodes
        .filter((node) => node.kind === 'document')
        .map(({ id: _documentId, ...document }) => document);
      return { projectId: id, documents, links: current.links.filter((link) => link.relation === 'mentions') };
    },
    graph(value: unknown) {
      const id = ensureProject(value);
      return snapshot(id);
    },
    agents(value: unknown) {
      const id = ensureProject(value);
      const project = projects.getProjectById(id);
      if (!project) throw new Error('Project not found.');
      const root = fs.realpathSync(project.project_path);
      const candidate = path.join(root, 'AGENTS.md');
      if (!fs.existsSync(candidate)) return { projectId: id, content: '', exists: false };
      const real = fs.realpathSync(candidate);
      if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw new Error('Invalid AGENTS.md path.');
      return { projectId: id, content: fs.readFileSync(real, 'utf8').slice(0, 2_000_000), exists: true };
    },
    scan(value: unknown, files?: unknown) {
      const id = ensureProject(value);
      return { job: scanJobs.start(id, (report, signal) => pipeline.scan(id, files, report, signal)) };
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
