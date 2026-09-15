import { describe, expect, it } from 'vitest';

import { mermaidSource } from '../views.js';
import type { KnowledgeSnapshot } from '../types.js';

const snapshot: KnowledgeSnapshot = {
  projectId: 'project-1',
  nodes: [
    { id: 'doc', projectId: 'project-1', kind: 'document', label: 'Contrat', aliases: [], data: {}, origin: 'gliner', createdAt: '', updatedAt: '' },
    { id: 'client', projectId: 'project-1', kind: 'company', label: 'Société cliente', aliases: [], data: { partySide: 'client' }, origin: 'manual', createdAt: '', updatedAt: '' },
    { id: 'adverse', projectId: 'project-1', kind: 'person', label: 'Mme Adverse', aliases: [], data: { partySide: 'adversaire' }, origin: 'manual', createdAt: '', updatedAt: '' },
    { id: 'iban', projectId: 'project-1', kind: 'iban', label: 'IBAN 1', aliases: [], data: {}, origin: 'gliner', createdAt: '', updatedAt: '' },
  ],
  links: [
    { projectId: 'project-1', fromNodeId: 'doc', toNodeId: 'client', relation: 'mentions', data: {}, origin: 'gliner' },
    { projectId: 'project-1', fromNodeId: 'client', toNodeId: 'iban', relation: 'iban', data: {}, origin: 'manual' },
  ],
  mappings: [],
};

describe('Mermaid dossier graph', () => {
  it('centers selected parties and assigns distinct client and adverse colors', () => {
    const source = mermaidSource(snapshot);
    expect(source).toContain('subgraph center[Parties]');
    expect(source).toContain('subgraph clients[Parties clientes]');
    expect(source).toContain('subgraph adversaires[Parties adverses]');
    expect(source).toContain('class n_client client');
    expect(source).toContain('class n_adverse adverse');
    expect(source).toContain('n_doc ~~~ n_client');
    expect(source).toContain('n_client ~~~ n_iban');
  });
});
