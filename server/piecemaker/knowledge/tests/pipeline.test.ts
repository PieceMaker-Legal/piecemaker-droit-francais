import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { KnowledgeStore } from '../../../../plugins/piecemaker-dossier/src/knowledge.js';
import { persistScanResult } from '../../../../plugins/piecemaker-dossier/src/scan-result.js';
import { createKnowledgePipeline, defaultScanFiles } from '../pipeline.js';

function writeFile(root: string, relative: string, contents = 'x') {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

test('defaultScanFiles lists nested originals and ignores generated markdown', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-knowledge-scan-')));
  try {
    writeFile(root, 'contrat.pdf');
    writeFile(root, path.join('01_CORRESPONDANCE', '01_Client', 'lettre.docx'));
    writeFile(root, path.join('02_DATA_ROOM', 'kbis.pdf'));
    writeFile(root, 'brouillon.md');
    writeFile(root, path.join('Fichiers convertis PieceMaker', 'contrat.md'));
    const files = await defaultScanFiles(root);
    const relative = files.map((file) => path.relative(root, file).split(path.sep).join('/')).sort();
    assert.deepEqual(relative, [
      '01_CORRESPONDANCE/01_Client/lettre.docx',
      '02_DATA_ROOM/kbis.pdf',
      'contrat.pdf',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rename moves the piece, its markdown and its document node with its links', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-knowledge-rename-')));
  const termsFile = path.join(root, 'institutional-terms.json');
  fs.writeFileSync(termsFile, JSON.stringify({ version: 1, terms: ['Tribunal judiciaire'] }));
  const previousTerms = process.env.PIECEMAKER_INSTITUTIONAL_TERMS;
  process.env.PIECEMAKER_INSTITUTIONAL_TERMS = termsFile;
  const database = new Database(':memory:');
  database.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT NOT NULL UNIQUE)');
  database.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('project-1', root);
  const store = new KnowledgeStore(database);
  try {
    writeFile(root, path.join('Pièces', 'jugement.pdf'));
    writeFile(root, path.join('Fichiers convertis PieceMaker', 'jugement.md'), '# Jugement');
    const hash = (relative: string) => crypto.createHash('sha256').update(relative).digest('hex');
    const before = `document:${hash('Pièces/jugement.pdf')}`;
    store.update({
      projectId: 'project-1',
      operations: [
        { op: 'upsertNode', node: { id: before, kind: 'document', label: 'jugement.pdf', aliases: [], data: { path: path.join(root, 'Pièces', 'jugement.pdf'), nature: 'jugement' }, date: '2024-01-09' } },
        { op: 'upsertNode', node: { id: 'entity:SOCIETE_01', kind: 'company', label: 'SOCIETE_01', aliases: [], data: {} } },
        { op: 'link', link: { fromNodeId: before, toNodeId: 'entity:SOCIETE_01', relation: 'mentions', data: {} } },
        { op: 'cite', citation: { fromNodeId: before, toNodeId: 'entity:SOCIETE_01', relation: 'mentions', texte: 'Société Exemple SAS est condamnée.', pieceId: before } },
      ],
    });
    const projects = { getProjectById: (id: string) => (id === 'project-1' ? { project_id: id, project_path: root } : null) };
    const pipeline = createKnowledgePipeline({ applicationRoot: root, projects, store });

    const renamed = await pipeline.rename('project-1', 'Pièces/jugement.pdf', '2024-01-09_Jugement du Tribunal judiciaire de Paris');

    assert.equal(renamed.current, 'Pièces/2024-01-09_Jugement du Tribunal judiciaire de Paris.pdf');
    assert.equal(renamed.markdown, 'Fichiers convertis PieceMaker/2024-01-09_Jugement du Tribunal judiciaire de Paris.md');
    const graph = store.snapshot('project-1');
    const after = `document:${hash('Pièces/2024-01-09_Jugement du Tribunal judiciaire de Paris.pdf')}`;
    assert.equal(graph.nodes.some((node) => node.id === before), false);
    const document = graph.nodes.find((node) => node.id === after);
    assert.equal(document?.label, '2024-01-09_Jugement du Tribunal judiciaire de Paris.pdf');
    assert.equal(document?.data.path, path.join(root, 'Pièces', '2024-01-09_Jugement du Tribunal judiciaire de Paris.pdf'));
    assert.equal(document?.data.nature, 'jugement');
    assert.equal(document?.date, '2024-01-09');
    assert.deepEqual(graph.citations.map((citation) => [citation.fromNodeId, citation.toNodeId, citation.pieceId]), [[after, 'entity:SOCIETE_01', after]]);
    assert.deepEqual(graph.links.map((link) => [link.fromNodeId, link.toNodeId, link.relation]), [[after, 'entity:SOCIETE_01', 'mentions']]);

    const moved = await pipeline.rename('project-1', renamed.current, '', 'Procédure');
    assert.equal(moved.current, 'Procédure/2024-01-09_Jugement du Tribunal judiciaire de Paris.pdf');
    const movedNode = store.snapshot('project-1').nodes.find((entry) => entry.id === `document:${hash(moved.current)}`);
    assert.equal(movedNode?.data.path, path.join(root, 'Procédure', '2024-01-09_Jugement du Tribunal judiciaire de Paris.pdf'));
    assert.deepEqual(await pipeline.pieces('project-1'), [
      { path: moved.current, status: 'awaiting-scan', markdown: 'Fichiers convertis PieceMaker/2024-01-09_Jugement du Tribunal judiciaire de Paris.md' },
    ]);
  } finally {
    database.close();
    if (previousTerms === undefined) delete process.env.PIECEMAKER_INSTITUTIONAL_TERMS;
    else process.env.PIECEMAKER_INSTITUTIONAL_TERMS = previousTerms;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a scan after a rename leaves no ghost node, keeps the citations and adds nothing twice', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-knowledge-rescan-')));
  const termsFile = path.join(root, 'institutional-terms.json');
  fs.writeFileSync(termsFile, JSON.stringify({ version: 1, terms: [] }));
  const previousTerms = process.env.PIECEMAKER_INSTITUTIONAL_TERMS;
  process.env.PIECEMAKER_INSTITUTIONAL_TERMS = termsFile;
  const database = new Database(':memory:');
  database.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, project_path TEXT NOT NULL UNIQUE)');
  database.prepare('INSERT INTO projects (project_id, project_path) VALUES (?, ?)').run('project-1', root);
  const store = new KnowledgeStore(database);
  try {
    writeFile(root, path.join('Pièces', 'contrat.pdf'));
    writeFile(root, path.join('Fichiers convertis PieceMaker', 'contrat.md'), 'Jean Dupont signe le contrat avec Société Exemple SAS.');
    const hash = (relative: string) => crypto.createHash('sha256').update(relative).digest('hex');
    const scanOf = (relative: string) => ({
      projectId: 'project-1',
      mapping: { mapping: { 'Jean Dupont': 'PERSONNE_PHYSIQUE_01' } },
      documents: [{ id: hash(relative), name: path.basename(relative), path: path.join(root, relative), metadata: {}, entityCodes: ['PERSONNE_PHYSIQUE_01'] }],
    });
    const reader = () => 'Jean Dupont signe le contrat avec Société Exemple SAS.';
    persistScanResult(scanOf('Pièces/contrat.pdf'), store, reader);
    const projects = { getProjectById: (id: string) => (id === 'project-1' ? { project_id: id, project_path: root } : null) };
    const pipeline = createKnowledgePipeline({ applicationRoot: root, projects, store });

    const renamed = await pipeline.rename('project-1', 'Pièces/contrat.pdf', '2024-01-09_Contrat de vente');
    persistScanResult(scanOf(renamed.current), store, reader);

    const graph = store.snapshot('project-1');
    const after = `document:${hash(renamed.current)}`;
    assert.deepEqual(graph.nodes.filter((node) => node.kind === 'document').map((node) => node.id), [after]);
    assert.deepEqual(graph.links.map((link) => [link.fromNodeId, link.toNodeId]), [[after, 'entity:PERSONNE_PHYSIQUE_01']]);
    assert.deepEqual(graph.citations.map((citation) => [citation.pieceId, citation.texte]), [[after, 'Jean Dupont signe le contrat avec Société Exemple SAS.']]);
  } finally {
    database.close();
    if (previousTerms === undefined) delete process.env.PIECEMAKER_INSTITUTIONAL_TERMS;
    else process.env.PIECEMAKER_INSTITUTIONAL_TERMS = previousTerms;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
