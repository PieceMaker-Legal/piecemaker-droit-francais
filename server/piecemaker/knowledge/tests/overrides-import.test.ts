import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { KnowledgeStore } from '../../../../plugins/piecemaker-dossier/src/knowledge.js';
import { importDocumentIndexOverrides } from '../overrides-import.js';

const keyOf = (relative: string): string => crypto.createHash('sha256').update(relative.normalize('NFC')).digest('hex');

type Fixture = { store: KnowledgeStore; projects: Array<{ project_id: string; project_path: string }>; indexFile: string; legacyFile: string; cleanup(): void };

function fixture(): Fixture {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-overrides-import-')));
  fs.mkdirSync(path.join(root, '.piecemaker'));
  const database = new Database(':memory:');
  database.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT NOT NULL UNIQUE)');
  database.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('project-1', root);
  const store = new KnowledgeStore(database);
  return {
    store,
    projects: [{ project_id: 'project-1', project_path: root }],
    indexFile: path.join(root, '.piecemaker', 'document-index.json'),
    legacyFile: path.join(root, '.piecemaker', 'document-index-overrides.json'),
    cleanup: () => { database.close(); fs.rmSync(root, { recursive: true, force: true }); },
  };
}

const documentNode = (relative: string, date?: string | null, data: Record<string, unknown> = {}) => ({ op: 'upsertNode' as const, node: { id: `document:${keyOf(relative)}`, kind: 'document' as const, label: path.basename(relative), data: { path: relative, ...data }, ...(date === undefined ? {} : { date }) } });
const readIndex = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
const nodeById = (store: KnowledgeStore, id: string) => store.snapshot('project-1').nodes.find((node) => node.id === id);

test('importe les dates, types, lieux et champs libres corrigés puis retire les racines importées', () => {
  const { store, projects, indexFile, legacyFile, cleanup } = fixture();
  try {
    store.update({ projectId: 'project-1', operations: [
      documentNode('Pieces/lettre.pdf', '2020-01-01', { nature: 'courrier', localisation: 'Lyon', nature_confidence: 0.4 }),
      documentNode('Pieces/devis.pdf', '2023-01-01', { nature: 'devis' }),
      documentNode('Pieces/facture.pdf', '2022-05-05', { nature: 'facture' }),
    ] });
    fs.writeFileSync(indexFile, JSON.stringify({
      version: 2,
      documents: { [keyOf('Pieces/lettre.pdf')]: { nature: 'courrier' } },
      overrides: {
        [keyOf('Pieces/lettre.pdf')]: { nature: 'mise en demeure', dateIso: '2024-03-12', localisation: 'Paris', fields: [{ label: 'Destinataire', value: 'Société Exemple SAS' }], updatedAt: '2024-04-01T10:00:00.000Z' },
        [keyOf('Pieces/devis.pdf')]: { dateIso: 'pas une date' },
        [keyOf('Pieces/facture.pdf')]: { nature: null, dateIso: null, localisation: null, fields: [] },
      },
      revisions: [{ revision: 1 }],
    }));
    fs.writeFileSync(legacyFile, JSON.stringify({ version: 1, documents: { [keyOf('Pieces/lettre.pdf')]: { nature: 'ancienne nature' } } }));

    importDocumentIndexOverrides(store, { listProjects: () => projects });

    const lettre = nodeById(store, `document:${keyOf('Pieces/lettre.pdf')}`);
    assert.equal(lettre?.date, '2024-03-12');
    assert.equal(lettre?.data.nature, 'mise en demeure');
    assert.equal(lettre?.data.localisation, 'Paris');
    assert.equal(lettre?.data.nature_confidence, 0.4);
    assert.deepEqual(lettre?.data.fields, [{ label: 'Destinataire', value: 'Société Exemple SAS' }]);
    const devis = nodeById(store, `document:${keyOf('Pieces/devis.pdf')}`);
    assert.equal(devis?.date, null);
    assert.equal(devis?.data.date_non_reconnue, 'pas une date');
    assert.equal(devis?.data.nature, 'devis');
    const facture = nodeById(store, `document:${keyOf('Pieces/facture.pdf')}`);
    assert.equal(facture?.date, '2022-05-05');
    assert.equal(facture?.data.nature, 'facture');
    const index = readIndex(indexFile);
    assert.deepEqual(Object.keys(index).sort(), ['documents', 'version']);
    assert.deepEqual(index.documents, { [keyOf('Pieces/lettre.pdf')]: { nature: 'courrier' } });
    assert.equal(fs.existsSync(legacyFile), false);
  } finally {
    cleanup();
  }
});

test('une seconde exécution ne change ni la base ni le fichier', () => {
  const { store, projects, indexFile, cleanup } = fixture();
  try {
    store.update({ projectId: 'project-1', operations: [documentNode('Pieces/lettre.pdf', '2020-01-01', { nature: 'courrier' })] });
    fs.writeFileSync(indexFile, JSON.stringify({ version: 2, documents: {}, overrides: { [keyOf('Pieces/lettre.pdf')]: { nature: 'mise en demeure', dateIso: '2024-03-12' } } }));
    importDocumentIndexOverrides(store, { listProjects: () => projects });
    const before = { file: fs.readFileSync(indexFile, 'utf8'), node: JSON.stringify(nodeById(store, `document:${keyOf('Pieces/lettre.pdf')}`)) };

    const applied = importDocumentIndexOverrides(store, { listProjects: () => projects });

    assert.equal(applied, 0);
    assert.equal(fs.readFileSync(indexFile, 'utf8'), before.file);
    assert.equal(JSON.stringify(nodeById(store, `document:${keyOf('Pieces/lettre.pdf')}`)), before.node);
  } finally {
    cleanup();
  }
});

test('un override sans noeud reste dans l’index, y compris venu du fichier ancien, et sera importé quand le noeud existera', () => {
  const { store, projects, indexFile, legacyFile, cleanup } = fixture();
  try {
    fs.writeFileSync(indexFile, JSON.stringify({ version: 2, documents: {}, overrides: { [keyOf('Pieces/lettre.pdf')]: { nature: 'mise en demeure' } } }));
    fs.writeFileSync(legacyFile, JSON.stringify({ version: 1, documents: { [keyOf('Pieces/devis.pdf')]: { localisation: 'Lyon' } } }));

    importDocumentIndexOverrides(store, { listProjects: () => projects });

    assert.deepEqual(Object.keys((readIndex(indexFile).overrides as Record<string, unknown>)).sort(), [keyOf('Pieces/devis.pdf'), keyOf('Pieces/lettre.pdf')].sort());
    assert.equal(fs.existsSync(legacyFile), false);

    store.update({ projectId: 'project-1', operations: [documentNode('Pieces/lettre.pdf', null)] });
    importDocumentIndexOverrides(store, { listProjects: () => projects });

    assert.equal(nodeById(store, `document:${keyOf('Pieces/lettre.pdf')}`)?.data.nature, 'mise en demeure');
    assert.deepEqual(Object.keys(readIndex(indexFile).overrides as Record<string, unknown>), [keyOf('Pieces/devis.pdf')]);
  } finally {
    cleanup();
  }
});

test('les corrections de l’index prennent le pas sur le fichier ancien', () => {
  const { store, projects, indexFile, legacyFile, cleanup } = fixture();
  try {
    store.update({ projectId: 'project-1', operations: [documentNode('Pieces/lettre.pdf')] });
    fs.writeFileSync(indexFile, JSON.stringify({ version: 2, documents: {}, overrides: { [keyOf('Pieces/lettre.pdf')]: { nature: 'mise en demeure' } } }));
    fs.writeFileSync(legacyFile, JSON.stringify({ version: 1, documents: { [keyOf('Pieces/lettre.pdf')]: { nature: 'ancienne nature' } } }));

    importDocumentIndexOverrides(store, { listProjects: () => projects });

    assert.equal(nodeById(store, `document:${keyOf('Pieces/lettre.pdf')}`)?.data.nature, 'mise en demeure');
  } finally {
    cleanup();
  }
});

test('un fichier ancien seul est importé puis supprimé sans créer d’index', () => {
  const { store, projects, indexFile, legacyFile, cleanup } = fixture();
  try {
    store.update({ projectId: 'project-1', operations: [documentNode('Pieces/lettre.pdf')] });
    fs.writeFileSync(legacyFile, JSON.stringify({ version: 1, documents: { [keyOf('Pieces/lettre.pdf')]: { localisation: 'Paris' } } }));

    importDocumentIndexOverrides(store, { listProjects: () => projects });

    assert.equal(nodeById(store, `document:${keyOf('Pieces/lettre.pdf')}`)?.data.localisation, 'Paris');
    assert.equal(fs.existsSync(legacyFile), false);
    assert.equal(fs.existsSync(indexFile), false);
  } finally {
    cleanup();
  }
});

test('les mentions écartées deviennent un retrait et une exclusion, les ajouts un lien', () => {
  const { store, projects, indexFile, cleanup } = fixture();
  try {
    const entity = (code: string, label: string) => ({ op: 'upsertNode' as const, node: { id: `entity:${code}`, kind: 'person' as const, label, data: { code } } });
    const link = (code: string) => ({ op: 'link' as const, link: { fromNodeId: `document:${keyOf('Pieces/lettre.pdf')}`, toNodeId: `entity:${code}`, relation: 'mentions', data: {} } });
    store.update({ projectId: 'project-1', operations: [documentNode('Pieces/lettre.pdf'), entity('PERSONNE_01', 'Jean Dupont'), entity('PERSONNE_02', 'Marie Exemple'), link('PERSONNE_01')] });
    fs.writeFileSync(indexFile, JSON.stringify({ version: 2, documents: {}, entityDecisions: { [keyOf('Pieces/lettre.pdf')]: { additions: ['PERSONNE_02', 'PERSONNE_99'], exclusions: ['PERSONNE_01'] } } }));

    importDocumentIndexOverrides(store, { listProjects: () => projects });

    const links = store.snapshot('project-1').links.map((entry) => entry.toNodeId);
    assert.deepEqual(links, ['entity:PERSONNE_02']);
    store.mergeScan('project-1', [link('PERSONNE_01'), link('PERSONNE_02')]);
    assert.deepEqual(store.snapshot('project-1').links.map((entry) => entry.toNodeId), ['entity:PERSONNE_02']);
    assert.equal('entityDecisions' in readIndex(indexFile), false);
  } finally {
    cleanup();
  }
});

test('l’échec d’un dossier est journalisé sans bloquer les autres', () => {
  const { store, projects, indexFile, cleanup } = fixture();
  try {
    store.update({ projectId: 'project-1', operations: [documentNode('Pieces/lettre.pdf')] });
    fs.writeFileSync(indexFile, JSON.stringify({ version: 2, documents: {}, overrides: { [keyOf('Pieces/lettre.pdf')]: { nature: 'mise en demeure' } } }));
    const unknownRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-overrides-unknown-'));
    fs.mkdirSync(path.join(unknownRoot, '.piecemaker'));
    fs.writeFileSync(path.join(unknownRoot, '.piecemaker', 'document-index.json'), JSON.stringify({ overrides: { [keyOf('x.pdf')]: { nature: 'devis' } } }));
    const warnings: string[] = [];

    try {
      importDocumentIndexOverrides(store, { listProjects: () => [{ project_id: 'inconnu', project_path: unknownRoot }, ...projects], warn: (message) => warnings.push(message) });
    } finally {
      fs.rmSync(unknownRoot, { recursive: true, force: true });
    }

    assert.equal(warnings.length, 1);
    assert.equal(nodeById(store, `document:${keyOf('Pieces/lettre.pdf')}`)?.data.nature, 'mise en demeure');
  } finally {
    cleanup();
  }
});
