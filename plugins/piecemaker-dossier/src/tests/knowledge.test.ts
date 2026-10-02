import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

const previousTermsFile = process.env.PIECEMAKER_INSTITUTIONAL_TERMS;

const useInstitutionalTerms = (terms: string[]): void => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-terms-'));
  directories.push(directory);
  const file = path.join(directory, 'institutional-terms.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, terms }));
  process.env.PIECEMAKER_INSTITUTIONAL_TERMS = file;
};

beforeEach(() => {
  useInstitutionalTerms([]);
});

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  if (previousTermsFile === undefined) delete process.env.PIECEMAKER_INSTITUTIONAL_TERMS;
  else process.env.PIECEMAKER_INSTITUTIONAL_TERMS = previousTermsFile;
});

describe('knowledge graph schema', () => {
  it('creates the plugin tables and scopes them by project id', () => {
    const store = createStore();
    expect(store.tableNames()).toEqual(['piecemaker_anonymization_status', 'piecemaker_links', 'piecemaker_mappings', 'piecemaker_nodes']);
    store.update({ projectId: 'project-1', operations: [{ op: 'upsertNode', node: { id: 'person-1', kind: 'person', label: 'Alice' } }] });
    expect(store.query({ projectId: 'project-1', kind: 'person', query: 'alice' }).matches[0].projectId).toBe('project-1');
    expect(() => store.update({ projectId: 'missing-project', operations: [{ op: 'upsertNode', node: { id: 'x', kind: 'person' } }] })).toThrow();
  });

  it('persists anonymization completion independently of the mapping contents', () => {
    const store = createStore();
    expect(store.snapshot('project-1').anonymizationComplete).toBe(false);
    store.markAnonymizationComplete('project-1');
    expect(store.snapshot('project-1').anonymizationComplete).toBe(true);
    expect(store.snapshot('project-1').mappings).toEqual([]);
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
  it('removes a party designation in SQLite without deleting the profile data', () => {
    const store = createStore();
    store.update({ projectId: 'project-1', operations: [{ op: 'upsertNode', node: { id: 'client', kind: 'company', label: 'Société cliente', data: { partySide: 'client', position: 'demandeur', legalForm: 'SAS' } } }] });

    store.update({ projectId: 'project-1', operations: [{ op: 'removePartyDesignation', nodeId: 'client' }] });

    const node = store.query({ projectId: 'project-1', query: 'société cliente' }).matches[0];
    expect(node.data).toEqual({ legalForm: 'SAS' });
  });

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
  it('turns detected entities, mappings and documents into graph operations', () => {
    const operations = scanResultOperations({
      projectId: 'project-1',
      mapping: {
        mapping: {
          'Mme Dupont': 'PERSONNE_PHYSIQUE_01',
          'Madame Dupont': 'PERSONNE_PHYSIQUE_01',
          'FR76 1234': 'IBAN_01',
          'Société Alpha': 'SAS_01',
        },
        reverse_mapping: {
          PERSONNE_PHYSIQUE_01: ['Mme Dupont', 'C. Dupont'],
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
        ignored: ['Mme Reynaud', 'RCS de Paris'],
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
    expect(person.aliases.sort()).toEqual(['C. Dupont', 'Madame Dupont']);
    expect(person.mappings.map((mapping) => mapping.real).sort()).toEqual(['C. Dupont', 'Madame Dupont', 'Mme Dupont']);
    expect(person.links.some((link) => link.relation === 'mentions' && link.node?.kind === 'document')).toBe(true);
    const document = store.query({ projectId: 'project-1', kind: 'document', query: 'contrat', depth: 1 }).matches[0];
    expect(document.data.nature).toBe('Contrat');
    expect(document.links.filter((link) => link.relation === 'mentions')).toHaveLength(2);
    expect(store.snapshot('project-1').exclusions).toEqual(['Mme Reynaud', 'RCS de Paris']);
    expect(store.snapshot('project-1').nodes.some((node) => node.id.startsWith('system:'))).toBe(false);
    expect(store.query({ projectId: 'project-1', query: 'exclusions' }).matches).toHaveLength(0);
  });

  it('keeps institutional entities out of the mapping, at ingestion and at read', () => {
    useInstitutionalTerms(['Tribunal Judiciaire', 'RCS']);
    const store = createStore();
    store.replaceOrigin('project-1', 'gliner', scanResultOperations({
      projectId: 'project-1',
      mapping: {
        mapping: {
          'Tribunal Judiciaire de Nanterre': 'PERS_MORALE_01',
          'Société Alpha': 'SAS_01',
        },
        reverse_mapping: {
          PERS_MORALE_01: ['Tribunal Judiciaire de Nanterre', 'TJ Nanterre'],
          SAS_01: ['Société Alpha', 'RCS Nanterre'],
        },
      },
      documents: [],
    }));
    const snapshot = store.snapshot('project-1');
    expect(snapshot.nodes.map((node) => node.id)).toEqual(['entity:SAS_01']);
    expect(snapshot.mappings.map((mapping) => mapping.real)).toEqual(['Société Alpha']);
  });

  it('hides institutional entities already stored by an earlier scan', () => {
    const store = createStore();
    store.replaceOrigin('project-1', 'gliner', scanResultOperations({
      projectId: 'project-1',
      mapping: { mapping: { 'Tribunal Judiciaire de Nanterre': 'PERS_MORALE_01' } },
      documents: [],
    }));
    expect(store.snapshot('project-1').nodes).toHaveLength(1);
    useInstitutionalTerms(['Tribunal Judiciaire']);
    const snapshot = store.snapshot('project-1');
    expect(snapshot.nodes).toHaveLength(0);
    expect(snapshot.mappings).toHaveLength(0);
  });

  it('deletes institutional entities stored before the term was listed', () => {
    const store = createStore();
    store.replaceOrigin('project-1', 'gliner', scanResultOperations({
      projectId: 'project-1',
      mapping: { mapping: { 'Tribunal Judiciaire de Nanterre': 'PERS_MORALE_01', Alice: 'Monsieur Laurent Dumas' } },
      documents: [],
    }));
    useInstitutionalTerms(['Tribunal Judiciaire']);
    expect(store.purgeInstitutionalEntities('project-1')).toBe(1);
    useInstitutionalTerms([]);
    const snapshot = store.snapshot('project-1');
    expect(snapshot.nodes.map((node) => node.id)).toEqual(['entity:Monsieur Laurent Dumas']);
    expect(snapshot.mappings.map((mapping) => mapping.real)).toEqual(['Alice']);
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

describe('codes shared by every case', () => {
  const createTwoCaseStore = (): { store: KnowledgeStore; databasePath: string } => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-dossier-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'auth.db');
    const database = new Database(databasePath);
    database.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT NOT NULL UNIQUE)');
    database.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('project-1', '/cases/one');
    database.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('project-2', '/cases/two');
    database.close();
    const store = new KnowledgeStore(databasePath);
    stores.push(store);
    return { store, databasePath };
  };
  const person = (code: string, real: string) => [
    { op: 'upsertNode' as const, node: { id: `entity:${code}`, kind: 'person' as const, label: real, data: { code }, origin: 'gliner' as const } },
    { op: 'upsertMapping' as const, mapping: { nodeId: `entity:${code}`, real, masked: code, origin: 'gliner' as const } },
  ];

  it('refuses a code already held by another case', () => {
    const { store } = createTwoCaseStore();
    store.update({ projectId: 'project-1', operations: person('PERSONNE_PHYSIQUE_01', 'Jean Dupont') });
    expect(() => store.update({ projectId: 'project-2', operations: person('PERSONNE_PHYSIQUE_01', 'Marie Durand') })).toThrow(/already used by another case/);
    expect(store.snapshot('project-2').mappings).toHaveLength(0);
  });

  it('refuses to rename a node onto a code held by another case', () => {
    const { store } = createTwoCaseStore();
    store.update({ projectId: 'project-1', operations: person('PERSONNE_PHYSIQUE_01', 'Jean Dupont') });
    store.update({ projectId: 'project-2', operations: person('PERSONNE_PHYSIQUE_02', 'Marie Durand') });
    expect(() => store.update({ projectId: 'project-2', operations: [{ op: 'renameNode', rename: { fromNodeId: 'entity:PERSONNE_PHYSIQUE_02', toNodeId: 'entity:PERSONNE_PHYSIQUE_01' } }] })).toThrow(/already used by another case/);
  });

  it('exposes the codes of the other cases in the snapshot', () => {
    const { store } = createTwoCaseStore();
    store.update({ projectId: 'project-1', operations: person('PERSONNE_PHYSIQUE_01', 'Jean Dupont') });
    store.update({ projectId: 'project-2', operations: person('PERSONNE_PHYSIQUE_02', 'Marie Durand') });
    expect(store.snapshot('project-2').reservedCodes).toEqual(['PERSONNE_PHYSIQUE_01']);
    expect(store.reservedCodes('project-1')).toEqual(['PERSONNE_PHYSIQUE_02']);
  });

  it('renumbers an existing collision in the database, keeping the code for the oldest case', () => {
    const { store, databasePath } = createTwoCaseStore();
    store.update({ projectId: 'project-1', operations: person('PERSONNE_PHYSIQUE_01', 'Jean Dupont') });
    store.update({ projectId: 'project-1', operations: person('PERSONNE_PHYSIQUE_02', 'Paul Martin') });
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const raw = new Database(databasePath);
    const later = '2999-01-01T00:00:00.000Z';
    raw.prepare("INSERT INTO piecemaker_nodes(project_id,id,kind,label,search_text,aliases_json,data_json,origin,created_at,updated_at) VALUES('project-2','entity:PERSONNE_PHYSIQUE_01','person','Marie Durand','marie durand','[]',?, 'gliner',?,?)").run(JSON.stringify({ code: 'PERSONNE_PHYSIQUE_01' }), later, later);
    raw.prepare("INSERT INTO piecemaker_mappings(project_id,node_id,real_value,masked_value,search_text,data_json,origin,created_at,updated_at) VALUES('project-2','entity:PERSONNE_PHYSIQUE_01','Marie Durand','PERSONNE_PHYSIQUE_01',?,'{}','gliner',?,?)").run('marie durand\u0000personne_physique_01', later, later);
    raw.close();

    const reopened = new KnowledgeStore(databasePath);
    stores.push(reopened);
    const first = reopened.snapshot('project-1');
    const second = reopened.snapshot('project-2');
    expect(first.mappings.map((entry) => entry.masked).sort()).toEqual(['PERSONNE_PHYSIQUE_01', 'PERSONNE_PHYSIQUE_02']);
    expect(second.mappings).toEqual([expect.objectContaining({ real: 'Marie Durand', masked: 'PERSONNE_PHYSIQUE_03', nodeId: 'entity:PERSONNE_PHYSIQUE_03' })]);
    expect(second.nodes.find((node) => node.id === 'entity:PERSONNE_PHYSIQUE_03')?.data.code).toBe('PERSONNE_PHYSIQUE_03');
  });
});
