import type { KnowledgeCitation, KnowledgeLink, KnowledgeNode, KnowledgeUpdateOperation } from './types.js';

export type PendingCitation = { entityId: string; texte: string };

export type PieceEditInput = {
  pieceId: string;
  mentionLinks: Array<Pick<KnowledgeLink, 'fromNodeId' | 'toNodeId' | 'relation'>>;
  selected: ReadonlySet<string>;
  removedCitationIds: ReadonlySet<number>;
  pending: PendingCitation[];
  renamed: (id: string) => string;
};

const MENTIONS = 'mentions';

export function pieceMentionOperations(input: PieceEditInput): KnowledgeUpdateOperation[] {
  const { pieceId, selected, renamed } = input;
  const current = input.mentionLinks.map((link) => {
    const fromNodeId = renamed(link.fromNodeId);
    const toNodeId = renamed(link.toNodeId);
    return { fromNodeId, toNodeId, relation: link.relation, entity: link.fromNodeId === pieceId ? toNodeId : fromNodeId };
  });
  const operations: KnowledgeUpdateOperation[] = [];
  for (const link of current) {
    if (selected.has(link.entity)) continue;
    operations.push({ op: 'unlink', link: { fromNodeId: link.fromNodeId, toNodeId: link.toNodeId, relation: link.relation } });
    operations.push({ op: 'excludeLink', exclusion: { piece: pieceId, entite: link.entity, relation: link.relation } });
  }
  const linked = new Set(current.map((link) => link.entity));
  for (const entity of selected) {
    if (!linked.has(entity)) operations.push({ op: 'link', link: { fromNodeId: pieceId, toNodeId: entity, relation: MENTIONS } });
  }
  for (const id of [...input.removedCitationIds].sort((left, right) => left - right)) operations.push({ op: 'uncite', id });
  const seen = new Set<string>();
  for (const entry of input.pending) {
    const entity = renamed(entry.entityId);
    const key = `${entity}\u0000${entry.texte}`;
    if (!selected.has(entity) || seen.has(key)) continue;
    seen.add(key);
    const existing = current.find((link) => link.entity === entity);
    operations.push({ op: 'cite', citation: { fromNodeId: existing?.fromNodeId ?? pieceId, toNodeId: existing?.toNodeId ?? entity, relation: existing?.relation ?? MENTIONS, texte: entry.texte, pieceId } });
  }
  return operations;
}

export function citationsOfMention(citations: KnowledgeCitation[], pieceId: string, entityId: string, renamed: (id: string) => string = (id) => id): KnowledgeCitation[] {
  return citations.filter((citation) => citation.relation === MENTIONS && citation.fromNodeId === pieceId && renamed(citation.toNodeId) === entityId);
}

export function citationsOfEntity(citations: KnowledgeCitation[], entityId: string): KnowledgeCitation[] {
  return citations.filter((citation) => citation.toNodeId === entityId);
}

export function citationSource(citation: Pick<KnowledgeCitation, 'pieceId' | 'source'>, nodes: KnowledgeNode[]): string {
  if (citation.pieceId) return nodes.find((node) => node.id === citation.pieceId)?.label || citation.pieceId;
  return citation.source || '';
}

export function citableEntities(nodes: KnowledgeNode[], cited: ReadonlySet<string>): KnowledgeNode[] {
  const byLabel = (left: KnowledgeNode, right: KnowledgeNode) => left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' });
  const people = nodes.filter((node) => node.kind === 'person' || node.kind === 'company');
  return [...people.filter((node) => cited.has(node.id)).sort(byLabel), ...people.filter((node) => !cited.has(node.id)).sort(byLabel)];
}
