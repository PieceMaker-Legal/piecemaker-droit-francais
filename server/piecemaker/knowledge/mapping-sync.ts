import type { KnowledgeStore } from '../../../plugins/piecemaker-dossier/src/knowledge.js';
import { scanResultOperations } from '../../../plugins/piecemaker-dossier/src/scan-result.js';
import type { GlinerMappingDocument, KnowledgeUpdateOperation } from '../../../plugins/piecemaker-dossier/src/types.js';

type ProjectLookup = {
  getProjectPath(projectPath: string): { project_id: string; project_path: string } | null;
};

type StoreProvider = () => KnowledgeStore;

const mappingKey = (nodeId: string, real: string): string => JSON.stringify([nodeId, real]);

function staleMappingDeletions(
  store: KnowledgeStore,
  projectId: string,
  operations: KnowledgeUpdateOperation[],
): KnowledgeUpdateOperation[] {
  const retained = new Set(operations.flatMap((operation) => operation.op === 'upsertMapping'
    ? [mappingKey(operation.mapping.nodeId, operation.mapping.real)]
    : []));
  return store.glinerMappingKeys(projectId)
    .filter((entry) => entry.nodeId.startsWith('entity:')
      && !retained.has(mappingKey(entry.nodeId, entry.real)))
    .map((entry) => ({ op: 'deleteMapping', mapping: { nodeId: entry.nodeId, real: entry.real } }));
}

export function createMappingReadyHandler(store: StoreProvider, projects: ProjectLookup) {
  return async (caseRoot: string, mapping: GlinerMappingDocument): Promise<void> => {
    const project = projects.getProjectPath(caseRoot);
    if (!project) throw new Error('Project not found for mapping synchronization.');
    const knowledge = store();
    const operations = scanResultOperations({ projectId: project.project_id, mapping, documents: [] });
    knowledge.update({
      projectId: project.project_id,
      operations: [...staleMappingDeletions(knowledge, project.project_id, operations), ...operations],
    });
  };
}
