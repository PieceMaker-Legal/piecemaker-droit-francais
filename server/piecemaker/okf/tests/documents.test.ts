import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import type { Review } from '../../../../plugins/piecemaker-tabular-review/src/shared.js';

import { bundleRoot } from '../bundle.js';
import { documentSlug, documentsFromIndex, indexDate } from '../documents.js';
import { createOkfBackend } from '../index.js';
import { createIndexStore } from '../index-store.js';

process.env.PIECEMAKER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-documents-home-'));

const SKILL = path.resolve(import.meta.dirname, '..', '..', 'vendor', 'skills', 'okf');
const FILE = 'Index.json';
const CONTRACT = 'Pièces/Contrats/Contrat de prestation.pdf';
const LETTER = 'Pièces/Courrier.pdf';
const NOTE = 'Projets/Note.docx';

function write(root: string, file: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

const cell = (summary: string) => ({ summary, flag: 'grey' as const, reasoning: '' });
const row = (id: string, source: string, label: string) => ({ id, label, documents: [{ source, copy: '', chars: 1 }], status: 'done' as const, finishedAt: '2026-11-20T09:00:00.000Z' });

function review(rows = [row('r1', CONTRACT, 'Contrat'), row('r2', LETTER, 'Courrier'), row('r3', NOTE, 'Note'), row('r4', 'Pièces/Absent.pdf', 'Absent')]): Review {
  return {
    version: 1, title: 'Index', templateName: 'Index', category: 'documents', projectPath: '/dossier', createdAt: '2026-11-18T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z',
    provider: 'codex', model: 'exemple', concurrency: 1,
    columns: [
      { index: 0, name: 'Date', prompt: '', format: 'date' },
      { index: 1, name: 'Événement', prompt: '', format: 'text' },
      { index: 2, name: 'Nature', prompt: '', format: 'tags' },
      { index: 3, name: 'Classement', prompt: '', format: 'tags', action: 'classify' },
    ],
    rows,
    cells: {
      r1: { 0: cell('12 mars 2021'), 1: cell('La société A confie la prestation\nà la société B.'), 2: cell('Contrat'), 3: cell('Pièces/Contrats') },
      r2: { 0: cell('05/06/2022'), 2: cell('Courrier') },
      r3: { 1: cell('Note de travail.') },
    },
  };
}

function dossier() {
  const projectPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'okf-documents-')));
  const root = bundleRoot(projectPath);
  for (const piece of [CONTRACT, LETTER, NOTE]) write(projectPath, piece, 'Pièce.');
  write(root, 'index.md', '---\nokf_version: "0.3"\n---\n\n# Dossier\n\n- [Positions](positions/index.md)\n');
  write(root, 'positions/index.md', '# Positions\n\n- [Créance](creance.md)\n');
  write(root, 'positions/creance.md', `---\ntype: Position\ntitle: Créance\ndescription: Le client doit payer.\nresource: "/${CONTRACT}"\n---\n\n# Créance\n\nFondée sur [le contrat](../documents/contrat.md).\n`);
  write(root, 'documents/contrat.md', `---\ntype: Document\ntitle: Contrat\ndescription: Écrit à la main.\nresource: "/${CONTRACT}"\n---\n\n# Contrat\n`);
  const database = new Database(':memory:');
  database.exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY); INSERT INTO projects VALUES('p');");
  const store = createIndexStore(database);
  const okf = createOkfBackend({
    projects: { getProjectById: () => ({ project_path: projectPath }), getProjectPath: () => ({ project_id: 'p', project_path: projectPath }) },
    snapshot: (projectId) => ({ projectId, nodes: [], links: [], mappings: [], citations: [] }),
    indexStore: store,
    skillRoot: SKILL,
    python: () => 'python3',
    isLoopback: () => true,
  });
  return { projectPath, root, store, okf };
}

const CONTRACT_FILE = `${documentSlug(CONTRACT)}.md`;

test('indexDate et documentSlug : date AAAA-MM-JJ et nom stable tiré du chemin', () => {
  assert.equal(indexDate('12 mars 2021'), '2021-03-12');
  assert.equal(indexDate('05/06/2022'), '2022-06-05');
  assert.equal(indexDate('2021-02-30'), '');
  assert.equal(documentSlug(CONTRACT), 'pieces-contrats-contrat-de-prestation');
  assert.equal(documentSlug(`/${CONTRACT}`), documentSlug(CONTRACT));
  assert.match(documentSlug(`Pièces/${'a'.repeat(120)}.pdf`), /^pieces-a{73}-[0-9a-f]{6}$/);
});

test('seules les pièces existantes d\'un dossier de type Pièces deviennent des Documents', () => {
  const { projectPath } = dossier();
  const documents = documentsFromIndex(projectPath, review());
  assert.deepEqual(documents.map((document) => document.resource), [CONTRACT, LETTER]);
  assert.deepEqual(documents[0], {
    resource: CONTRACT, file: CONTRACT_FILE, title: 'Contrat', description: 'La société A confie la prestation à la société B.', date: '2021-03-12', nature: 'Contrat', classement: 'Pièces/Contrats', at: '2026-11-20T09:00:00.000Z',
    fields: [['Date', '12 mars 2021'], ['Événement', 'La société A confie la prestation à la société B.'], ['Nature', 'Contrat'], ['Classement', 'Pièces/Contrats']],
  });
  assert.equal(documents[1].description, 'Courrier du 2022-06-05 (Courrier.pdf)');
});

test('documents/ est régénéré depuis l\'Index : fiche manuelle remplacée, liens réécrits, bundle valide', async () => {
  const { root, store, okf } = dossier();
  store.write('p', FILE, review());
  const report = await okf.verify('p');
  assert.deepEqual(report.erreurs, []);
  assert.deepEqual(report.lints, []);
  assert.deepEqual(fs.readdirSync(path.join(root, 'documents')).sort(), [CONTRACT_FILE, 'index.md', 'pieces-courrier.md'].sort());
  const fiche = fs.readFileSync(path.join(root, 'documents', CONTRACT_FILE), 'utf8');
  assert.match(fiche, /^---\ntype: Document\ntitle: Contrat\n/);
  assert.match(fiche, /resource: \/Pièces\/Contrats\/Contrat de prestation\.pdf\n/);
  assert.match(fiche, /date: 2021-03-12\n/);
  assert.match(fiche, /generated:\n {2}by: index\n {2}at: 2026-11-20T09:00:00.000Z\n/);
  assert.match(fiche, /- Classement : Pièces\/Contrats\n/);
  assert.match(fs.readFileSync(path.join(root, 'positions', 'creance.md'), 'utf8'), new RegExp(`\\(\\.\\./documents/${CONTRACT_FILE}\\)`));
  assert.match(fs.readFileSync(path.join(root, 'index.md'), 'utf8'), /\[Documents\]\(documents\/index\.md\)/);
  assert.match(fs.readFileSync(path.join(root, 'documents', 'index.md'), 'utf8'), /^# Documents\n[\s\S]*- \[Contrat\]\(pieces-contrats-contrat-de-prestation\.md\) — 2021-03-12 · Contrat\n/);
  const fiches = okf.read('p').fiches.filter((entry) => entry.lof === 'Document');
  assert.deepEqual(fiches.map((entry) => [entry.id, entry.nature]), [[`/documents/${CONTRACT_FILE}`, 'Contrat'], ['/documents/pieces-courrier.md', 'Courrier']]);
});

test('une modification manuelle est écrasée et une pièce sortie de l\'Index perd sa fiche', async () => {
  const { root, store, okf } = dossier();
  store.write('p', FILE, review());
  okf.read('p');
  write(root, 'documents/pieces-courrier.md', '---\ntype: Document\ntitle: Modifié\ndescription: À la main.\n---\n');
  write(root, 'documents/autre.md', '---\ntype: Document\ntitle: Autre\ndescription: Pièce hors Index.\n---\n');
  okf.read('p');
  assert.match(fs.readFileSync(path.join(root, 'documents', 'pieces-courrier.md'), 'utf8'), /title: Courrier/);
  store.write('p', FILE, review([row('r1', CONTRACT, 'Contrat')]));
  okf.read('p');
  assert.deepEqual(fs.readdirSync(path.join(root, 'documents')).sort(), ['autre.md', CONTRACT_FILE, 'index.md'].sort());
  const before = fs.readFileSync(path.join(root, 'index.md'), 'utf8');
  okf.read('p');
  assert.equal(fs.readFileSync(path.join(root, 'index.md'), 'utf8'), before);
});

test('sans Index ni bundle, documents/ n\'est pas touché', () => {
  const { projectPath, root, store, okf } = dossier();
  okf.read('p');
  assert.deepEqual(fs.readdirSync(path.join(root, 'documents')), ['contrat.md']);
  fs.rmSync(root, { recursive: true });
  store.write('p', FILE, review());
  okf.read('p');
  assert.equal(fs.existsSync(path.join(bundleRoot(projectPath), 'documents')), false);
});
