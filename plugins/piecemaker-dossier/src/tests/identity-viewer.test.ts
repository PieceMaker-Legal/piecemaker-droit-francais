import { describe, expect, it } from 'vitest';

import { locateWord, mappingRows, variantOperations, writingRemovalOperations } from '../identity-viewer.js';
import type { KnowledgeMapping, KnowledgeNode, KnowledgeSnapshot } from '../types.js';

const node = (projectId: string, id: string, label: string, aliases: string[] = [], kind: KnowledgeNode['kind'] = 'person'): KnowledgeNode => ({ projectId, id, kind, label, aliases, data: { code: id.replace('entity:', '') }, createdAt: '', updatedAt: '' });
const mapping = (projectId: string, nodeId: string, real: string, masked: string): KnowledgeMapping => ({ projectId, nodeId, real, masked, data: {} });

const graphs = (): Map<string, KnowledgeSnapshot> => new Map([
  ['dossier-a', {
    projectId: 'dossier-a',
    nodes: [
      node('dossier-a', 'entity:PERSONNE_PHYSIQUE_01', 'Jean Dupont', ['J. Dupont']),
      node('dossier-a', 'document:1', 'Contrat.pdf', [], 'document'),
    ],
    links: [],
    mappings: [
      mapping('dossier-a', 'entity:PERSONNE_PHYSIQUE_01', 'Jean Dupont', 'PERSONNE_PHYSIQUE_01'),
      mapping('dossier-a', 'entity:PERSONNE_PHYSIQUE_01', 'J. Dupont', 'PERSONNE_PHYSIQUE_01'),
    ],
  }],
  ['dossier-b', {
    projectId: 'dossier-b',
    nodes: [node('dossier-b', 'entity:PERSONNE_MORALE_01', 'Société Exemple SAS', [], 'company')],
    links: [],
    mappings: [mapping('dossier-b', 'entity:PERSONNE_MORALE_01', 'Société Exemple SAS', 'PERSONNE_MORALE_01')],
  }],
]);

describe('locateWord', () => {
  it('retrouve le pseudonyme et son dossier quelle que soit la casse', () => {
    expect(locateWord('société exemple sas', graphs())).toEqual([{ projectId: 'dossier-b', nodeId: 'entity:PERSONNE_MORALE_01', word: 'Société Exemple SAS' }]);
  });

  it('retrouve une entité depuis son code', () => {
    expect(locateWord('PERSONNE_PHYSIQUE_01', graphs())).toEqual([{ projectId: 'dossier-a', nodeId: 'entity:PERSONNE_PHYSIQUE_01', word: 'Jean Dupont' }]);
  });

  it('ne renvoie rien pour un mot inconnu', () => {
    expect(locateWord('Paris', graphs())).toEqual([]);
  });
});

describe('mappingRows', () => {
  it('liste une ligne par écriture, tous dossiers confondus, sans les documents', () => {
    const rows = mappingRows(graphs(), [{ projectId: 'dossier-b', name: 'B', mappings: 1 }, { projectId: 'dossier-a', name: 'A', mappings: 2 }]);
    expect(rows.map((row) => [row.projectId, row.masked, row.real])).toEqual([
      ['dossier-b', 'PERSONNE_MORALE_01', 'Société Exemple SAS'],
      ['dossier-a', 'PERSONNE_PHYSIQUE_01', 'J. Dupont'],
      ['dossier-a', 'PERSONNE_PHYSIQUE_01', 'Jean Dupont'],
    ]);
  });
});

describe('variantOperations', () => {
  it('rattache une autre écriture au code de l’entité', () => {
    const graph = graphs().get('dossier-a')!;
    const operations = variantOperations(graph.nodes[0], graph, '  M. Dupont ');
    expect(operations[0]).toMatchObject({ op: 'upsertNode', node: { aliases: ['J. Dupont', 'M. Dupont'] } });
    expect(operations[1]).toEqual({ op: 'upsertMapping', mapping: { nodeId: 'entity:PERSONNE_PHYSIQUE_01', real: 'M. Dupont', masked: 'PERSONNE_PHYSIQUE_01', origin: 'manual' } });
  });
});

describe('writingRemovalOperations', () => {
  it('retire une écriture et promeut la suivante quand le nom principal disparaît', () => {
    const graph = graphs().get('dossier-a')!;
    expect(writingRemovalOperations(graph.nodes[0], graph, 'Jean Dupont')).toEqual([
      { op: 'upsertNode', node: { id: 'entity:PERSONNE_PHYSIQUE_01', kind: 'person', label: 'J. Dupont', aliases: [], data: { code: 'PERSONNE_PHYSIQUE_01' }, origin: 'manual' } },
      { op: 'deleteMapping', mapping: { nodeId: 'entity:PERSONNE_PHYSIQUE_01', real: 'Jean Dupont' } },
    ]);
  });

  it('supprime l’entité quand sa dernière écriture est retirée', () => {
    const graph = graphs().get('dossier-b')!;
    expect(writingRemovalOperations(graph.nodes[0], graph, 'Société Exemple SAS')).toEqual([{ op: 'deleteNode', nodeId: 'entity:PERSONNE_MORALE_01' }]);
  });
});
