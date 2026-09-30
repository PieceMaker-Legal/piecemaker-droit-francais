import type {
  JsonData,
  KnowledgeNode,
  KnowledgeQueryResult,
  KnowledgeResolvedNode,
  KnowledgeSnapshot,
  NodeKind,
} from '../../../plugins/piecemaker-dossier/src/types.js';

/**
 * Fiches du dossier telles que les outils de l'assistant les lisent : une
 * personne (ou société, adresse…) avec tous ses champs, ses orthographes et
 * ses liens vers les autres fiches. Les pièces en sont exclues — l'assistant
 * les retrouve lui-même dans le dossier.
 */

export const SEARCH_DEPTH = 2;

/**
 * Champs qui fixent le code de pseudonymisation (partie, position, forme
 * sociale) ou qui servent au pipeline : les changer sans renommer la fiche
 * désynchroniserait code et données. Ils restent l'affaire de l'onglet Dossier.
 */
export const RESERVED_FIELDS = new Set(['code', 'originalCode', 'category', 'partySide', 'position', 'legalForm', 'systemRole']);

export type EntityRelation = {
  relation: string;
  direction: 'outgoing' | 'incoming';
  data?: JsonData;
  entity: EntityCard;
};

export type EntityCard = {
  id: string;
  code: string;
  kind: NodeKind;
  label: string;
  aliases: string[];
  variants: Array<{ real: string; masked: string }>;
  data: JsonData;
  relations?: EntityRelation[];
  updatedAt: string;
};

export type EntitySearchResult = {
  query: string;
  kind: NodeKind | null;
  matches: EntityCard[];
  ambiguous: boolean;
  truncated: boolean;
};

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const comparable = (value: string): string => value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('fr').replace(/\s+/g, ' ').trim();
const isEntity = (node: Pick<KnowledgeNode, 'id' | 'kind'>): boolean => node.kind !== 'document' && !node.id.startsWith('system:');

export function entityCode(node: Pick<KnowledgeNode, 'id' | 'data'>): string {
  return text(node.data.code) || (node.id.startsWith('entity:') ? node.id.slice('entity:'.length) : '');
}

export function entityCard(node: KnowledgeResolvedNode, depth: number): EntityCard {
  const card: EntityCard = {
    id: node.id,
    code: entityCode(node),
    kind: node.kind,
    label: node.label,
    aliases: node.aliases,
    variants: node.mappings.map(({ real, masked }) => ({ real, masked })),
    data: node.data,
    updatedAt: node.updatedAt,
  };
  if (depth <= 0) return card;
  card.relations = node.links.flatMap((link) => {
    // Un lien sans nœud résolu est un cycle ou la limite de profondeur : on ne
    // sait pas s'il mène à une pièce, il n'apprend rien.
    if (!link.node || link.relation === 'mentions' || !isEntity(link.node)) return [];
    return [{
      relation: link.relation,
      direction: link.direction,
      ...(Object.keys(link.data).length ? { data: link.data } : {}),
      entity: entityCard(link.node, depth - 1),
    }];
  });
  return card;
}

export function entitySearchResult(result: KnowledgeQueryResult): EntitySearchResult {
  const matches = result.matches.filter(isEntity).map((node) => entityCard(node, result.depth));
  return { query: result.query, kind: result.kind, matches, ambiguous: matches.length > 1, truncated: result.truncated };
}

/**
 * Fiche désignée par l'assistant : son code, son identifiant, ou l'un de ses
 * noms — le proxy peut avoir remis le nom réel à la place du code dans
 * l'appel d'outil. Une désignation qui vise plusieurs fiches est refusée.
 */
export function resolveEntity(snapshot: KnowledgeSnapshot, target: unknown): KnowledgeNode {
  const wanted = text(target);
  if (!wanted) throw new TypeError('La personne à modifier est requise (code ou nom).');
  const entities = snapshot.nodes.filter(isEntity);
  const byCode = entities.filter((node) => node.id === wanted || node.id === `entity:${wanted}` || entityCode(node) === wanted);
  if (byCode.length === 1) return byCode[0];
  const key = comparable(wanted);
  const named = new Set<string>();
  for (const node of entities) {
    if ([node.label, ...node.aliases].some((name) => comparable(name) === key)) named.add(node.id);
  }
  for (const mapping of snapshot.mappings) {
    if (comparable(mapping.real) === key || comparable(mapping.masked) === key) named.add(mapping.nodeId);
  }
  const candidates = entities.filter((node) => named.has(node.id));
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) throw new TypeError(`Aucune fiche du dossier ne correspond à « ${wanted} ». Cherchez-la d'abord.`);
  throw new TypeError(`« ${wanted} » désigne plusieurs fiches (${candidates.map(entityCode).filter(Boolean).join(', ')}) : précisez le code.`);
}

function containsNull(value: unknown): boolean {
  return value === null || (typeof value === 'object' && Object.values(value as object).some(containsNull));
}

export function validateFields(fields: unknown): JsonData {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new TypeError('Les champs doivent être un objet { nom: valeur }.');
  const entries = Object.entries(fields as JsonData).map(([name, value]) => [name.trim(), value] as const);
  if (!entries.length) throw new TypeError('Aucun champ à enregistrer.');
  const reserved = entries.map(([name]) => name).filter((name) => RESERVED_FIELDS.has(name));
  if (reserved.length) throw new TypeError(`Champ(s) réservé(s) à l'onglet Dossier : ${reserved.join(', ')}.`);
  if (entries.some(([name]) => !name)) throw new TypeError('Un nom de champ est vide.');
  if (entries.some(([, value]) => value === undefined || containsNull(value))) throw new TypeError('Une valeur de champ est vide (null) : donnez une valeur.');
  return Object.fromEntries(entries);
}
