import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { KnowledgeStore } from '../knowledge.js';
import { partyCodeChange } from '../party-codes.js';
import type { KnowledgeNode } from '../types.js';

const stores: KnowledgeStore[] = [];
const directories: string[] = [];

const createStore = (): KnowledgeStore => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-party-codes-'));
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

const seedCompany = (store: KnowledgeStore): void => {
  store.update({
    projectId: 'project-1',
    operations: [
      { op: 'upsertNode', node: { id: 'entity:SOCIETE_SA_06', kind: 'company', label: 'Comptoir Dubreuil', data: { code: 'SOCIETE_SA_06', legalForm: 'SA' }, origin: 'gliner' } },
      { op: 'upsertNode', node: { id: 'document:1', kind: 'document', label: 'Assignation' } },
      { op: 'upsertMapping', mapping: { nodeId: 'entity:SOCIETE_SA_06', real: 'Comptoir Dubreuil', masked: 'SOCIETE_SA_06', origin: 'gliner' } },
      { op: 'link', link: { fromNodeId: 'document:1', toNodeId: 'entity:SOCIETE_SA_06', relation: 'mentions', origin: 'gliner' } },
    ],
  });
};

const nodeOf = (store: KnowledgeStore, id: string): KnowledgeNode | undefined => store.snapshot('project-1').nodes.find((entry) => entry.id === id);

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('party code assignment', () => {
  it('derives the code from the side, the position and the legal form', () => {
    const change = partyCodeChange(
      { id: 'entity:SOCIETE_SA_06', kind: 'company', data: { code: 'SOCIETE_SA_06' } },
      { kind: 'company', legalForm: 'S.A.', side: 'adversaire', position: 'demandeur' },
      [],
      [],
    );
    expect(change.code).toBe('ADVERSAIRE_DEMANDEUR_SA_01');
    expect(change.nodeId).toBe('entity:ADVERSAIRE_DEMANDEUR_SA_01');
    expect(change.data.originalCode).toBe('SOCIETE_SA_06');
  });

  it('takes the next free number when the prefix is already occupied', () => {
    const change = partyCodeChange(
      { id: 'entity:SOCIETE_SA_06', kind: 'company', data: { code: 'SOCIETE_SA_06' } },
      { kind: 'company', legalForm: 'SA', side: 'adversaire', position: 'demandeur' },
      [{ id: 'entity:ADVERSAIRE_DEMANDEUR_SA_01', data: { code: 'ADVERSAIRE_DEMANDEUR_SA_01' } }],
      [],
    );
    expect(change.code).toBe('ADVERSAIRE_DEMANDEUR_SA_02');
  });

  it('skips the numbers already held by another case', () => {
    const change = partyCodeChange(
      { id: 'entity:SOCIETE_SA_06', kind: 'company', data: { code: 'SOCIETE_SA_06' } },
      { kind: 'company', legalForm: 'SA', side: 'adversaire', position: 'demandeur' },
      [],
      [],
      ['ADVERSAIRE_DEMANDEUR_SA_01', 'ADVERSAIRE_DEMANDEUR_SA_02'],
    );
    expect(change.code).toBe('ADVERSAIRE_DEMANDEUR_SA_03');
  });

  it('restores the original code when the party becomes a third party again', () => {
    const change = partyCodeChange(
      { id: 'entity:ADVERSAIRE_DEMANDEUR_SA_01', kind: 'company', data: { code: 'ADVERSAIRE_DEMANDEUR_SA_01', originalCode: 'SOCIETE_SA_06' } },
      { kind: 'company', side: 'tiers' },
      [],
      [],
    );
    expect(change.code).toBe('SOCIETE_SA_06');
    expect(change.nodeId).toBe('entity:SOCIETE_SA_06');
  });
});

describe('node renaming in sqlite', () => {
  it('moves mappings and links and rewrites the masked value', () => {
    const store = createStore();
    seedCompany(store);
    const change = partyCodeChange(
      nodeOf(store, 'entity:SOCIETE_SA_06')!,
      { kind: 'company', legalForm: 'SA', side: 'adversaire', position: 'demandeur' },
      store.snapshot('project-1').nodes,
      store.snapshot('project-1').mappings,
    );
    store.update({
      projectId: 'project-1',
      operations: [
        ...change.operations,
        { op: 'upsertNode', node: { id: change.nodeId, kind: 'company', label: 'Comptoir Dubreuil', data: change.data, origin: 'manual' } },
        { op: 'upsertMapping', mapping: { nodeId: change.nodeId, real: 'Comptoir Dubreuil', masked: change.code, origin: 'manual' } },
      ],
    });

    const snapshot = store.snapshot('project-1');
    expect(snapshot.nodes.map((entry) => entry.id).sort()).toEqual(['document:1', 'entity:ADVERSAIRE_DEMANDEUR_SA_01']);
    expect(snapshot.mappings).toEqual([expect.objectContaining({ nodeId: 'entity:ADVERSAIRE_DEMANDEUR_SA_01', real: 'Comptoir Dubreuil', masked: 'ADVERSAIRE_DEMANDEUR_SA_01' })]);
    expect(snapshot.links).toEqual([expect.objectContaining({ fromNodeId: 'document:1', toNodeId: 'entity:ADVERSAIRE_DEMANDEUR_SA_01', relation: 'mentions' })]);
    expect(snapshot.nodes.find((entry) => entry.id === 'entity:ADVERSAIRE_DEMANDEUR_SA_01')?.data).toMatchObject({ code: 'ADVERSAIRE_DEMANDEUR_SA_01', originalCode: 'SOCIETE_SA_06', partySide: 'adversaire', position: 'demandeur' });
  });

  it('brings the entity back to its original code and keeps its links', () => {
    const store = createStore();
    seedCompany(store);
    const toParty = partyCodeChange(nodeOf(store, 'entity:SOCIETE_SA_06')!, { kind: 'company', legalForm: 'SA', side: 'adversaire', position: 'demandeur' }, store.snapshot('project-1').nodes, store.snapshot('project-1').mappings);
    store.update({
      projectId: 'project-1',
      operations: [...toParty.operations, { op: 'upsertNode', node: { id: toParty.nodeId, kind: 'company', label: 'Comptoir Dubreuil', data: toParty.data, origin: 'manual' } }],
    });

    const back = partyCodeChange(nodeOf(store, toParty.nodeId)!, { kind: 'company', legalForm: 'SA', side: 'tiers' }, store.snapshot('project-1').nodes, store.snapshot('project-1').mappings);
    store.update({
      projectId: 'project-1',
      operations: [...back.operations, { op: 'upsertNode', node: { id: back.nodeId, kind: 'company', label: 'Comptoir Dubreuil', data: back.data, origin: 'manual' } }],
    });

    const snapshot = store.snapshot('project-1');
    expect(snapshot.nodes.map((entry) => entry.id).sort()).toEqual(['document:1', 'entity:SOCIETE_SA_06']);
    expect(snapshot.mappings.map((entry) => entry.masked)).toEqual(['SOCIETE_SA_06']);
    expect(snapshot.links).toEqual([expect.objectContaining({ toNodeId: 'entity:SOCIETE_SA_06' })]);
  });
});
