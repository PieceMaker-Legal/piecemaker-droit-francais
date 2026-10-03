import { describe, expect, it } from 'vitest';

import { changeNodeSide, createEntity, findEntityBySelection, parseSelectionDate } from '../selection-categories.js';
import type { SelectionGraph } from '../selection-categories.js';
import type { KnowledgeMapping, KnowledgeNode } from '../types.js';

const node = (id: string, kind: 'person' | 'company', label: string, data: Record<string, unknown> = {}, aliases: string[] = []): KnowledgeNode => ({ projectId: 'p', id, kind, label, aliases, data, createdAt: '', updatedAt: '' });
const mapping = (nodeId: string, real: string, masked: string): KnowledgeMapping => ({ projectId: 'p', nodeId, real, masked, data: {} });

const graph = (): SelectionGraph => ({
  nodes: [
    node('entity:CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01', 'person', 'Jean Dupont', { partySide: 'client', code: 'CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01' }, ['J. Dupont']),
    node('entity:PERSONNE_MORALE_01', 'company', 'Société Exemple SAS', { code: 'PERSONNE_MORALE_01' }),
  ],
  mappings: [
    mapping('entity:CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01', 'Jean Dupont', 'CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01'),
    mapping('entity:PERSONNE_MORALE_01', 'Société Exemple SAS', 'PERSONNE_MORALE_01'),
    mapping('entity:PERSONNE_MORALE_01', 'ZETABIO', 'PERSONNE_MORALE_01'),
  ],
});

describe('parseSelectionDate', () => {
  it.each([
    ['12/03/2025', '2025-03-12'],
    ['1-2-2024', '2024-02-01'],
    ['05.11.2023', '2023-11-05'],
    ['2025-03-12', '2025-03-12'],
    ['12 mars 2025', '2025-03-12'],
    ['1er février 2024', '2024-02-01'],
    ['1ER FEVRIER 2024', '2024-02-01'],
    ['le 3 août 2022', '2022-08-03'],
  ])('parses %s', (input, expected) => expect(parseSelectionDate(input)).toBe(expected));

  it.each(['31/02/2025', '12 marsss 2025', '00/01/2025', 'hier', ''])('rejects %s', (input) => expect(parseSelectionDate(input)).toBeNull());
});

describe('findEntityBySelection', () => {
  it('matches label, alias and mapping real, ignoring case, accents and spacing', () => {
    expect(findEntityBySelection('  jean   DUPONT ', graph())?.label).toBe('Jean Dupont');
    expect(findEntityBySelection('J. Dupont,', graph())?.label).toBe('Jean Dupont');
    expect(findEntityBySelection('societe exemple sas', graph())?.id).toBe('entity:PERSONNE_MORALE_01');
    expect(findEntityBySelection('zetabio', graph())?.id).toBe('entity:PERSONNE_MORALE_01');
  });

  it('returns null when nothing matches', () => {
    expect(findEntityBySelection('Marie Martin', graph())).toBeNull();
    expect(findEntityBySelection('   ', graph())).toBeNull();
  });
});

describe('createEntity', () => {
  it('creates a node with a unique code and a mapping', () => {
    const first = createEntity('  Marie   Martin ', 'person', 'adversaire', graph());
    expect(first.nodeId).toBe('entity:ADVERSAIRE_DEFENDEUR_PERSONNE_PHYSIQUE_01');
    expect(first.operations).toEqual([
      { op: 'upsertNode', node: expect.objectContaining({ id: first.nodeId, kind: 'person', label: 'Marie Martin', aliases: [], origin: 'manual' }) },
      { op: 'upsertMapping', mapping: { nodeId: first.nodeId, real: 'Marie Martin', masked: 'ADVERSAIRE_DEFENDEUR_PERSONNE_PHYSIQUE_01', origin: 'manual' } },
    ]);
    const second = createEntity('Paul Durand', 'person', 'adversaire', first.graph);
    expect(second.nodeId).toBe('entity:ADVERSAIRE_DEFENDEUR_PERSONNE_PHYSIQUE_02');
  });

  it('numbers third parties and companies by kind', () => {
    expect(createEntity('Paul Durand', 'person', 'tiers', graph()).nodeId).toBe('entity:PERSONNE_PHYSIQUE_01');
    expect(createEntity('Autre SARL', 'company', 'tiers', graph()).nodeId).toBe('entity:PERSONNE_MORALE_02');
    expect(createEntity('Autre SARL', 'company', 'client', graph()).nodeId).toBe('entity:CLIENT_DEMANDEUR_PERSONNE_MORALE_01');
  });
});

describe('changeNodeSide', () => {
  it('does nothing when the side is unchanged', () => {
    const base = graph();
    expect(changeNodeSide(base.nodes[0], 'client', base).operations).toEqual([]);
  });

  it('renames and remaps a node moved to the adverse side', () => {
    const base = graph();
    const change = changeNodeSide(base.nodes[0], 'adversaire', base);
    expect(change.nodeId).toBe('entity:ADVERSAIRE_DEFENDEUR_PERSONNE_PHYSIQUE_01');
    expect(change.operations[0]).toEqual({ op: 'renameNode', rename: { fromNodeId: base.nodes[0].id, toNodeId: change.nodeId } });
    expect(change.operations).toContainEqual({ op: 'upsertMapping', mapping: { nodeId: change.nodeId, real: 'J. Dupont', masked: 'ADVERSAIRE_DEFENDEUR_PERSONNE_PHYSIQUE_01', origin: 'manual' } });
    expect(change.graph.nodes.find((entry) => entry.id === change.nodeId)?.data.partySide).toBe('adversaire');
  });

  it('un-designates a party moved to tiers and restores a neutral code', () => {
    const base = graph();
    const change = changeNodeSide(base.nodes[0], 'tiers', base);
    expect(change.nodeId).toBe('entity:PERSONNE_PHYSIQUE_01');
    expect(change.operations.at(-1)).toEqual({ op: 'removePartyDesignation', nodeId: change.nodeId });
    expect(change.graph.nodes.find((entry) => entry.id === change.nodeId)?.data.partySide).toBeUndefined();
  });

  it('designates a third party as client with a code unique among existing ones', () => {
    const base = graph();
    const change = changeNodeSide(base.nodes[1], 'client', base);
    expect(change.nodeId).toBe('entity:CLIENT_DEMANDEUR_PERSONNE_MORALE_01');
  });
});
