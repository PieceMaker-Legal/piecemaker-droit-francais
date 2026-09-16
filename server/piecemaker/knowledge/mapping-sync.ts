import type { KnowledgeStore } from '../../../plugins/piecemaker-dossier/src/knowledge.js';
import { scanResultOperations } from '../../../plugins/piecemaker-dossier/src/scan-result.js';
import type { GlinerMappingDocument } from '../../../plugins/piecemaker-dossier/src/types.js';

type ProjectLookup = {
  getProjectPath(projectPath: string): { project_id: string; project_path: string } | null;
};

type StoreProvider = () => KnowledgeStore;

export function createMappingReadyHandler(store: StoreProvider, projects: ProjectLookup) {
  return async (caseRoot: string, mapping: GlinerMappingDocument): Promise<void> => {
    const project = projects.getProjectPath(caseRoot);
    if (!project) throw new Error('Project not found for mapping synchronization.');
    store().update({
      projectId: project.project_id,
      operations: scanResultOperations({ projectId: project.project_id, mapping, documents: [] }),
    });
  };
}
