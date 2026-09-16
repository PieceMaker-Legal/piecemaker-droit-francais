import type { CompanySearchResult } from './api.js';
import { nodeCode, partyCodeChange } from './party-codes.js';
import type { PartySide } from './party-codes.js';
import type { JsonData, KnowledgeNode, KnowledgeSnapshot, KnowledgeUpdateOperation, NodeKind } from './types.js';

type CompanyValidationInput = {
  nodeId: string;
  node: KnowledgeNode | null;
  partySide: PartySide;
  position: string;
  legalForm: string;
};

type ValueEntity = {
  value: string;
  kind: NodeKind;
  prefix: string;
  relation: string;
};

type EntityReference = { code: string; nodeId: string };

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

function allocateCode(prefix: string, used: Set<string>): string {
  let number = 1;
  let code = `${prefix}_${String(number).padStart(2, '0')}`;
  while (used.has(code)) {
    number += 1;
    code = `${prefix}_${String(number).padStart(2, '0')}`;
  }
  used.add(code);
  return code;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))];
}

export function buildCompanyValidationOperations(result: CompanySearchResult, input: CompanyValidationInput, graph: KnowledgeSnapshot): KnowledgeUpdateOperation[] {
  const fields = result.fields;
  const legalName = clean(fields.legalName) || clean(result.name);
  const currentLabel = clean(input.node?.label);
  const aliases = unique([...(input.node?.aliases || []), currentLabel, clean(result.name)]).filter((value) => value !== legalName);
  const companyChange = partyCodeChange(
    { id: input.nodeId, kind: 'company', data: input.node?.data || {} },
    { kind: 'company', legalForm: fields.legalForm || input.legalForm, side: input.partySide, position: input.position },
    graph.nodes,
    graph.mappings,
  );
  const usedCodes = new Set([
    ...graph.nodes.map((node) => nodeCode(node)),
    ...graph.mappings.map((mapping) => clean(mapping.masked)),
    companyChange.code,
  ].filter(Boolean));
  const operations: KnowledgeUpdateOperation[] = [...companyChange.operations];
  const references = new Map<string, EntityReference>();
  const fieldOperations: Array<{ entity: ValueEntity; reference: EntityReference }> = [];
  const existingMapping = (value: string): EntityReference | null => {
    const mapping = graph.mappings.find((entry) => entry.real === value);
    return mapping ? { code: mapping.masked, nodeId: mapping.nodeId } : null;
  };
  const addValueEntity = (entity: ValueEntity, includeRelation = true): EntityReference | null => {
    const value = clean(entity.value);
    if (!value) return null;
    const key = `${entity.kind}:${value}`;
    const cached = references.get(key);
    if (cached) return cached;
    const existing = existingMapping(value);
    if (existing) {
      references.set(key, existing);
      if (includeRelation) fieldOperations.push({ entity: { ...entity, value }, reference: existing });
      return existing;
    }
    const code = allocateCode(entity.prefix, usedCodes);
    const nodeId = `entity:${code}`;
    const data: JsonData = { code, source: 'registre-public' };
    operations.push({ op: 'upsertNode', node: { id: nodeId, kind: entity.kind, label: value, aliases: [], data, origin: 'manual' } });
    operations.push({ op: 'upsertMapping', mapping: { nodeId, real: value, masked: code, data: { source: 'registre-public' }, origin: 'manual' } });
    const reference = { code, nodeId };
    references.set(key, reference);
    if (includeRelation) fieldOperations.push({ entity: { ...entity, value }, reference });
    return reference;
  };
  const fieldReferences = new Map<string, EntityReference>();
  for (const entity of [
    { value: fields.siren, kind: 'siren' as const, prefix: 'SIREN', relation: 'SIREN' },
    { value: fields.siret, kind: 'other' as const, prefix: 'SIRET', relation: 'SIRET' },
    { value: fields.vat, kind: 'other' as const, prefix: 'TVA', relation: 'TVA' },
    { value: fields.address, kind: 'address' as const, prefix: 'ADRESSE', relation: 'adresse' },
    { value: fields.source || result.url, kind: 'url' as const, prefix: 'URL', relation: 'URL' },
  ]) {
    const reference = addValueEntity(entity);
    if (reference) fieldReferences.set(entity.relation, reference);
  }
  const directorReferences = fields.directors.map((director) => ({
    director,
    reference: addValueEntity({ value: director.name, kind: 'person', prefix: 'PERSONNE_PHYSIQUE', relation: 'dirigeant' }, false),
  })).filter((entry): entry is { director: { name: string; role: string }; reference: EntityReference } => Boolean(entry.reference));
  const companyData: JsonData = {
    ...(input.node?.data || {}),
    ...companyChange.data,
    legalForm: fields.legalForm || input.legalForm || null,
    registrePublic: {
      provider: 'registre-public.com',
      status: fields.status,
      legalForm: fields.legalForm,
      legalFormCode: fields.legalFormCode,
      naf: fields.naf,
      creationDate: fields.creationDate,
      category: fields.category,
      siren: fieldReferences.get('SIREN')?.code || null,
      siret: fieldReferences.get('SIRET')?.code || null,
      vat: fieldReferences.get('TVA')?.code || null,
      address: fieldReferences.get('adresse')?.code || null,
      source: fields.source || result.url,
      directors: directorReferences.map(({ director, reference }) => ({ code: reference.code, role: director.role })),
      finances: fields.finances,
    },
  };
  operations.push({ op: 'upsertNode', node: { id: companyChange.nodeId, kind: 'company', label: legalName, aliases, data: companyData, origin: 'manual' } });
  for (const real of unique([legalName, ...aliases])) operations.push({ op: 'upsertMapping', mapping: { nodeId: companyChange.nodeId, real, masked: companyChange.code, origin: 'manual' } });
  for (const { entity, reference } of fieldOperations) {
    operations.push({ op: 'link', link: { fromNodeId: companyChange.nodeId, toNodeId: reference.nodeId, relation: entity.relation, data: { source: 'registre-public' }, origin: 'manual' } });
  }
  for (const { director, reference } of directorReferences) {
    operations.push({ op: 'upsertNode', node: { id: reference.nodeId, kind: 'person', label: director.name, aliases: [], data: { code: reference.code, role: director.role, source: 'registre-public' }, origin: 'manual' } });
    operations.push({ op: 'link', link: { fromNodeId: companyChange.nodeId, toNodeId: reference.nodeId, relation: 'dirigeant', data: { role: director.role, source: 'registre-public' }, origin: 'manual' } });
  }
  return operations;
}
