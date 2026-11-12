import { classificationApi } from './api.js';
import { treeChanges } from './classification.js';
import { okfApi, type PendingProposals } from './okf.js';
import { ontologyChanges } from './ontology-proposal.js';

export async function pendingProposals(projectId: string, projectPath: string): Promise<PendingProposals> {
  const [ontology, tree] = await Promise.all([okfApi.ontology(projectId).catch(() => null), classificationApi.read(projectPath).catch(() => null)]);
  return {
    ontologie: ontology?.proposition ? ontologyChanges(ontology.relations, ontology.proposition.relations).length || 1 : 0,
    arborescence: tree?.proposition ? treeChanges(tree.folders, tree.proposition.dossiers).length || 1 : 0,
  };
}
