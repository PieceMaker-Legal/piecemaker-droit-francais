import { describe, expect, it } from 'vitest';

import { chronologyView, networkGraphData } from '../views.js';
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

describe('vis-network dossier graph', () => {
  it('places documents, selected parties and related entities on three levels', () => {
    const graph = networkGraphData(snapshot);
    expect(graph.nodes.find((node) => node.id === 'doc')).toMatchObject({ group: 'document', level: 0 });
    expect(graph.nodes.find((node) => node.id === 'client')).toMatchObject({ group: 'client', level: 1 });
    expect(graph.nodes.find((node) => node.id === 'adverse')).toMatchObject({ group: 'adverse', level: 1 });
    expect(graph.nodes.find((node) => node.id === 'iban')).toMatchObject({ group: 'financial', level: 2 });
    expect(graph.edges).toEqual(expect.arrayContaining([expect.objectContaining({ from: 'doc', to: 'client', label: 'mentions' })]));
  });
});

describe('chronology document cards', () => {
  it('marks the whole document event as an editor trigger', () => {
    const html = chronologyView({
      overview: { projectId: 'project-1', counts: { document: 1 }, total: 1 },
      mapping: { projectId: 'project-1', nodes: [], mappings: [], exclusions: [] },
      chronology: { projectId: 'project-1', documents: [snapshot.nodes[0]], links: [] },
      graph: snapshot,
    });

    expect(html).toContain('data-open-document="doc"');
    expect(html).toContain('aria-label="Modifier Contrat"');
  });
});
