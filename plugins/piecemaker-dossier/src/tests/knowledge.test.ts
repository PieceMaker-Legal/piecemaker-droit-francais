import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KnowledgeStore } from '../knowledge.js';
import { scanResultOperations } from '../scan-result.js';
import { EXCLUSIONS_NODE_ID } from '../types.js';

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
    expect(store.tableNames()).toEqual(['piecemaker_anonymization_status', 'piecemaker_citations', 'piecemaker_links', 'piecemaker_mappings', 'piecemaker_nodes']);
    store.update({ projectId: 'project-1', operations: [{ op: 'upsertNode', node: { id: 'person-1', kind: 'person', label: 'Alice' } }] });
    expect(store.query({ projectId: 'project-1', kind: 'person', query: 'alice' }).matches[0].projectId).toBe('project-1');
    expect(() => store.update({ projectId: 'missing-project', operations: [{ op: 'upsertNode', node: { id: 'x', kind: 'person' } }] })).toThrow();
  });

  it('counts pseudonyms per project', () => {
    const store = createStore();
    expect(store.mappingCounts().size).toBe(0);
    store.update({ projectId: 'project-1', operations: [
      { op: 'upsertNode', node: { id: 'person-1', kind: 'person', label: 'Jean Dupont' } },
      { op: 'upsertMapping', mapping: { nodeId: 'person-1', real: 'Jean Dupont', masked: 'PERSONNE_PHYSIQUE_01' } },
      { op: 'upsertMapping', mapping: { nodeId: 'person-1', real: 'J. Dupont', masked: 'PERSONNE_PHYSIQUE_01' } },
    ] });
    expect(store.mappingCounts()).toEqual(new Map([['project-1', 2]]));
  });

  it('purges a newly excluded writing on an empty update', () => {
    const store = createStore();
    store.update({ projectId: 'project-1', operations: [
      { op: 'upsertNode', node: { id: 'person-1', kind: 'person', label: 'Jean Dupont', aliases: ['Tribunal Exemple'] } },
      { op: 'upsertMapping', mapping: { nodeId: 'person-1', real: 'Jean Dupont', masked: 'PERSONNE_PHYSIQUE_01' } },
      { op: 'upsertMapping', mapping: { nodeId: 'person-1', real: 'Tribunal Exemple', masked: 'PERSONNE_PHYSIQUE_01' } },
    ] });
    useInstitutionalTerms(['Tribunal Exemple']);
    store.update({ projectId: 'project-1', operations: [] });
    expect(store.snapshot('project-1').mappings.map((mapping) => mapping.real)).toEqual(['Jean Dupont']);
    expect(store.mappingCounts()).toEqual(new Map([['project-1', 1]]));
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
    store.mergeScan('project-1', operations);
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
    store.mergeScan('project-1', scanResultOperations({
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
    store.mergeScan('project-1', scanResultOperations({
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
    store.mergeScan('project-1', scanResultOperations({
      projectId: 'project-1',
      mapping: { mapping: { 'Tribunal Judiciaire de Nanterre': 'PERS_MORALE_01', Alice: 'Monsieur Laurent Dumas' } },
      documents: [],
    }));
    useInstitutionalTerms(['Tribunal Judiciaire']);
    store.update({ projectId: 'project-1', operations: [] });
    useInstitutionalTerms([]);
    const snapshot = store.snapshot('project-1');
    expect(snapshot.nodes.map((node) => node.id)).toEqual(['entity:Monsieur Laurent Dumas']);
    expect(snapshot.mappings.map((mapping) => mapping.real)).toEqual(['Alice']);
  });

  it('keeps a piece whose name cites an institution', () => {
    const store = createStore();
    useInstitutionalTerms(['Tribunal Judiciaire']);
    store.update({
      projectId: 'project-1',
      operations: [{ op: 'upsertNode', node: { id: 'document:1', kind: 'document', label: '2024-01-09_Jugement du Tribunal judiciaire de Paris.pdf' } }],
    });
    expect(store.snapshot('project-1').nodes.map((node) => node.id)).toEqual(['document:1']);
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
    { op: 'upsertNode' as const, node: { id: `entity:${code}`, kind: 'person' as const, label: real, data: { code } } },
    { op: 'upsertMapping' as const, mapping: { nodeId: `entity:${code}`, real, masked: code } },
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
    raw.prepare("INSERT INTO piecemaker_nodes(project_id,id,kind,label,search_text,aliases_json,data_json,created_at,updated_at) VALUES('project-2','entity:PERSONNE_PHYSIQUE_01','person','Marie Durand','marie durand','[]',?,?,?)").run(JSON.stringify({ code: 'PERSONNE_PHYSIQUE_01' }), later, later);
    raw.prepare("INSERT INTO piecemaker_mappings(project_id,node_id,real_value,masked_value,search_text,data_json,created_at,updated_at) VALUES('project-2','entity:PERSONNE_PHYSIQUE_01','Marie Durand','PERSONNE_PHYSIQUE_01',?,'{}',?,?)").run('marie durand\u0000personne_physique_01', later, later);
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

const LEGACY_SCHEMA_SQL = `
CREATE TABLE piecemaker_nodes (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('person','company','document','iban','address','phone','email','url','siren','other')),
  label TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json)),
  data_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),
  origin TEXT NOT NULL CHECK (origin IN ('gliner','manual','llm')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
CREATE TABLE piecemaker_links (
  project_id TEXT NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),
  origin TEXT NOT NULL CHECK (origin IN ('gliner','manual','llm')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, from_node_id, to_node_id, relation),
  FOREIGN KEY (project_id, from_node_id) REFERENCES piecemaker_nodes(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, to_node_id) REFERENCES piecemaker_nodes(project_id, id) ON DELETE CASCADE
);
CREATE TABLE piecemaker_mappings (
  project_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  real_value TEXT NOT NULL,
  masked_value TEXT NOT NULL,
  search_text TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),
  origin TEXT NOT NULL CHECK (origin IN ('gliner','manual','llm')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, node_id, real_value),
  FOREIGN KEY (project_id, node_id) REFERENCES piecemaker_nodes(project_id, id) ON DELETE CASCADE
);
CREATE TABLE piecemaker_anonymization_status (
  project_id TEXT PRIMARY KEY NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);
CREATE INDEX piecemaker_nodes_lookup ON piecemaker_nodes(project_id, kind, search_text);
CREATE INDEX piecemaker_links_from ON piecemaker_links(project_id, from_node_id);
CREATE INDEX piecemaker_links_to ON piecemaker_links(project_id, to_node_id);
CREATE INDEX piecemaker_mappings_lookup ON piecemaker_mappings(project_id, search_text);
CREATE INDEX piecemaker_mappings_masked ON piecemaker_mappings(project_id, masked_value);
`;

const createLegacyDatabase = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-dossier-'));
  directories.push(directory);
  const databasePath = path.join(directory, 'auth.db');
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  database.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT NOT NULL UNIQUE)');
  database.exec(LEGACY_SCHEMA_SQL);
  database.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('project-1', '/cases/one');
  const insertNode = database.prepare("INSERT INTO piecemaker_nodes(project_id,id,kind,label,search_text,aliases_json,data_json,origin,created_at,updated_at) VALUES('project-1',?,?,?,?,'[]',?,?,'2024-05-01T10:00:00.000Z','2024-05-02T10:00:00.000Z')");
  insertNode.run('document:iso', 'document', 'Contrat.pdf', 'contrat.pdf', JSON.stringify({ nature: 'Contrat', doc_date_iso: '2024-03-05' }), 'gliner');
  insertNode.run('document:legacy', 'document', 'Facture.pdf', 'facture.pdf', JSON.stringify({ dateIso: '2024-04-06' }), 'manual');
  insertNode.run('document:free', 'document', 'Courrier.pdf', 'courrier.pdf', JSON.stringify({ doc_date_iso: '5 mars 2024', localisation: 'Paris' }), 'manual');
  insertNode.run('document:none', 'document', 'Note.pdf', 'note.pdf', JSON.stringify({ nature: 'Note' }), 'llm');
  insertNode.run('entity:PERSONNE_PHYSIQUE_01', 'person', 'Jean Dupont', 'jean dupont', JSON.stringify({ code: 'PERSONNE_PHYSIQUE_01' }), 'gliner');
  insertNode.run('entity:SOCIETE_SAS_01', 'company', 'Société Exemple SAS', 'societe exemple sas', JSON.stringify({ code: 'SOCIETE_SAS_01' }), 'gliner');
  const insertLink = database.prepare("INSERT INTO piecemaker_links(project_id,from_node_id,to_node_id,relation,data_json,origin,created_at,updated_at) VALUES('project-1',?,?,'mentions','{}',?,'2024-05-01T10:00:00.000Z','2024-05-02T10:00:00.000Z')");
  insertLink.run('document:iso', 'entity:PERSONNE_PHYSIQUE_01', 'gliner');
  insertLink.run('document:iso', 'entity:SOCIETE_SAS_01', 'manual');
  insertLink.run('document:legacy', 'entity:SOCIETE_SAS_01', 'gliner');
  const insertMapping = database.prepare("INSERT INTO piecemaker_mappings(project_id,node_id,real_value,masked_value,search_text,data_json,origin,created_at,updated_at) VALUES('project-1',?,?,?,?,'{}',?,'2024-05-01T10:00:00.000Z','2024-05-02T10:00:00.000Z')");
  insertMapping.run('entity:PERSONNE_PHYSIQUE_01', 'Jean Dupont', 'PERSONNE_PHYSIQUE_01', 'jean dupont', 'gliner');
  insertMapping.run('entity:SOCIETE_SAS_01', 'Société Exemple SAS', 'SOCIETE_SAS_01', 'societe exemple sas', 'manual');
  database.close();
  return databasePath;
};

const dumpTables = (databasePath: string): Record<string, unknown[]> => {
  const database = new Database(databasePath);
  const dump = Object.fromEntries(['piecemaker_nodes', 'piecemaker_links', 'piecemaker_mappings', 'piecemaker_citations'].map((table) => [table, database.prepare(`SELECT * FROM ${table} ORDER BY 1,2,3,4`).all()]));
  database.close();
  return dump;
};

const columnsOf = (database: InstanceType<typeof Database>, table: string): string[] => (database.pragma(`table_info(${table})`) as Array<{ name: string }>).map(({ name }) => name);

describe('migration away from the origin column', () => {
  it('rebuilds the tables without losing a row and moves dates into doc_date', () => {
    const databasePath = createLegacyDatabase();
    const store = new KnowledgeStore(databasePath);
    stores.push(store);
    const raw = new Database(databasePath);
    expect(raw.prepare('SELECT count(*) AS n FROM piecemaker_nodes').get()).toEqual({ n: 6 });
    expect(raw.prepare('SELECT count(*) AS n FROM piecemaker_links').get()).toEqual({ n: 3 });
    expect(raw.prepare('SELECT count(*) AS n FROM piecemaker_mappings').get()).toEqual({ n: 2 });
    for (const table of ['piecemaker_nodes', 'piecemaker_links', 'piecemaker_mappings']) expect(columnsOf(raw, table)).not.toContain('origin');
    const node = (id: string) => raw.prepare('SELECT doc_date, data_json, created_at, updated_at FROM piecemaker_nodes WHERE id=?').get(id) as { doc_date: string | null; data_json: string; created_at: string; updated_at: string };
    expect(node('document:iso')).toMatchObject({ doc_date: '2024-03-05', created_at: '2024-05-01T10:00:00.000Z', updated_at: '2024-05-02T10:00:00.000Z' });
    expect(JSON.parse(node('document:iso').data_json)).toEqual({ nature: 'Contrat' });
    expect(node('document:legacy').doc_date).toBe('2024-04-06');
    expect(JSON.parse(node('document:legacy').data_json)).toEqual({});
    expect(node('document:free').doc_date).toBeNull();
    expect(JSON.parse(node('document:free').data_json)).toEqual({ localisation: 'Paris', date_non_reconnue: '5 mars 2024' });
    expect(node('document:none').doc_date).toBeNull();
    expect(JSON.parse(node('document:none').data_json)).toEqual({ nature: 'Note' });
    expect(raw.pragma('foreign_key_check')).toEqual([]);
    expect(raw.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(store.snapshot('project-1').nodes.find((entry) => entry.id === 'document:iso')?.date).toBe('2024-03-05');
    raw.close();
  });

  it('fills created_at and updated_at by default on every table', () => {
    const databasePath = createLegacyDatabase();
    stores.push(new KnowledgeStore(databasePath));
    const raw = new Database(databasePath);
    raw.prepare("INSERT INTO piecemaker_nodes(project_id,id,kind,label) VALUES('project-1','entity:ADRESSE_01','address','12 rue des Lilas, Paris')").run();
    raw.prepare("INSERT INTO piecemaker_links(project_id,from_node_id,to_node_id,relation) VALUES('project-1','entity:SOCIETE_SAS_01','entity:ADRESSE_01','adresse')").run();
    raw.prepare("INSERT INTO piecemaker_mappings(project_id,node_id,real_value,masked_value,search_text) VALUES('project-1','entity:ADRESSE_01','12 rue des Lilas, Paris','ADRESSE_01','x')").run();
    for (const table of ['piecemaker_nodes', 'piecemaker_links', 'piecemaker_mappings']) {
      const row = raw.prepare(`SELECT created_at, updated_at FROM ${table} ORDER BY created_at DESC LIMIT 1`).get() as { created_at: string; updated_at: string };
      expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(row.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    expect(() => raw.prepare("UPDATE piecemaker_nodes SET doc_date='5 mars 2024' WHERE id='document:iso'").run()).toThrow(/CHECK/);
    raw.close();
  });

  it('removes the citations of a link when the link is deleted', () => {
    const databasePath = createLegacyDatabase();
    const store = new KnowledgeStore(databasePath);
    stores.push(store);
    store.update({ projectId: 'project-1', operations: [
      { op: 'cite', citation: { fromNodeId: 'document:iso', toNodeId: 'entity:PERSONNE_PHYSIQUE_01', relation: 'mentions', texte: 'Jean Dupont signe le contrat.', pieceId: 'document:iso' } },
      { op: 'cite', citation: { fromNodeId: 'document:iso', toNodeId: 'entity:PERSONNE_PHYSIQUE_01', relation: 'mentions', texte: 'Jean Dupont', source: 'Déclaration du client' } },
    ] });
    expect(store.snapshot('project-1').citations).toHaveLength(2);
    store.update({ projectId: 'project-1', operations: [{ op: 'unlink', link: { fromNodeId: 'document:iso', toNodeId: 'entity:PERSONNE_PHYSIQUE_01', relation: 'mentions' } }] });
    expect(store.snapshot('project-1').citations).toEqual([]);
    const raw = new Database(databasePath);
    expect(raw.prepare('SELECT count(*) AS n FROM piecemaker_citations').get()).toEqual({ n: 0 });
    raw.close();
  });

  it('changes nothing when the database is opened a second time', () => {
    const databasePath = createLegacyDatabase();
    const first = new KnowledgeStore(databasePath);
    first.close();
    const afterFirst = dumpTables(databasePath);
    const raw = new Database(databasePath);
    const before = raw.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'piecemaker_%' ORDER BY name").all();
    raw.close();
    const second = new KnowledgeStore(databasePath);
    stores.push(second);
    expect(dumpTables(databasePath)).toEqual(afterFirst);
    const reopened = new Database(databasePath);
    expect(reopened.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'piecemaker_%' ORDER BY name").all()).toEqual(before);
    reopened.close();
  });

  it('leaves a fresh database on the new schema with no migration', () => {
    const store = createStore();
    expect(store.tableNames()).toContain('piecemaker_citations');
    expect(store.snapshot('project-1').citations).toEqual([]);
  });
});

describe('merged scans', () => {
  const scanOf = (codes: Record<string, string>, documents: Array<{ id: string; name: string; metadata?: Record<string, unknown>; entityCodes: string[] }>, ignored: string[] = []) => scanResultOperations({
    projectId: 'project-1',
    mapping: { mapping: Object.fromEntries(Object.entries(codes).map(([code, real]) => [real, code])), ignored },
    documents,
  });
  const contract = { id: 'hash-1', name: 'Contrat.pdf', metadata: { doc_date_iso: '2024-01-09', nature: 'Contrat' }, entityCodes: ['PERSONNE_PHYSIQUE_01', 'SOCIETE_SAS_01'] };
  const codes = { PERSONNE_PHYSIQUE_01: 'Jean Dupont', SOCIETE_SAS_01: 'Société Exemple SAS' };

  it('stores the scanned date in doc_date and not in the data', () => {
    const store = createStore();
    store.mergeScan('project-1', scanOf(codes, [contract]));
    const document = store.snapshot('project-1').nodes.find((node) => node.id === 'document:hash-1');
    expect(document?.date).toBe('2024-01-09');
    expect(document?.data).toEqual({ path: '', nature: 'Contrat' });
  });

  it('keeps an unrecognised scanned date aside without filling doc_date', () => {
    const store = createStore();
    store.mergeScan('project-1', scanOf(codes, [{ ...contract, metadata: { dateIso: '9 janvier 2024' } }]));
    const document = store.snapshot('project-1').nodes.find((node) => node.id === 'document:hash-1');
    expect(document?.date).toBeNull();
    expect(document?.data.date_non_reconnue).toBe('9 janvier 2024');
  });

  it('keeps a corrected date, a corrected label and extra data through a second scan', () => {
    const store = createStore();
    store.mergeScan('project-1', scanOf(codes, [contract]));
    store.update({ projectId: 'project-1', operations: [{ op: 'upsertNode', node: { id: 'document:hash-1', kind: 'document', label: 'Contrat de bail.pdf', data: { path: '', nature: 'Bail', localisation: 'Paris' }, date: '2024-02-02' } }] });
    store.mergeScan('project-1', scanOf(codes, [{ ...contract, metadata: { doc_date_iso: '2024-01-09', nature: 'Contrat', localisation: 'Lyon' } }]));
    const document = store.snapshot('project-1').nodes.find((node) => node.id === 'document:hash-1');
    expect(document).toMatchObject({ label: 'Contrat de bail.pdf', date: '2024-02-02', data: { nature: 'Bail', localisation: 'Paris' } });
  });

  it('fills only the empty parts of an existing node and unions its aliases', () => {
    const store = createStore();
    store.mergeScan('project-1', scanOf(codes, [{ ...contract, metadata: {} }]));
    store.update({ projectId: 'project-1', operations: [{ op: 'upsertNode', node: { id: 'entity:PERSONNE_PHYSIQUE_01', kind: 'person', label: 'Jean-Pierre Dupont', aliases: ['J.-P. Dupont'], data: { code: 'PERSONNE_PHYSIQUE_01' } } }] });
    store.mergeScan('project-1', scanResultOperations({
      projectId: 'project-1',
      mapping: { mapping: { 'Jean Dupont': 'PERSONNE_PHYSIQUE_01', 'M. Dupont': 'PERSONNE_PHYSIQUE_01', 'Société Exemple SAS': 'SOCIETE_SAS_01' } },
      documents: [contract],
    }));
    const snapshot = store.snapshot('project-1');
    expect(snapshot.nodes.find((node) => node.id === 'document:hash-1')?.date).toBe('2024-01-09');
    const person = snapshot.nodes.find((node) => node.id === 'entity:PERSONNE_PHYSIQUE_01');
    expect(person?.label).toBe('Jean-Pierre Dupont');
    expect([...(person?.aliases || [])].sort()).toEqual(['J.-P. Dupont', 'M. Dupont']);
  });

  it('never rewrites an existing mapping', () => {
    const store = createStore();
    store.mergeScan('project-1', scanOf(codes, []));
    store.update({ projectId: 'project-1', operations: [{ op: 'upsertMapping', mapping: { nodeId: 'entity:PERSONNE_PHYSIQUE_01', real: 'Jean Dupont', masked: 'PERSONNE_PHYSIQUE_01', data: { corrected: true } } }] });
    store.mergeScan('project-1', scanOf(codes, []));
    expect(store.snapshot('project-1').mappings.find((mapping) => mapping.real === 'Jean Dupont')?.data).toEqual({ corrected: true });
  });

  it('recreates a removed link and adds a new entity', () => {
    const store = createStore();
    store.mergeScan('project-1', scanOf(codes, [contract]));
    store.update({ projectId: 'project-1', operations: [{ op: 'unlink', link: { fromNodeId: 'document:hash-1', toNodeId: 'entity:SOCIETE_SAS_01', relation: 'mentions' } }] });
    expect(store.snapshot('project-1').links).toHaveLength(1);
    store.mergeScan('project-1', scanOf({ ...codes, ADRESSE_01: '12 rue des Lilas, Paris' }, [{ ...contract, entityCodes: [...contract.entityCodes, 'ADRESSE_01'] }]));
    const snapshot = store.snapshot('project-1');
    expect(snapshot.links).toHaveLength(3);
    expect(snapshot.nodes.map((node) => node.id)).toContain('entity:ADRESSE_01');
  });

  it('deletes nothing when a scan covers only part of the case', () => {
    const store = createStore();
    store.mergeScan('project-1', scanOf(codes, [contract, { id: 'hash-2', name: 'Facture.pdf', entityCodes: ['SOCIETE_SAS_01'] }]));
    const before = store.snapshot('project-1');
    store.mergeScan('project-1', scanOf({ SOCIETE_SAS_01: 'Société Exemple SAS' }, [{ id: 'hash-2', name: 'Facture.pdf', entityCodes: ['SOCIETE_SAS_01'] }]));
    const after = store.snapshot('project-1');
    expect(after.nodes.map((node) => node.id)).toEqual(before.nodes.map((node) => node.id));
    expect(after.links).toEqual(before.links);
    expect(after.mappings).toEqual(before.mappings);
    store.mergeScan('project-1', []);
    expect(store.snapshot('project-1').nodes).toHaveLength(before.nodes.length);
  });

  it('adds the exclusions of each scan to the stored ones and keeps the other data', () => {
    const store = createStore();
    store.mergeScan('project-1', scanOf(codes, [], ['RCS de Paris']));
    store.update({ projectId: 'project-1', operations: [{ op: 'upsertNode', node: { id: EXCLUSIONS_NODE_ID, kind: 'other', label: 'Exclusions GLiNER', data: { systemRole: 'gliner-exclusions', values: ['RCS de Paris', 'Mme Reynaud'], liens: [{ piece: 'document:hash-1', entite: 'entity:SOCIETE_SAS_01', relation: 'mentions' }] } } }] });
    store.mergeScan('project-1', scanOf(codes, [], ['Greffe Exemple', 'RCS de Paris']));
    expect(store.snapshot('project-1').exclusions).toEqual(['RCS de Paris', 'Mme Reynaud', 'Greffe Exemple']);
    const raw = new Database((store as unknown as { database: InstanceType<typeof Database> }).database.name);
    const stored = JSON.parse((raw.prepare('SELECT data_json FROM piecemaker_nodes WHERE id=?').get(EXCLUSIONS_NODE_ID) as { data_json: string }).data_json);
    raw.close();
    expect(stored.liens).toEqual([{ piece: 'document:hash-1', entite: 'entity:SOCIETE_SAS_01', relation: 'mentions' }]);
    expect(stored.systemRole).toBe('gliner-exclusions');
  });

  it('refuses operations that could delete data', () => {
    const store = createStore();
    expect(() => store.mergeScan('project-1', [{ op: 'deleteNode', nodeId: 'x' }])).toThrow(/mergeScan only accepts/);
  });
});

describe('citations', () => {
  const seed = (store: KnowledgeStore): void => {
    store.update({ projectId: 'project-1', operations: [
      { op: 'upsertNode', node: { id: 'document:old', kind: 'document', label: 'Contrat.pdf', date: '2024-01-09' } },
      { op: 'upsertNode', node: { id: 'document:other', kind: 'document', label: 'Facture.pdf' } },
      { op: 'upsertNode', node: { id: 'entity:PERSONNE_PHYSIQUE_01', kind: 'person', label: 'Jean Dupont' } },
      { op: 'upsertMapping', mapping: { nodeId: 'entity:PERSONNE_PHYSIQUE_01', real: 'Jean Dupont', masked: 'PERSONNE_PHYSIQUE_01' } },
      { op: 'link', link: { fromNodeId: 'document:old', toNodeId: 'entity:PERSONNE_PHYSIQUE_01', relation: 'mentions' } },
      { op: 'link', link: { fromNodeId: 'document:other', toNodeId: 'entity:PERSONNE_PHYSIQUE_01', relation: 'mentions' } },
      { op: 'cite', citation: { fromNodeId: 'document:old', toNodeId: 'entity:PERSONNE_PHYSIQUE_01', relation: 'mentions', texte: 'Jean Dupont signe.', pieceId: 'document:old' } },
      { op: 'cite', citation: { fromNodeId: 'document:other', toNodeId: 'entity:PERSONNE_PHYSIQUE_01', relation: 'mentions', texte: 'Jean Dupont paie.', pieceId: 'document:old' } },
    ] });
  };

  it('validates the text and the origin of a citation', () => {
    const store = createStore();
    seed(store);
    const cite = (citation: Record<string, unknown>) => store.update({ projectId: 'project-1', operations: [{ op: 'cite', citation: { fromNodeId: 'document:old', toNodeId: 'entity:PERSONNE_PHYSIQUE_01', relation: 'mentions', texte: 'x', ...citation } as never }] });
    expect(() => cite({ texte: '  ', source: 'Registre' })).toThrow(/texte/);
    expect(() => cite({})).toThrow(/pieceId or source/);
    expect(() => cite({ source: 'Registre', relation: 'inconnue' })).toThrow();
    expect(() => cite({ pieceId: 'document:absent' })).toThrow();
  });

  it('does not duplicate an identical citation', () => {
    const store = createStore();
    seed(store);
    const again = { op: 'cite' as const, citation: { fromNodeId: 'document:old', toNodeId: 'entity:PERSONNE_PHYSIQUE_01', relation: 'mentions', texte: 'Jean Dupont signe.', pieceId: 'document:old' } };
    store.update({ projectId: 'project-1', operations: [again, again] });
    expect(store.snapshot('project-1').citations).toHaveLength(2);
  });

  it('follows a renamed piece through its links and its piece_id', () => {
    const store = createStore();
    seed(store);
    store.update({ projectId: 'project-1', operations: [{ op: 'renameNode', rename: { fromNodeId: 'document:old', toNodeId: 'document:new' } }] });
    const snapshot = store.snapshot('project-1');
    const sorted = [...snapshot.citations].sort((left, right) => left.texte.localeCompare(right.texte));
    expect(sorted.map((citation) => [citation.texte, citation.fromNodeId, citation.pieceId])).toEqual([
      ['Jean Dupont paie.', 'document:other', 'document:new'],
      ['Jean Dupont signe.', 'document:new', 'document:new'],
    ]);
    expect(snapshot.nodes.find((node) => node.id === 'document:new')?.date).toBe('2024-01-09');
    expect(snapshot.nodes.some((node) => node.id === 'document:old')).toBe(false);
  });

  it('follows a renamed entity through the target of its links', () => {
    const store = createStore();
    seed(store);
    store.update({ projectId: 'project-1', operations: [{ op: 'renameNode', rename: { fromNodeId: 'entity:PERSONNE_PHYSIQUE_01', toNodeId: 'entity:ADVERSAIRE_01' } }] });
    const citations = store.snapshot('project-1').citations;
    expect(citations).toHaveLength(2);
    expect(citations.every((citation) => citation.toNodeId === 'entity:ADVERSAIRE_01')).toBe(true);
  });
});
