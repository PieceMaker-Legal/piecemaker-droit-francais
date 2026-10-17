import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { KnowledgeStore } from '../knowledge.js';
import { codeRegistry, partyCodeChange } from '../party-codes.js';
import { createEntity } from '../selection-categories.js';

const stores: KnowledgeStore[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const createTwoCaseDatabase = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-global-codes-'));
  directories.push(directory);
  const databasePath = path.join(directory, 'auth.db');
  const database = new Database(databasePath);
  database.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT NOT NULL UNIQUE)');
  database.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('dossier-ancien', '/cases/ancien');
  database.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('dossier-recent', '/cases/recent');
  database.close();
  return databasePath;
};

const open = (databasePath: string): KnowledgeStore => {
  const store = new KnowledgeStore(databasePath);
  stores.push(store);
  return store;
};

const closeAll = (): void => {
  for (const store of stores.splice(0)) store.close();
};

const person = (code: string, real: string, data: Record<string, unknown> = {}) => [
  { op: 'upsertNode' as const, node: { id: `entity:${code}`, kind: 'person' as const, label: real, data: { code, ...data } } },
  { op: 'upsertMapping' as const, mapping: { nodeId: `entity:${code}`, real, masked: code } },
];

const insertRaw = (databasePath: string, projectId: string, code: string, real: string, createdAt: string, data: Record<string, unknown> = {}): void => {
  const raw = new Database(databasePath);
  raw.prepare('INSERT INTO piecemaker_nodes(project_id,id,kind,label,search_text,aliases_json,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(projectId, `entity:${code}`, 'person', real, real.toLowerCase(), '[]', JSON.stringify({ code, ...data }), createdAt, createdAt);
  raw.prepare('INSERT INTO piecemaker_mappings(project_id,node_id,real_value,masked_value,search_text,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(projectId, `entity:${code}`, real, code, `${real.toLowerCase()}\u0000${code.toLowerCase()}`, '{}', createdAt, createdAt);
  raw.close();
};

const backups = (databasePath: string): string[] => {
  const directory = path.join(path.dirname(databasePath), 'backups');
  return fs.existsSync(directory) ? fs.readdirSync(directory) : [];
};

describe('un code ne désigne qu’une personne dans toute la base', () => {
  it('renumérote le PERSONNE_PHYSIQUE_01 du dossier le plus récent, retire l’ancien code et sauvegarde avant', () => {
    const databasePath = createTwoCaseDatabase();
    open(databasePath);
    closeAll();
    insertRaw(databasePath, 'dossier-ancien', 'PERSONNE_PHYSIQUE_01', 'Jean Dupont', '2026-01-01T00:00:00.000Z');
    insertRaw(databasePath, 'dossier-recent', 'PERSONNE_PHYSIQUE_01', 'Marie Durand', '2026-06-01T00:00:00.000Z');

    const raw = new Database(databasePath);
    const holders = raw.prepare("SELECT COUNT(DISTINCT project_id) AS count FROM piecemaker_mappings WHERE masked_value='PERSONNE_PHYSIQUE_01'").get() as { count: number };
    raw.close();
    expect(holders.count).toBe(2);

    const store = open(databasePath);
    const ancien = store.snapshot('dossier-ancien');
    const recent = store.snapshot('dossier-recent');
    expect(ancien.mappings).toEqual([expect.objectContaining({ real: 'Jean Dupont', masked: 'PERSONNE_PHYSIQUE_01' })]);
    expect(recent.mappings).toEqual([expect.objectContaining({ real: 'Marie Durand', masked: 'PERSONNE_PHYSIQUE_02', nodeId: 'entity:PERSONNE_PHYSIQUE_02' })]);
    expect(recent.nodes[0].data).toEqual(expect.objectContaining({ code: 'PERSONNE_PHYSIQUE_02', codes_retires: ['PERSONNE_PHYSIQUE_01'] }));
    expect(backups(databasePath)).toHaveLength(1);

    closeAll();
    const again = open(databasePath);
    expect(again.snapshot('dossier-recent').mappings[0].masked).toBe('PERSONNE_PHYSIQUE_02');
    expect(backups(databasePath)).toHaveLength(1);
  });

  it('suit les références de code dans les données du dossier renuméroté', () => {
    const databasePath = createTwoCaseDatabase();
    open(databasePath);
    closeAll();
    insertRaw(databasePath, 'dossier-ancien', 'PERSONNE_PHYSIQUE_01', 'Jean Dupont', '2026-01-01T00:00:00.000Z');
    insertRaw(databasePath, 'dossier-recent', 'PERSONNE_PHYSIQUE_01', 'Marie Durand', '2026-06-01T00:00:00.000Z');
    const raw = new Database(databasePath);
    raw.prepare("INSERT INTO piecemaker_nodes(project_id,id,kind,label,search_text,aliases_json,data_json,created_at,updated_at) VALUES('dossier-recent','entity:SAS_01','company','Société Exemple SAS','societe exemple sas','[]',?,'2026-06-01T00:00:00.000Z','2026-06-01T00:00:00.000Z')")
      .run(JSON.stringify({ code: 'SAS_01', registrePublic: { directors: [{ code: 'PERSONNE_PHYSIQUE_01', role: 'Président' }] } }));
    raw.close();

    const store = open(databasePath);
    const company = store.snapshot('dossier-recent').nodes.find((node) => node.id === 'entity:SAS_01');
    expect(company?.data.registrePublic).toEqual({ directors: [{ code: 'PERSONNE_PHYSIQUE_02', role: 'Président' }] });
  });

  it('réserve dans tous les dossiers les codes portés seulement par data.code ou retirés par une fusion', () => {
    const databasePath = createTwoCaseDatabase();
    const store = open(databasePath);
    store.update({ projectId: 'dossier-ancien', operations: [
      { op: 'upsertNode', node: { id: 'personne-sans-entite', kind: 'person', label: 'Jean Dupont', data: { code: 'PERSONNE_PHYSIQUE_04' } } },
      ...person('PERSONNE_PHYSIQUE_02', 'Paul Martin', { codes_retires: ['PERSONNE_PHYSIQUE_07'] }),
    ] });
    expect(store.reservedCodes('dossier-recent')).toEqual(expect.arrayContaining(['PERSONNE_PHYSIQUE_02', 'PERSONNE_PHYSIQUE_04', 'PERSONNE_PHYSIQUE_07']));
    const created = createEntity('Marie Durand', 'person', 'tiers', store.snapshot('dossier-recent'));
    expect(created.nodeId).toBe('entity:PERSONNE_PHYSIQUE_08');
    expect(() => store.update({ projectId: 'dossier-recent', operations: person('PERSONNE_PHYSIQUE_07', 'Marie Durand') })).toThrow(/already used by another case/);
    expect(() => store.update({ projectId: 'dossier-recent', operations: person('PERSONNE_PHYSIQUE_04', 'Marie Durand') })).toThrow(/already used by another case/);
    expect(() => store.update({ projectId: 'dossier-ancien', operations: person('PERSONNE_PHYSIQUE_02', 'P. Martin') })).not.toThrow();
  });

  it('laisse le dossier qui tient un code en clair le réécrire même s’il est retiré ailleurs', () => {
    const databasePath = createTwoCaseDatabase();
    open(databasePath);
    closeAll();
    insertRaw(databasePath, 'dossier-ancien', 'PERSONNE_PHYSIQUE_01', 'Jean Dupont', '2026-01-01T00:00:00.000Z');
    insertRaw(databasePath, 'dossier-recent', 'PERSONNE_PHYSIQUE_01', 'Marie Durand', '2026-06-01T00:00:00.000Z');
    const store = open(databasePath);
    expect(() => store.update({ projectId: 'dossier-ancien', operations: person('PERSONNE_PHYSIQUE_01', 'J. Dupont') })).not.toThrow();
    expect(() => store.update({ projectId: 'dossier-recent', operations: person('PERSONNE_PHYSIQUE_01', 'Marie Durand') })).toThrow(/already used by another case/);
  });
});

describe('numérotation sans borne', () => {
  it('attribue le numéro suivant le plus grand, quelle que soit sa longueur', () => {
    const registry = codeRegistry(['PERSONNE_PHYSIQUE_01', 'PERSONNE_PHYSIQUE_12345', 'SAS_999999', 'CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_77']);
    expect(registry.next('PERSONNE_PHYSIQUE')).toBe('PERSONNE_PHYSIQUE_12346');
    expect(registry.next('PERSONNE_PHYSIQUE')).toBe('PERSONNE_PHYSIQUE_12347');
    expect(registry.next('SAS')).toBe('SAS_1000000');
    expect(registry.next('ADRESSE')).toBe('ADRESSE_01');
    expect(registry.has('PERSONNE_PHYSIQUE_12347')).toBe(true);
  });

  it('reste rapide avec cent mille codes déjà attribués', () => {
    const codes = Array.from({ length: 100_000 }, (_, index) => `PERSONNE_PHYSIQUE_${String(index + 1).padStart(2, '0')}`);
    const started = performance.now();
    const registry = codeRegistry(codes);
    const issued = Array.from({ length: 10_000 }, () => registry.next('PERSONNE_PHYSIQUE'));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(issued[0]).toBe('PERSONNE_PHYSIQUE_100001');
    expect(issued.at(-1)).toBe('PERSONNE_PHYSIQUE_110000');
    expect(new Set(issued).size).toBe(issued.length);
  });

  it('donne à une nouvelle partie un code au-delà de ceux de toute la base', () => {
    const node = { id: 'manual:new', kind: 'person' as const, data: {} };
    const change = partyCodeChange(node, { kind: 'person', side: '' }, [], [], ['PERSONNE_PHYSIQUE_12345']);
    expect(change.code).toBe('PERSONNE_PHYSIQUE_12346');
    const client = partyCodeChange(node, { kind: 'person', side: 'client', position: 'demandeur' }, [], [], ['CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_99999']);
    expect(client.code).toBe('CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_100000');
  });
});
