import { classificationApi } from './api.js';
import { treeChanges } from './classification.js';
import type { PendingProposals } from './okf.js';

export async function pendingProposals(projectPath: string): Promise<PendingProposals> {
  const tree = await classificationApi.read(projectPath).catch(() => null);
  return { arborescence: tree?.proposition ? treeChanges(tree.folders, tree.proposition.dossiers).length || 1 : 0 };
}
