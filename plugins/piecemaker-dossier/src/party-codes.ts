import type { JsonData, KnowledgeMapping, KnowledgeNode, KnowledgeUpdateOperation, NodeKind } from './types.js';

const LEGAL_FORM_TOKENS = new Set([
  'SELARL', 'SELAS', 'SELCA', 'SELCS', 'SASU', 'SARL', 'EURL', 'EARL',
  'SCOP', 'SCIC', 'GAEC', 'SAS', 'SCI', 'SCA', 'SCS', 'SCP', 'SCM', 'SNC',
  'GIE', 'SLP', 'SEL', 'SEM', 'EEIG', 'CIC', 'CIO', 'CLG', 'RTM', 'PLC', 'LTD',
  'LLLP', 'PLLC', 'LLC', 'LLP', 'INC', 'CORP', 'LP', 'GP', 'PC', 'PA', 'CO',
  'PARTG', 'GMBH', 'KGAA', 'OHG', 'GBR', 'KG', 'AG', 'UG', 'EG', 'EK',
  'SE', 'SA', 'BV', 'NV', 'SPA', 'SRL', 'SL', 'LDA', 'AB', 'OY', 'APS', 'AS',
  'PTYLTD', 'PVTLTD',
]);

export const PROCEDURE_POSITIONS = [
  { value: 'demandeur', label: 'Demandeur' },
  { value: 'defendeur', label: 'Défendeur' },
  { value: 'appelant', label: 'Appelant' },
  { value: 'intime', label: 'Intimé' },
  { value: 'requerant', label: 'Requérant' },
  { value: 'mis_en_cause', label: 'Mis en cause' },
  { value: 'intervenant', label: 'Intervenant' },
  { value: 'autre', label: 'Autre' },
] as const;

export type PartySide = 'client' | 'adversaire' | 'tiers' | '';

export type PartyIdentity = {
  kind: NodeKind;
  legalForm?: string;
  side: PartySide;
  position?: string;
};

export type PartyCodeChange = {
  nodeId: string;
  code: string;
  data: JsonData;
  operations: KnowledgeUpdateOperation[];
};

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const entityId = (code: string): string => `entity:${code}`;
const isPartyCode = (code: string): boolean => /^(CLIENT|ADVERSAIRE)_/.test(code);

export function codeToken(value: unknown, fallback = 'AUTRE'): string {
  return clean(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback;
}

export function companyFormToken(value: unknown): string {
  const collapsed = clean(value)
    .replace(/\./g, '')
    .replace(/\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/g, (match) => match.replace(/\s+/g, ''));
  const token = codeToken(collapsed, 'PERSONNE_MORALE');
  return LEGAL_FORM_TOKENS.has(token) ? token : token.split('_').find((part) => LEGAL_FORM_TOKENS.has(part)) || token;
}

export function nodeCode(node: Pick<KnowledgeNode, 'id' | 'data'>): string {
  return clean(node.data.code) || (node.id.startsWith('entity:') ? node.id.slice('entity:'.length) : '');
}

function numberedCode(prefix: string, used: Set<string>, current: string): string {
  if (current.startsWith(`${prefix}_`) && /^\d+$/.test(current.slice(prefix.length + 1))) return current;
  let number = 1;
  while (used.has(`${prefix}_${String(number).padStart(2, '0')}`)) number += 1;
  return `${prefix}_${String(number).padStart(2, '0')}`;
}

export function partyCode(identity: PartyIdentity, current: string, used: Set<string>, originalCode = ''): string {
  if (identity.side !== 'client' && identity.side !== 'adversaire') {
    if (originalCode && (originalCode === current || !used.has(originalCode))) return originalCode;
    return numberedCode(identity.kind === 'company' ? 'PERSONNE_MORALE' : 'PERSONNE_PHYSIQUE', used, current);
  }
  const sideToken = identity.side === 'client' ? 'CLIENT' : 'ADVERSAIRE';
  const fallbackPosition = identity.side === 'client' ? 'DEMANDEUR' : 'DEFENDEUR';
  const positionToken = codeToken(identity.position, fallbackPosition);
  const formToken = identity.kind === 'company' ? companyFormToken(identity.legalForm) : 'PERSONNE_PHYSIQUE';
  return numberedCode(`${sideToken}_${positionToken}_${formToken}`, used, current);
}

export function partyCodeChange(
  node: Pick<KnowledgeNode, 'id' | 'kind' | 'data'>,
  identity: PartyIdentity,
  nodes: Array<Pick<KnowledgeNode, 'id' | 'data'>>,
  mappings: KnowledgeMapping[],
): PartyCodeChange {
  const current = nodeCode(node);
  const used = new Set(nodes.filter((entry) => entry.id !== node.id).map((entry) => nodeCode(entry)).filter(Boolean));
  for (const mapping of mappings) {
    if (mapping.nodeId !== node.id && clean(mapping.masked)) used.add(clean(mapping.masked));
  }
  const originalCode = clean(node.data.originalCode) || (isPartyCode(current) ? '' : current);
  const code = partyCode(identity, current, used, originalCode);
  const nodeId = code ? entityId(code) : node.id;
  const side = identity.side === 'client' || identity.side === 'adversaire' ? identity.side : identity.side || null;
  const data: JsonData = {
    ...node.data,
    code: code || undefined,
    partySide: side,
    position: clean(identity.position) || null,
    originalCode: originalCode || undefined,
  };
  const operations: KnowledgeUpdateOperation[] = nodeId === node.id
    ? []
    : [{ op: 'renameNode', rename: { fromNodeId: node.id, toNodeId: nodeId } }];
  return { nodeId, code, data, operations };
}
