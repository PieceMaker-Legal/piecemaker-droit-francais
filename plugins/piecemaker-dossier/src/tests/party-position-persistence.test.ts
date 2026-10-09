import Database from 'better-sqlite3';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nodeEditor } from '../editors.js';
import { KnowledgeStore } from '../knowledge.js';

let database: InstanceType<typeof Database>;
let store: KnowledgeStore;
const originalId = 'entity:CLIENT_PERSONNE_PHYSIQUE_01';
const originalData = { code: 'CLIENT_PERSONNE_PHYSIQUE_01', partySide: 'client', position: null };
const storedData = (id: string): Record<string, unknown> => JSON.parse((database.prepare('SELECT data_json FROM piecemaker_nodes WHERE id=?').get(id) as { data_json: string }).data_json);

beforeEach(() => {
  database = new Database(':memory:');
  database.exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY, project_path TEXT NOT NULL UNIQUE); INSERT INTO projects VALUES('project-exemple','/cases/exemple')");
  store = new KnowledgeStore(database);
  store.update({ projectId: 'project-exemple', operations: [
    { op: 'upsertNode', node: { id: originalId, kind: 'person', label: 'Jean Dupont', aliases: ['J. Dupont'], data: originalData } },
    { op: 'upsertMapping', mapping: { nodeId: originalId, real: 'Jean Dupont', masked: originalData.code, data: { source: 'exemple' } } },
    { op: 'upsertNode', node: { id: 'document:exemple', kind: 'document', label: 'Document fictif' } },
    { op: 'link', link: { fromNodeId: 'document:exemple', toNodeId: originalId, relation: 'mentions' } },
    { op: 'cite', citation: { fromNodeId: 'document:exemple', toNodeId: originalId, relation: 'mentions', texte: 'Jean Dupont', pieceId: 'document:exemple' } },
  ] });
});

afterEach(() => database.close());

describe('database-driven party positions', () => {
  it('persists the form selection and derives the resulting anonymised code in SQLite', async () => {
    const dom = new JSDOM('<div id="root"></div>');
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('FormData', dom.window.FormData);
    try {
      const root = dom.window.document.getElementById('root')!;
      const graph = store.snapshot('project-exemple');
      nodeEditor(root, { graph }, graph.nodes.find((node) => node.id === originalId)!, async (operations) => { store.update({ projectId: 'project-exemple', operations }); });
      const select = root.querySelector<HTMLSelectElement>('[name="position"]')!;
      expect(select.value).toBe('');
      select.value = 'defendeur';
      select.dispatchEvent(new dom.window.Event('change'));
      expect(root.querySelector<HTMLTextAreaElement>('[name="masked"]')!.value).toBe(originalData.code);
      expect(storedData(originalId).position).toBeNull();
      root.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
      await vi.waitFor(() => expect(root.querySelector('form')).toBeNull());
      expect(storedData('entity:CLIENT_DEFENDEUR_PERSONNE_PHYSIQUE_01')).toMatchObject({ position: 'defendeur', code: 'CLIENT_DEFENDEUR_PERSONNE_PHYSIQUE_01' });
    } finally {
      dom.window.close();
      vi.unstubAllGlobals();
    }
  });

  it.each(['demandeur', 'defendeur'])('writes %s to the database before deriving the code', (position) => {
    const code = `CLIENT_${position.toUpperCase()}_PERSONNE_PHYSIQUE_01`;
    database.exec(`CREATE TRIGGER require_stored_position BEFORE INSERT ON piecemaker_nodes WHEN NEW.id='entity:${code}' BEGIN
      SELECT CASE WHEN (SELECT json_extract(data_json,'$.position') FROM piecemaker_nodes WHERE id='${originalId}') IS NOT '${position}' THEN RAISE(ABORT,'position must be stored first') END;
    END`);
    store.update({ projectId: 'project-exemple', operations: [
      { op: 'upsertNode', node: { id: originalId, kind: 'person', label: 'Jean Dupont', aliases: ['J. Dupont'], data: { ...originalData, position } } },
      { op: 'syncPartyCode', nodeId: originalId },
    ] });
    expect(storedData(`entity:${code}`)).toMatchObject({ position, code });
    const graph = store.snapshot('project-exemple');
    expect(graph.links[0].toNodeId).toBe(`entity:${code}`);
    expect(graph.citations[0].toNodeId).toBe(`entity:${code}`);
    expect(graph.mappings).toContainEqual(expect.objectContaining({ nodeId: `entity:${code}`, real: 'Jean Dupont', masked: code, data: { source: 'exemple' } }));
  });

  it('removes an encoded position when the database position is cleared', () => {
    store.update({ projectId: 'project-exemple', operations: [
      { op: 'upsertNode', node: { id: originalId, kind: 'person', label: 'Jean Dupont', data: { ...originalData, position: 'demandeur' } } },
      { op: 'syncPartyCode', nodeId: originalId },
    ] });
    const selectedId = 'entity:CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01';
    store.update({ projectId: 'project-exemple', operations: [
      { op: 'upsertNode', node: { id: selectedId, kind: 'person', label: 'Jean Dupont', data: { ...storedData(selectedId), position: null } } },
      { op: 'syncPartyCode', nodeId: selectedId },
    ] });
    expect(storedData(originalId)).toMatchObject(originalData);
  });

  it('does not populate the database position from a legacy code', () => {
    const legacyId = 'entity:ADVERSAIRE_DEFENDEUR_PERSONNE_PHYSIQUE_01';
    store.update({ projectId: 'project-exemple', operations: [
      { op: 'upsertNode', node: { id: legacyId, kind: 'person', label: 'Marie Martin', data: { code: legacyId.slice(7), partySide: 'adversaire', position: null } } },
      { op: 'syncPartyCode', nodeId: legacyId },
    ] });
    expect(storedData('entity:ADVERSAIRE_PERSONNE_PHYSIQUE_01')).toMatchObject({ position: null, code: 'ADVERSAIRE_PERSONNE_PHYSIQUE_01' });
  });

  it('rolls back the position write if synchronizing a custom code fails', () => {
    store.update({ projectId: 'project-exemple', operations: [{ op: 'upsertNode', node: { id: 'entity:ENTITE_EXEMPLE_07', kind: 'person', label: 'Marie Martin', data: { code: 'ENTITE_EXEMPLE_07' } } }] });
    expect(() => store.update({ projectId: 'project-exemple', operations: [
      { op: 'upsertNode', node: { id: originalId, kind: 'person', label: 'Jean Dupont', data: { ...originalData, position: 'defendeur' } } },
      { op: 'syncPartyCode', nodeId: originalId, customCode: 'ENTITE_EXEMPLE_07' },
    ] })).toThrow('déjà utilisé');
    expect(storedData(originalId)).toMatchObject(originalData);
  });
});
