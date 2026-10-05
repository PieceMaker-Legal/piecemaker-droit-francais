import type { KnowledgeUpdateOperation } from './types.js';

export type DeleteScope = 'dossier' | 'tous';

const key = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();

export function deleteEntityOperations(nodeId: string, values: string[], scope: DeleteScope): KnowledgeUpdateOperation[] {
  if (scope === 'tous') return [{ op: 'deleteNode', nodeId }];
  const terms = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return [...terms.map((term): KnowledgeUpdateOperation => ({ op: 'excludeTerm', term })), { op: 'deleteNode', nodeId }];
}

export function removedAliasOperations(nodeId: string, before: string[], after: string[]): KnowledgeUpdateOperation[] {
  const kept = new Set(after.map(key));
  const removed = [...new Set(before.map((value) => value.trim()).filter(Boolean))].filter((value) => !kept.has(key(value)));
  return removed.map((alias): KnowledgeUpdateOperation => ({ op: 'excludeAlias', exclusion: { entite: nodeId, alias } }));
}
