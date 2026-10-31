import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';
import JSZip from 'jszip';

import { closeConnection, initializeDatabase, projectsDb } from '@/modules/database/index.js';

import { createDocxDocumentRouter } from '../docx-document.js';

async function withDocxServer(run: (baseUrl: string, projectId: string, projectRoot: string) => Promise<void>) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'docx-document-'));
  const projectRoot = path.join(temporaryDirectory, 'project');
  await mkdir(projectRoot);
  closeConnection();
  process.env.DATABASE_PATH = path.join(temporaryDirectory, 'database.sqlite');
  await initializeDatabase();
  const project = projectsDb.createProjectPath(projectRoot).project;
  assert.ok(project);

  const app = express();
  app.use('/api', createDocxDocumentRouter());
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Local server address unavailable.');
    await run(`http://127.0.0.1:${address.port}/api`, project.project_id, projectRoot);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const documentUrl = (baseUrl: string, route: string, projectId: string, filePath: string) =>
  `${baseUrl}/docx-document${route}?${new URLSearchParams({ projectId, path: filePath })}`;

const docxBytes = () => new JSZip().file('word/document.xml', '<w:document/>').generateAsync({ type: 'uint8array' });

test('PUT saves the DOCX and GET version returns the saved version', async () => {
  await withDocxServer(async (baseUrl, projectId, projectRoot) => {
    const bytes = await docxBytes();
    const saved = await fetch(documentUrl(baseUrl, '', projectId, 'acte.docx'), { method: 'PUT', body: bytes });
    const body = await saved.json() as { version: number };

    assert.equal(saved.status, 200);
    assert.deepEqual(await readFile(path.join(projectRoot, 'acte.docx')), Buffer.from(bytes));
    const version = await fetch(documentUrl(baseUrl, '/version', projectId, 'acte.docx'));
    assert.deepEqual(await version.json(), { version: body.version });
  });
});

test('PUT refuses a stale version with a conflict', async () => {
  await withDocxServer(async (baseUrl, projectId) => {
    const url = documentUrl(baseUrl, '', projectId, 'acte.docx');
    await fetch(url, { method: 'PUT', body: await docxBytes() });
    const stale = await fetch(url, { method: 'PUT', headers: { 'If-Match': '1' }, body: await docxBytes() });
    assert.equal(stale.status, 409);
  });
});

test('GET version rejects an unknown project or unsafe path and reports a missing file', async () => {
  await withDocxServer(async (baseUrl, projectId) => {
    assert.equal((await fetch(documentUrl(baseUrl, '/version', 'project-absent', 'acte.docx'))).status, 400);
    assert.equal((await fetch(documentUrl(baseUrl, '/version', projectId, '../outside.docx'))).status, 400);
    assert.equal((await fetch(documentUrl(baseUrl, '/version', projectId, 'absent.docx'))).status, 404);
  });
});
