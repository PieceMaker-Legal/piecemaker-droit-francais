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
import { KnowledgeStore, splitDocumentDate } from './knowledge.js';
import { isInstitutionalEntity } from './institutional-terms.js';
import { sentenceContaining } from './excerpt.js';

export type MarkdownReader = (document: GlinerDocument) => string | null;

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : [];
const record = (value: unknown): JsonData => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonData : {};
const nodeId = (code: string): string => `entity:${code}`;
const documentId = (id: string): string => `document:${id}`;
export function exclusionNodeOperation(values: unknown): KnowledgeUpdateOperation {
  const exclusions = strings(values);
  return { op: 'upsertNode', node: { id: EXCLUSIONS_NODE_ID, kind: 'other', label: 'Exclusions GLiNER', data: { systemRole: 'gliner-exclusions', values: exclusions } } };
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
    });
  }
  return nodes;
}

function documentOperations(documents: GlinerDocument[], nodes: Map<string, KnowledgeNodeInput>, readMarkdown?: MarkdownReader): KnowledgeUpdateOperation[] {
  const operations: KnowledgeUpdateOperation[] = [];
  for (const document of documents) {
    const id = text(document.id);
    const name = text(document.name);
    if (!id || !name) continue;
    const { date, data: metadata } = splitDocumentDate(record(document.metadata));
    operations.push({ op: 'upsertNode', node: { id: documentId(id), kind: 'document', label: name, data: { path: text(document.path), ...metadata }, date: date ?? undefined } });
    const codes = strings(document.entityCodes).filter((code) => nodes.has(code));
    const markdown = codes.length && readMarkdown ? readMarkdown(document) : null;
    for (const code of codes) {
      operations.push({ op: 'link', link: { fromNodeId: documentId(id), toNodeId: nodeId(code), relation: 'mentions', data: {} } });
      const node = nodes.get(code) as KnowledgeNodeInput;
      const excerpt = markdown ? sentenceContaining(markdown, [node.label || '', ...(node.aliases || [])].filter(Boolean)) : null;
      if (excerpt) operations.push({ op: 'cite', citation: { fromNodeId: documentId(id), toNodeId: nodeId(code), relation: 'mentions', texte: excerpt, pieceId: documentId(id) } });
    }
  }
  return operations;
}

export function scanResultOperations(result: GlinerScanResult, readMarkdown?: MarkdownReader): KnowledgeUpdateOperation[] {
  const nodes = entityNodes(result.mapping);
  const operations: KnowledgeUpdateOperation[] = [...nodes.values()].map((node) => ({ op: 'upsertNode', node }));
  operations.push(exclusionNodeOperation(result.mapping.ignored));
  for (const [code, node] of nodes) {
    for (const real of [node.label || '', ...(node.aliases || [])].filter(Boolean)) {
      operations.push({ op: 'upsertMapping', mapping: { nodeId: nodeId(code), real, masked: code, data: {} } });
    }
  }
  operations.push(...documentOperations(result.documents, nodes, readMarkdown));
  return operations;
}

export function persistScanResult(result: GlinerScanResult, store?: KnowledgeStore, readMarkdown?: MarkdownReader): KnowledgeUpdateResult {
  if (store) return store.mergeScan(result.projectId, scanResultOperations(result, readMarkdown));
  const ownedStore = new KnowledgeStore();
  try {
    return ownedStore.mergeScan(result.projectId, scanResultOperations(result, readMarkdown));
  } finally {
    ownedStore.close();
  }
}
