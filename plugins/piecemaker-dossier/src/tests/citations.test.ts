import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { citableEntities, citationSource, citationsOfEntity, citationsOfMention, pieceMentionOperations } from '../citations.js';
import { KnowledgeStore } from '../knowledge.js';
import type { KnowledgeCitation, KnowledgeNode, KnowledgeUpdateOperation } from '../types.js';

const PIECE = 'document:contrat';
const JEAN = 'entity:PERSONNE_PHYSIQUE_01';
const SOCIETE = 'entity:PERSONNE_MORALE_01';
const MARIE = 'entity:PERSONNE_PHYSIQUE_02';

const mention = (entity: string) => ({ fromNodeId: PIECE, toNodeId: entity, relation: 'mentions' });
const edit = (overrides: Partial<Parameters<typeof pieceMentionOperations>[0]> = {}) => pieceMentionOperations({
  pieceId: PIECE,
  mentionLinks: [mention(JEAN), mention(SOCIETE)],
  selected: new Set([JEAN, SOCIETE]),
  removedCitationIds: new Set(),
  pending: [],
  renamed: (id) => id,
  ...overrides,
});

describe('pieceMentionOperations', () => {
  it('emits nothing for unchanged mentions, so their citations are kept', () => {
    expect(edit()).toEqual([]);
  });

  it('unlinks a removed mention and excludes it for the case', () => {
    expect(edit({ selected: new Set([JEAN]) })).toEqual([
      { op: 'unlink', link: mention(SOCIETE) },
      { op: 'excludeLink', exclusion: { piece: PIECE, entite: SOCIETE, relation: 'mentions' } },
    ]);
  });

  it('links an added mention only', () => {
    expect(edit({ selected: new Set([JEAN, SOCIETE, MARIE]) })).toEqual([{ op: 'link', link: mention(MARIE) }]);
  });

  it('keeps a mention whose entity was renamed in the editor', () => {
    const renamed = (id: string) => id === JEAN ? 'entity:CLIENT_01' : id;
    expect(edit({ selected: new Set(['entity:CLIENT_01', SOCIETE]), renamed })).toEqual([]);
    expect(edit({ selected: new Set([SOCIETE]), renamed })).toEqual([
      { op: 'unlink', link: mention('entity:CLIENT_01') },
      { op: 'excludeLink', exclusion: { piece: PIECE, entite: 'entity:CLIENT_01', relation: 'mentions' } },
    ]);
  });

  it('deletes the removed citations by id, in order', () => {
    expect(edit({ removedCitationIds: new Set([9, 4]) })).toEqual([{ op: 'uncite', id: 4 }, { op: 'uncite', id: 9 }]);
  });

  it('cites a selection for a new entity after linking it', () => {
    expect(edit({ selected: new Set([JEAN, SOCIETE, MARIE]), pending: [{ entityId: MARIE, texte: 'Marie Martin signe.' }, { entityId: MARIE, texte: 'Marie Martin signe.' }] })).toEqual([
      { op: 'link', link: mention(MARIE) },
      { op: 'cite', citation: { fromNodeId: PIECE, toNodeId: MARIE, relation: 'mentions', texte: 'Marie Martin signe.', pieceId: PIECE } },
    ]);
  });

  it('cites a selection for an entity that is already mentioned without linking again', () => {
    expect(edit({ pending: [{ entityId: JEAN, texte: 'Jean Dupont paie.' }] })).toEqual([
      { op: 'cite', citation: { fromNodeId: PIECE, toNodeId: JEAN, relation: 'mentions', texte: 'Jean Dupont paie.', pieceId: PIECE } },
    ]);
  });

  it('skips a pending citation whose entity was removed afterwards, and follows renames', () => {
    expect(edit({ selected: new Set([JEAN]), pending: [{ entityId: SOCIETE, texte: 'Société Exemple SAS vend.' }] })).toEqual([
      { op: 'unlink', link: mention(SOCIETE) },
      { op: 'excludeLink', exclusion: { piece: PIECE, entite: SOCIETE, relation: 'mentions' } },
    ]);
    const renamed = (id: string) => id === MARIE ? 'entity:ADVERSAIRE_01' : id;
    expect(edit({ selected: new Set([JEAN, SOCIETE, 'entity:ADVERSAIRE_01']), renamed, pending: [{ entityId: MARIE, texte: 'Marie Martin signe.' }] }).map((operation) => operation.op)).toEqual(['link', 'cite']);
  });
});

const node = (id: string, kind: KnowledgeNode['kind'], label: string): KnowledgeNode => ({ projectId: 'p', id, kind, label, aliases: [], data: {}, date: null, createdAt: '', updatedAt: '' });
const citation = (id: number, from: string, to: string, overrides: Partial<KnowledgeCitation> = {}): KnowledgeCitation => ({ id, projectId: 'p', fromNodeId: from, toNodeId: to, relation: 'mentions', texte: `extrait ${id}`, pieceId: from, source: null, createdAt: '', ...overrides } as KnowledgeCitation);

describe('citation helpers', () => {
  const nodes = [node(PIECE, 'document', 'Contrat.pdf'), node(JEAN, 'person', 'Jean Dupont'), node(SOCIETE, 'company', 'Société Exemple SAS'), node(MARIE, 'person', 'Marie Martin'), node('x:1', 'iban', 'FR76')];

  it('keeps the citations of one mention, following renames', () => {
    const all = [citation(1, PIECE, JEAN), citation(2, PIECE, SOCIETE), citation(3, 'document:autre', JEAN)];
    expect(citationsOfMention(all, PIECE, JEAN).map((entry) => entry.id)).toEqual([1]);
    expect(citationsOfMention(all, PIECE, 'entity:CLIENT_01', (id) => id === JEAN ? 'entity:CLIENT_01' : id).map((entry) => entry.id)).toEqual([1]);
    expect(citationsOfEntity(all, JEAN).map((entry) => entry.id)).toEqual([1, 3]);
  });

  it('names the source as the piece or the free reference', () => {
    expect(citationSource(citation(1, PIECE, JEAN), nodes)).toBe('Contrat.pdf');
    expect(citationSource(citation(2, PIECE, JEAN, { pieceId: null, source: 'Registre national des entreprises' }), nodes)).toBe('Registre national des entreprises');
    expect(citationSource(citation(3, PIECE, JEAN, { pieceId: 'document:absent' }), nodes)).toBe('document:absent');
  });

  it('lists mentioned people and companies first, then the others, alphabetically', () => {
    expect(citableEntities(nodes, new Set([SOCIETE])).map((entry) => entry.label)).toEqual(['Société Exemple SAS', 'Jean Dupont', 'Marie Martin']);
    expect(citableEntities(nodes, new Set()).map((entry) => entry.label)).toEqual(['Jean Dupont', 'Marie Martin', 'Société Exemple SAS']);
  });
});

describe('piece editor against the store', () => {
  const stores: KnowledgeStore[] = [];
  const directories: string[] = [];
  const previousTerms = process.env.PIECEMAKER_INSTITUTIONAL_TERMS;

  const createStore = (): KnowledgeStore => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-citations-'));
    directories.push(directory);
    fs.writeFileSync(path.join(directory, 'terms.json'), JSON.stringify({ version: 1, terms: [] }));
    process.env.PIECEMAKER_INSTITUTIONAL_TERMS = path.join(directory, 'terms.json');
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
    if (previousTerms === undefined) delete process.env.PIECEMAKER_INSTITUTIONAL_TERMS;
    else process.env.PIECEMAKER_INSTITUTIONAL_TERMS = previousTerms;
  });

  const seed = (store: KnowledgeStore): void => {
    store.update({ projectId: 'project-1', operations: [
      { op: 'upsertNode', node: { id: PIECE, kind: 'document', label: 'Contrat.pdf' } },
      { op: 'upsertNode', node: { id: JEAN, kind: 'person', label: 'Jean Dupont' } },
      { op: 'upsertNode', node: { id: SOCIETE, kind: 'company', label: 'Société Exemple SAS' } },
      { op: 'link', link: mention(JEAN) },
      { op: 'link', link: mention(SOCIETE) },
      { op: 'cite', citation: { ...mention(JEAN), texte: 'Jean Dupont signe.', pieceId: PIECE } },
      { op: 'cite', citation: { ...mention(SOCIETE), texte: 'Société Exemple SAS vend.', pieceId: PIECE } },
    ] });
  };

  const save = (store: KnowledgeStore, operations: KnowledgeUpdateOperation[]) => store.update({ projectId: 'project-1', operations });
  const texts = (store: KnowledgeStore) => store.snapshot('project-1').citations.map((entry) => entry.texte).sort();

  it('keeps the citations when a piece is saved without touching its mentions', () => {
    const store = createStore();
    seed(store);
    save(store, edit());
    expect(texts(store)).toEqual(['Jean Dupont signe.', 'Société Exemple SAS vend.']);
  });

  it('drops the citations of a removed mention and records its exclusion', () => {
    const store = createStore();
    seed(store);
    save(store, edit({ selected: new Set([JEAN]) }));
    const snapshot = store.snapshot('project-1');
    expect(snapshot.links.map((link) => link.toNodeId)).toEqual([JEAN]);
    expect(texts(store)).toEqual(['Jean Dupont signe.']);
    store.mergeScan('project-1', [{ op: 'link', link: { ...mention(SOCIETE), data: {} } }]);
    expect(store.snapshot('project-1').links.map((link) => link.toNodeId)).toEqual([JEAN]);
  });

  it('removes one citation and adds a selection as a citation of a new mention', () => {
    const store = createStore();
    seed(store);
    store.update({ projectId: 'project-1', operations: [{ op: 'upsertNode', node: { id: MARIE, kind: 'person', label: 'Marie Martin' } }] });
    const jeanCitation = store.snapshot('project-1').citations.find((entry) => entry.toNodeId === JEAN);
    save(store, edit({
      selected: new Set([JEAN, SOCIETE, MARIE]),
      removedCitationIds: new Set([jeanCitation!.id]),
      pending: [{ entityId: MARIE, texte: 'Marie Martin est gérante.' }],
    }));
    const snapshot = store.snapshot('project-1');
    expect(texts(store)).toEqual(['Marie Martin est gérante.', 'Société Exemple SAS vend.']);
    expect(snapshot.links.map((link) => link.toNodeId).sort()).toEqual([JEAN, MARIE, SOCIETE].sort());
    expect(snapshot.citations.find((entry) => entry.toNodeId === MARIE)).toMatchObject({ pieceId: PIECE, relation: 'mentions' });
  });
});
