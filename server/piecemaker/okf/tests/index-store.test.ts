import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';
import express from 'express';

import { REVIEW_FOLDER } from '../../../../plugins/piecemaker-tabular-review/src/shared.js';
import type { Review } from '../../../../plugins/piecemaker-tabular-review/src/shared.js';

import { documentsFromIndex, indexDate, mergeDocuments } from '../build.js';
import { readBundle } from '../bundle.js';
import { createOkfBackend } from '../index.js';
import { IndexConflictError, createIndexStore, loadIndex } from '../index-store.js';
import { createOkfStore } from '../store.js';

process.env.PIECEMAKER_HOME ??= fs.mkdtempSync(path.join(os.tmpdir(), 'okf-index-home-'));

const FILE = '26-11-18 - Analyse Tabulaire Index - Index.json';

function dossier() {
  const projectPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'okf-index-')));
  fs.mkdirSync(path.join(projectPath, 'Pièces'));
  fs.writeFileSync(path.join(projectPath, 'Pièces', 'Contrat.md'), 'Contrat de prestation conclu le 12 mars 2021.');
  fs.writeFileSync(path.join(projectPath, 'Pièces', 'Courrier.md'), 'Courrier de résiliation.');
  const database = new Database(':memory:');
  database.exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY); INSERT INTO projects VALUES('p');");
  return { projectPath, database, index: createIndexStore(database) };
}

function review(): Review {
  return {
    version: 1, title: 'Index', templateName: 'Index', category: 'documents', projectPath: '/dossier', createdAt: '2026-11-18T10:00:00.000Z', updatedAt: '2026-11-18T10:00:00.000Z',
    provider: 'codex', model: 'exemple', concurrency: 3,
    columns: [{ index: 0, name: 'Date', prompt: 'Date du document', format: 'date' }, { index: 1, name: 'Nature', prompt: 'Nature', format: 'text', tags: ['contrat', 'courrier'] }],
    rows: [
      { id: 'r1', label: 'Contrat', documents: [{ source: 'Pièces/Contrat.md', copy: 'docs/Contrat.md', chars: 10 }], status: 'done', title: { summary: 'Convention de prestation', flag: 'grey', reasoning: '', citations: [{ document: 'Pièces/Contrat.md', quote: 'Contrat de prestation', verified: true }] } },
      { id: 'r2', label: 'Courrier', documents: [{ source: 'Pièces/Courrier.md', copy: 'docs/Courrier.md', chars: 10 }], status: 'pending' },
    ],
    cells: { r1: { 0: { summary: '12/03/2021', flag: 'grey', reasoning: '', citations: [{ document: 'Pièces/Contrat.md', quote: '12 mars 2021', verified: true }], checked: { at: '2026-11-18T11:00:00.000Z' } }, 1: { summary: 'contrat', flag: 'grey', reasoning: '' } } },
  };
}

test('l’Index tient dans SQLite : colonnes, lignes et cellules relues telles quelles, avec une révision', () => {
  const { index } = dossier();
  assert.equal(index.read('p'), null);
  assert.equal(index.write('p', FILE, review()), 1);
  const stored = index.read('p')!;
  assert.equal(stored.file, FILE);
  assert.equal(stored.revision, 1);
  assert.deepEqual(stored.review, review());
  const next = { ...review(), rows: [review().rows[1]], cells: {} };
  assert.equal(index.write('p', FILE, next, 1), 2);
  assert.deepEqual(index.read('p')!.review.rows.map((row) => row.id), ['r2']);
  assert.deepEqual(index.read('p')!.review.cells, {});
  assert.throws(() => index.write('p', FILE, review(), 1), IndexConflictError);
  assert.throws(() => index.write('p', 'sous/dossier.json', review()), TypeError);
  index.remove('p');
  assert.equal(index.read('p'), null);
});

test('un Index encore en .json est repris une fois dans SQLite', () => {
  const { projectPath, index } = dossier();
  fs.mkdirSync(path.join(projectPath, REVIEW_FOLDER));
  fs.writeFileSync(path.join(projectPath, REVIEW_FOLDER, FILE), JSON.stringify(review()));
  fs.writeFileSync(path.join(projectPath, REVIEW_FOLDER, 'Baux.json'), JSON.stringify({ ...review(), title: 'Baux', templateName: 'Analyse de baux' }));
  const loaded = loadIndex(index, 'p', projectPath)!;
  assert.equal(loaded.file, FILE);
  assert.deepEqual(loaded.review, review());
  fs.rmSync(path.join(projectPath, REVIEW_FOLDER, FILE));
  assert.equal(loadIndex(index, 'p', projectPath)!.file, FILE);
});

test('les pièces de l’OKF viennent de l’Index, même sans scan ; le scan n’y ajoute que ses parties', () => {
  const { projectPath } = dossier();
  assert.equal(indexDate('2021-03-12'), '2021-03-12');
  assert.equal(indexDate('12 mars 2021'), '2021-03-12');
  assert.equal(indexDate('Non trouvé'), '');
  const documents = documentsFromIndex(projectPath, review());
  assert.deepEqual(documents.map(({ resource, title, nature, date }) => ({ resource, title, nature, date })), [
    { resource: 'Pièces/Contrat.md', title: 'Convention de prestation', nature: 'contrat', date: '2021-03-12' },
    { resource: 'Pièces/Courrier.md', title: 'Courrier', nature: '', date: '' },
  ]);
  const merged = mergeDocuments(documents, [{ resource: 'Pièces/Contrat.md', title: 'Contrat.md', nature: 'facture', date: '', parties: [{ code: 'SOCIETE_01', citation: 'la Société' }] }, { resource: 'Pièces/Annexe.md', title: 'Annexe', nature: '', date: '', parties: [] }]);
  assert.deepEqual(merged.map((document) => [document.resource, document.nature, document.parties.length]), [['Pièces/Annexe.md', '', 0], ['Pièces/Contrat.md', 'contrat', 1], ['Pièces/Courrier.md', '', 0]]);
});

test('la Tabular Review lit et écrit l’Index par l’hôte, qui en régénère le .json et les fiches', async () => {
  const { projectPath, database, index } = dossier();
  const backend = createOkfBackend({
    projects: { getProjectById: () => ({ project_path: projectPath }), getProjectPath: (folder) => folder === projectPath ? { project_id: 'p', project_path: projectPath } : null },
    snapshot: (projectId) => ({ projectId, nodes: [], links: [], mappings: [], citations: [] }),
    store: createOkfStore(database),
    indexStore: index,
    convertedMarkdown: (_projectPath, filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null,
    listDocuments: async () => [path.join(projectPath, 'Pièces', 'Contrat.md'), path.join(projectPath, 'Pièces', 'Courrier.md')],
    isLoopback: () => true,
  });
  const app = express().use('/api/piecemaker/local', backend.localRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/piecemaker/local/index-review`;
  try {
    const empty = await (await fetch(`${origin}?folder=${encodeURIComponent(projectPath)}`)).json();
    assert.deepEqual(empty, { fichier: null, review: null, revision: 0 });
    const put = await fetch(origin, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: projectPath, fichier: FILE, review: review() }) });
    assert.deepEqual(await put.json(), { fichier: FILE, revision: 1 });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(projectPath, REVIEW_FOLDER, FILE), 'utf8')), review());
    const conflict = await fetch(origin, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: projectPath, fichier: FILE, review: review(), revision: 0 }) });
    assert.equal(conflict.status, 409);
    const read = await (await fetch(`${origin}?folder=${encodeURIComponent(projectPath)}`)).json() as { fichier: string; revision: number };
    assert.equal(read.fichier, FILE);
    assert.equal(read.revision, 1);
    const unknown = await fetch(`${origin}?folder=${encodeURIComponent('/ailleurs')}`);
    assert.equal(unknown.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  backend.build('p');
  const fiches = readBundle(projectPath).filter((concept) => !concept.error).map((concept) => [concept.frontmatter.resource, concept.frontmatter.title, concept.frontmatter.date]);
  assert.deepEqual(fiches.filter(([resource]) => resource), [['Pièces/Contrat.md', 'Convention de prestation', '2021-03-12'], ['Pièces/Courrier.md', 'Courrier', undefined]]);
});
