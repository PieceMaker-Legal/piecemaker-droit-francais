import type { KnowledgeStore } from '../../../plugins/piecemaker-dossier/src/knowledge.js';
import type { KnowledgeQueryInput, KnowledgeUpdateInput } from '../../../plugins/piecemaker-dossier/src/types.js';
import type { createKnowledgePipeline } from './pipeline.js';

type ProjectLookup = {
  getProjectById(projectId: string): { project_id: string; project_path: string } | null;
};

function projectId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('projectId is required.');
  return value.trim();
}

export function createKnowledgeService(store: KnowledgeStore, projects: ProjectLookup, pipeline: ReturnType<typeof createKnowledgePipeline>) {
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
    overview(value: unknown) {
      const id = ensureProject(value);
      const nodes = store.snapshot(id).nodes;
      const counts = nodes.reduce<Record<string, number>>((result, node) => {
        result[node.kind] = (result[node.kind] || 0) + 1;
        return result;
      }, {});
      return { projectId: id, counts, total: nodes.length };
    },
    mapping(value: unknown) {
      const id = ensureProject(value);
      const snapshot = store.snapshot(id);
      return { projectId: id, nodes: snapshot.nodes.filter((node) => node.kind !== 'document'), mappings: snapshot.mappings };
    },
    chronology(value: unknown) {
      const id = ensureProject(value);
      const snapshot = store.snapshot(id);
      return { projectId: id, documents: snapshot.nodes.filter((node) => node.kind === 'document'), links: snapshot.links.filter((link) => link.relation === 'mentions') };
    },
    graph(value: unknown) {
      const id = ensureProject(value);
      return store.snapshot(id);
    },
    scan(value: unknown, files?: unknown) {
      return pipeline.scan(ensureProject(value), files);
    },
  };
}
