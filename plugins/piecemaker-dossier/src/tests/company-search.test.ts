import { describe, expect, it } from 'vitest';

import { buildCompanyValidationOperations } from '../company-search.js';
import type { CompanySearchResult } from '../api.js';
import type { KnowledgeSnapshot } from '../types.js';

const graph: KnowledgeSnapshot = {
  projectId: 'project-1',
  nodes: [],
  links: [],
  mappings: [],
  citations: [],
};

const result: CompanySearchResult = {
  name: 'Société Alpha',
  siren: '123456789',
  summary: 'SAS · en activité',
  url: 'https://registre-public.com/?e=123456789',
  details: 'Fiche complète',
  fields: {
    legalName: 'Société Alpha',
    legalForm: 'SAS',
    status: 'En activité',
    siren: '123456789',
    siret: '12345678900010',
    vat: 'FR12123456789',
    legalFormCode: '5710',
    naf: '62.01Z',
    creationDate: '2020-01-01',
    category: 'PME',
    address: '1 rue du Test, 75001 Paris',
    directors: [{ name: 'Alice Martin', role: 'Présidente' }],
    finances: ['Finances 2024 : CA 100 EUR'],
    source: 'https://registre-public.com/?e=123456789',
  },
};

describe('company search validation', () => {
  it('stores the validated company and its returned identifiers with pseudonymous codes', () => {
    const operations = buildCompanyValidationOperations(result, {
      nodeId: 'manual:company',
      node: null,
      partySide: 'client',
      position: 'demandeur',
      legalForm: 'SAS',
    }, graph);

    const company = operations.find((operation) => operation.op === 'upsertNode' && operation.node.kind === 'company');
    const sirenMapping = operations.find((operation) => operation.op === 'upsertMapping' && operation.mapping.real === '123456789');
    const director = operations.find((operation) => operation.op === 'upsertNode' && operation.node.label === 'Alice Martin');
    const directorLink = operations.find((operation) => operation.op === 'link' && operation.link.relation === 'dirigeant');

    expect(company?.op === 'upsertNode' && company.node.data.code).toMatch(/^CLIENT_DEMANDEUR_SAS_01$/);
    expect(sirenMapping?.op === 'upsertMapping' && sirenMapping.mapping.masked).toBe('SIREN_01');
    expect(director?.op === 'upsertNode' && director.node.data.code).toBe('PERSONNE_PHYSIQUE_01');
    expect(directorLink?.op === 'link' && directorLink.link.data?.source).toBe('registre-public');
  });

  it('cites the public register for every link it creates', () => {
    const operations = buildCompanyValidationOperations(result, {
      nodeId: 'manual:company',
      node: null,
      partySide: 'client',
      position: 'demandeur',
      legalForm: 'SAS',
    }, graph);

    const citations = operations.flatMap((operation) => operation.op === 'cite' ? [operation.citation] : []);
    const links = operations.flatMap((operation) => operation.op === 'link' ? [operation.link] : []);

    expect(links.length).toBeGreaterThan(0);
    expect(citations).toHaveLength(links.length);
    expect(citations.every((citation) => citation.source === 'Registre national des entreprises')).toBe(true);
    expect(citations.find((citation) => citation.relation === 'SIREN')?.texte).toBe('123456789');
    expect(citations.find((citation) => citation.relation === 'dirigeant')?.texte).toBe('Alice Martin');
    for (const citation of citations) expect(links).toContainEqual(expect.objectContaining({ fromNodeId: citation.fromNodeId, toNodeId: citation.toNodeId, relation: citation.relation }));
  });
});
