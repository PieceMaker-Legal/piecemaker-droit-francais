import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { KnowledgeStore } from '../knowledge.js';
import { scanResultOperations } from '../scan-result.js';

const stores: KnowledgeStore[] = [];
const directories: string[] = [];

const createStore = (): KnowledgeStore => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-dossier-'));
  directories.push(directory);
  const databasePath = path.join(directory, 'auth.db');
  const database = new Database(databasePath);
  database.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT NOT NULL UNIQUE)');
  database.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('project-1', '/cases/one');
  database.close();
  const store = new KnowledgeStore(databasePath);
  stores.push(store);
  return store;
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('knowledge graph schema', () => {
  it('creates exactly the three plugin tables and scopes them by project id', () => {
    const store = createStore();
    expect(store.tableNames()).toEqual(['piecemaker_links', 'piecemaker_mappings', 'piecemaker_nodes']);
    store.update({ projectId: 'project-1', operations: [{ op: 'upsertNode', node: { id: 'person-1', kind: 'person', label: 'Alice' } }] });
    expect(store.query({ projectId: 'project-1', kind: 'person', query: 'alice' }).matches[0].projectId).toBe('project-1');
    expect(() => store.update({ projectId: 'missing-project', operations: [{ op: 'upsertNode', node: { id: 'x', kind: 'person' } }] })).toThrow();
  });

  it('resolves a project path once for a query', () => {
    const store = createStore();
    store.update({ projectId: 'project-1', operations: [{ op: 'upsertNode', node: { id: 'document-1', kind: 'document', label: 'Convention' } }] });
    expect(store.query({ projectPath: '/cases/one', kind: 'document', query: 'convention' }).matches).toHaveLength(1);
  });
});

describe('knowledge graph queries', () => {
  it('finds a person and recursively resolves linked documents and mappings', () => {
    const store = createStore();
    store.update({
      projectId: 'project-1',
      operations: [
        { op: 'upsertNode', node: { id: 'person-1', kind: 'person', label: 'Jean Dupont', aliases: ['J. Dupont'] } },
        { op: 'upsertNode', node: { id: 'document-1', kind: 'document', label: 'Contrat de travail', data: { source: 'piece.md' } } },
        { op: 'link', link: { fromNodeId: 'person-1', toNodeId: 'document-1', relation: 'mentioned_in', data: { page: 4 } } },
        { op: 'upsertMapping', mapping: { nodeId: 'person-1', real: 'Jean Dupont', masked: 'PERSON_1' } },
      ],
    });
    const result = store.query({ projectId: 'project-1', kind: 'person', query: 'dupont', depth: 1 });
    expect(result.ambiguous).toBe(false);
    expect(result.matches[0].mappings[0].masked).toBe('PERSON_1');
    expect(result.matches[0].links[0].node?.kind).toBe('document');
    expect(result.matches[0].links[0].data).toEqual({ page: 4 });
  });

  it('reports ambiguity for multiple matching nodes', () => {
    const store = createStore();
    store.update({ projectId: 'project-1', operations: [
      { op: 'upsertNode', node: { id: 'p1', kind: 'person', label: 'Alex Martin' } },
      { op: 'upsertNode', node: { id: 'p2', kind: 'person', label: 'Alexandre Martin' } },
    ] });
    expect(store.query({ projectId: 'project-1', kind: 'person', query: 'martin' }).ambiguous).toBe(true);
  });

  it('bounds recursive resolution and marks cycles', () => {
    const store = createStore();
    store.update({ projectId: 'project-1', operations: [
      { op: 'upsertNode', node: { id: 'a', kind: 'person', label: 'A' } },
      { op: 'upsertNode', node: { id: 'b', kind: 'company', label: 'B' } },
      { op: 'upsertNode', node: { id: 'c', kind: 'document', label: 'C' } },
      { op: 'link', link: { fromNodeId: 'a', toNodeId: 'b', relation: 'works_for' } },
      { op: 'link', link: { fromNodeId: 'b', toNodeId: 'c', relation: 'mentioned_in' } },
      { op: 'link', link: { fromNodeId: 'c', toNodeId: 'a', relation: 'mentions' } },
    ] });
    const result = store.query({ projectId: 'project-1', query: 'A', depth: 8 });
    const cycleLink = result.matches[0].links[0].node?.links[0].node?.links[0];
    expect(cycleLink?.cycle).toBe(true);
    expect(cycleLink?.node).toBeNull();
  });
});

describe('knowledge graph updates', () => {
  it('is atomic on failure and idempotent on repeated upserts', () => {
    const store = createStore();
    expect(() => store.update({ projectId: 'project-1', operations: [
      { op: 'upsertNode', node: { id: 'kept', kind: 'person', label: 'Kept' } },
      { op: 'upsertNode', node: { id: 'broken', kind: 'unknown' as never, label: 'Broken' } },
    ] })).toThrow();
    expect(store.query({ projectId: 'project-1', query: 'kept' }).matches).toHaveLength(0);

    const operation = { op: 'upsertNode' as const, node: { id: 'same', kind: 'person' as const, label: 'First' } };
    store.update({ projectId: 'project-1', operations: [operation, operation] });
    store.update({ projectId: 'project-1', operations: [{ op: 'upsertNode', node: { id: 'same', kind: 'person', label: 'Second' } }] });
    expect(store.query({ projectId: 'project-1', query: 'second' }).matches).toHaveLength(1);
    expect(store.query({ projectId: 'project-1', query: 'first' }).matches).toHaveLength(0);
  });

  it('rolls back links that reference another project or missing nodes', () => {
    const store = createStore();
    store.update({ projectId: 'project-1', operations: [{ op: 'upsertNode', node: { id: 'one', kind: 'person', label: 'One' } }] });
    expect(() => store.update({ projectId: 'project-1', operations: [
      { op: 'upsertNode', node: { id: 'two', kind: 'company', label: 'Two' } },
      { op: 'link', link: { fromNodeId: 'one', toNodeId: 'absent', relation: 'knows' } },
    ] })).toThrow();
    expect(store.query({ projectId: 'project-1', query: 'two' }).matches).toHaveLength(0);
  });
});

describe('GLiNER result persistence', () => {
  it('turns detected entities, mappings, documents and known relations into graph operations', () => {
    const operations = scanResultOperations({
      projectId: 'project-1',
      mapping: {
        mapping: {
          'Mme Dupont': 'PERSONNE_PHYSIQUE_01',
          'FR76 1234': 'IBAN_01',
          'Société Alpha': 'SAS_01',
        },
        reverse_mapping: {
          PERSONNE_PHYSIQUE_01: ['Mme Dupont'],
          IBAN_01: ['FR76 1234'],
          SAS_01: ['Société Alpha'],
        },
        extracted_data: {
          personnes_physiques: {
            PERSONNE_PHYSIQUE_01: { original: 'Mme Dupont', score: 0.98 },
          },
          societes: {
            SAS_01: { original: 'Société Alpha', score: 0.97 },
          },
          autres: {
            IBAN_01: { original: 'FR76 1234', score: 0.99 },
          },
        },
        informations_dossier: {
          parties_clientes: [{
            type: 'societe',
            societe_nom: 'Société Alpha',
            forme_sociale: 'SAS',
            mapping_assignments: [
              { field: 'identite', code: 'SAS_01' },
              { field: 'iban', code: 'IBAN_01' },
            ],
          }],
          relations: [{ source: 'PERSONNE_PHYSIQUE_01', target: 'SAS_01', role: 'dirige' }],
        },
      },
      documents: [{
        id: 'hash-1',
        name: 'Contrat.pdf',
        path: '/cases/one/Contrat.pdf',
        metadata: { nature: 'Contrat' },
        entityCodes: ['PERSONNE_PHYSIQUE_01', 'SAS_01'],
      }],
    });
    const store = createStore();
    store.replaceOrigin('project-1', 'gliner', operations);
    const person = store.query({ projectId: 'project-1', kind: 'person', query: 'dupont', depth: 2 }).matches[0];
    expect(person.mappings[0].masked).toBe('PERSONNE_PHYSIQUE_01');
    expect(person.links.some((link) => link.relation === 'dirige' && link.node?.kind === 'company')).toBe(true);
    expect(person.links.some((link) => link.relation === 'mentions' && link.node?.kind === 'document')).toBe(true);
    const company = store.query({ projectId: 'project-1', kind: 'company', query: 'alpha', depth: 1 }).matches[0];
    expect(company.data.legalForm).toBe('SAS');
    expect(company.links.some((link) => link.relation === 'iban' && link.node?.kind === 'iban')).toBe(true);
    const document = store.query({ projectId: 'project-1', kind: 'document', query: 'contrat', depth: 1 }).matches[0];
    expect(document.data.nature).toBe('Contrat');
    expect(document.links.filter((link) => link.relation === 'mentions')).toHaveLength(2);
  });

  it('replaces stale GLiNER rows while retaining manual additions', () => {
    const store = createStore();
    store.replaceOrigin('project-1', 'gliner', scanResultOperations({
      projectId: 'project-1',
      mapping: { mapping: { Alice: 'PERSONNE_PHYSIQUE_01' } },
      documents: [],
    }));
    store.update({
      projectId: 'project-1',
      operations: [{ op: 'upsertNode', node: { id: 'manual-note', kind: 'other', label: 'Note', origin: 'manual' } }],
    });
    store.replaceOrigin('project-1', 'gliner', []);
    expect(store.query({ projectId: 'project-1', query: 'alice' }).matches).toHaveLength(0);
    expect(store.query({ projectId: 'project-1', query: 'note' }).matches).toHaveLength(1);
  });
});
