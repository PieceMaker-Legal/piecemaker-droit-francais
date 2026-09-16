import type {
  GlinerDocument,
  GlinerMappingDocument,
  GlinerScanResult,
  JsonData,
  KnowledgeNodeInput,
  KnowledgeUpdateOperation,
  KnowledgeUpdateResult,
  NodeKind,
} from './types.js';
import { EXCLUSIONS_NODE_ID } from './types.js';
import { KnowledgeStore } from './knowledge.js';
import { isInstitutionalEntity } from './institutional-terms.js';

type ProcedureAssignment = { field?: unknown; code?: unknown };
type ProcedureParty = {
  type?: unknown;
  position?: unknown;
  nom?: unknown;
  societe_nom?: unknown;
  forme_sociale?: unknown;
  mapping_assignments?: unknown;
};
type ProcedureRelation = { source?: unknown; target?: unknown; role?: unknown };

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : [];
const record = (value: unknown): JsonData => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonData : {};
const nodeId = (code: string): string => `entity:${code}`;
const documentId = (id: string): string => `document:${id}`;
export function exclusionNodeOperation(values: unknown, origin: 'gliner' | 'manual' = 'gliner'): KnowledgeUpdateOperation {
  const exclusions = strings(values);
  return { op: 'upsertNode', node: { id: EXCLUSIONS_NODE_ID, kind: 'other', label: 'Exclusions GLiNER', data: { systemRole: 'gliner-exclusions', values: exclusions }, origin } };
}

function kindFromCode(code: string, principal: string, bucket: string): NodeKind {
  const normalizedCode = code.replace(/\s+/g, '_').toUpperCase();
  const normalizedBucket = bucket.toLocaleLowerCase('fr');
  if (normalizedBucket.includes('personnes_physiques') || normalizedCode.includes('PERSONNE_PHYSIQUE') || normalizedCode.includes('DIRIGEANT') || normalizedCode.includes('AVOCAT')) return 'person';
  if (normalizedBucket.includes('societ') || normalizedCode.includes('MORALE') || normalizedCode.includes('SOCIETE')) return 'company';
  if (normalizedBucket.includes('adresse') || normalizedCode.startsWith('ADRESSE_') || normalizedCode.startsWith('LOCATION_')) return 'address';
  if (normalizedBucket.includes('siren') || normalizedCode.startsWith('SIREN_')) return 'siren';
  if (normalizedCode.startsWith('IBAN_') || /^[A-Z]{2}\d{2}[A-Z0-9\s]{10,34}$/i.test(principal)) return 'iban';
  if (normalizedCode.startsWith('PHONE_') || normalizedCode.startsWith('TELEPHONE_')) return 'phone';
  if (normalizedCode.startsWith('EMAIL_') || normalizedCode.startsWith('MAIL_')) return 'email';
  if (normalizedCode.startsWith('URL_') || /^(?:https?:\/\/|www\.)/i.test(principal)) return 'url';
  return 'other';
}

function extractedEntries(mapping: GlinerMappingDocument): Map<string, { bucket: string; data: JsonData }> {
  const entries = new Map<string, { bucket: string; data: JsonData }>();
  for (const [bucket, values] of Object.entries(mapping.extracted_data || {})) {
    for (const [code, data] of Object.entries(values || {})) entries.set(code, { bucket, data: record(data) });
  }
  return entries;
}

function variantsByCode(mapping: GlinerMappingDocument): Map<string, string[]> {
  const variants = new Map<string, string[]>();
  for (const [real, codeValue] of Object.entries(mapping.mapping || {})) {
    const code = text(codeValue);
    if (code) variants.set(code, [...(variants.get(code) || []), real]);
  }
  for (const [code, values] of Object.entries(mapping.reverse_mapping || {})) {
    variants.set(code, [...new Set([...(variants.get(code) || []), ...strings(Array.isArray(values) ? values : [values])])]);
  }
  return variants;
}

function entityNodes(mapping: GlinerMappingDocument): Map<string, KnowledgeNodeInput> {
  const extracted = extractedEntries(mapping);
  const variants = variantsByCode(mapping);
  const codes = new Set([...variants.keys(), ...extracted.keys()]);
  const nodes = new Map<string, KnowledgeNodeInput>();
  for (const code of codes) {
    const details = extracted.get(code);
    const detected = [...new Set([text(details?.data.original), ...(variants.get(code) || []), ...strings(details?.data.variants)].filter(Boolean))];
    if (isInstitutionalEntity(detected[0])) continue;
    const names = detected.filter((name) => !isInstitutionalEntity(name));
    const label = names[0] || code;
    nodes.set(code, {
      id: nodeId(code),
      kind: kindFromCode(code, label, details?.bucket || ''),
      label,
      aliases: names.slice(1),
      data: { code, category: details?.bucket || null, ...details?.data },
      origin: 'gliner',
    });
  }
  return nodes;
}

function procedureOperations(mapping: GlinerMappingDocument, nodes: Map<string, KnowledgeNodeInput>): KnowledgeUpdateOperation[] {
  const info = record(mapping.informations_dossier);
  const parties = [
    ...(Array.isArray(info.parties_clientes) ? info.parties_clientes.map((party) => ({ party: party as ProcedureParty, side: 'client' })) : []),
    ...(Array.isArray(info.parties_adverses) ? info.parties_adverses.map((party) => ({ party: party as ProcedureParty, side: 'adversaire' })) : []),
  ];
  const operations: KnowledgeUpdateOperation[] = [];
  for (const { party, side } of parties) {
    const assignments = (Array.isArray(party.mapping_assignments) ? party.mapping_assignments : []) as ProcedureAssignment[];
    const identity = assignments.find((assignment) => text(assignment.field) === 'identite');
    const identityCode = text(identity?.code);
    if (!identityCode) continue;
    const existing = nodes.get(identityCode);
    const label = text(party.type) === 'societe' ? text(party.societe_nom) : text(party.nom);
    if (existing) {
      nodes.set(identityCode, {
        ...existing,
        label: existing.label || label,
        data: {
          ...existing.data,
          partySide: side,
          position: text(party.position),
          ...(text(party.forme_sociale) ? { legalForm: text(party.forme_sociale) } : {}),
        },
      });
    }
    for (const assignment of assignments) {
      const targetCode = text(assignment.code);
      const field = text(assignment.field);
      if (!targetCode || !field || targetCode === identityCode || !nodes.has(targetCode)) continue;
      operations.push({ op: 'link', link: { fromNodeId: nodeId(identityCode), toNodeId: nodeId(targetCode), relation: field, data: {}, origin: 'gliner' } });
    }
  }
  const relations = (Array.isArray(info.relations) ? info.relations : []) as ProcedureRelation[];
  for (const relation of relations) {
    const source = text(relation.source);
    const target = text(relation.target);
    const role = text(relation.role);
    if (!source || !target || !role || !nodes.has(source) || !nodes.has(target)) continue;
    operations.push({ op: 'link', link: { fromNodeId: nodeId(source), toNodeId: nodeId(target), relation: role, data: {}, origin: 'gliner' } });
  }
  return operations;
}

function documentOperations(documents: GlinerDocument[], nodes: Map<string, KnowledgeNodeInput>): KnowledgeUpdateOperation[] {
  const operations: KnowledgeUpdateOperation[] = [];
  for (const document of documents) {
    const id = text(document.id);
    const name = text(document.name);
    if (!id || !name) continue;
    operations.push({ op: 'upsertNode', node: { id: documentId(id), kind: 'document', label: name, data: { path: text(document.path), ...record(document.metadata) }, origin: 'gliner' } });
    for (const code of strings(document.entityCodes)) {
      if (!nodes.has(code)) continue;
      operations.push({ op: 'link', link: { fromNodeId: documentId(id), toNodeId: nodeId(code), relation: 'mentions', data: {}, origin: 'gliner' } });
    }
  }
  return operations;
}

export function scanResultOperations(result: GlinerScanResult): KnowledgeUpdateOperation[] {
  const nodes = entityNodes(result.mapping);
  const relations = procedureOperations(result.mapping, nodes);
  const operations: KnowledgeUpdateOperation[] = [...nodes.values()].map((node) => ({ op: 'upsertNode', node }));
  operations.push(exclusionNodeOperation(result.mapping.ignored));
  for (const [code, node] of nodes) {
    for (const real of [node.label || '', ...(node.aliases || [])].filter(Boolean)) {
      operations.push({ op: 'upsertMapping', mapping: { nodeId: nodeId(code), real, masked: code, data: {}, origin: 'gliner' } });
    }
  }
  operations.push(...relations);
  operations.push(...documentOperations(result.documents, nodes));
  return operations;
}

export function persistScanResult(result: GlinerScanResult, store?: KnowledgeStore): KnowledgeUpdateResult {
  if (store) return store.replaceOrigin(result.projectId, 'gliner', scanResultOperations(result));
  const ownedStore = new KnowledgeStore();
  try {
    return ownedStore.replaceOrigin(result.projectId, 'gliner', scanResultOperations(result));
  } finally {
    ownedStore.close();
  }
}
