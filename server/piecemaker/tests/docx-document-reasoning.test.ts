import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';
import JSZip from 'jszip';

import { closeConnection, initializeDatabase, projectsDb } from '@/modules/database/index.js';

import { createDocxDocumentRouter } from '../docx-document.js';
import { DOCX_REASONING_PART, embedDocxReasoning } from '../docx-reasoning.js';
import { modelHash } from '../docx-reasoning-reference.js';

import { bindings, clauses, code, fixture, mutate } from './docx-reasoning-fixture.js';

type ReasoningSummary = {
  status: string;
  changed?: string[];
  context?: Array<{ tag: string; text: string }>;
  objectives?: unknown;
  issues?: Array<{ kind: string; path: string; text: string }>;
  message?: string;
  sources?: string;
};

type DocumentResponse = {
  version?: number;
  reasoningVersion?: string | null;
  reasoning?: ReasoningSummary;
  error?: string;
};

async function withDocxServer(run: (baseUrl: string, projectId: string, projectRoot: string) => Promise<void>) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'docx-document-reasoning-'));
  const databasePath = path.join(temporaryDirectory, 'database.sqlite');
  const projectRoot = path.join(temporaryDirectory, 'project');
  await mkdir(projectRoot);
  closeConnection();
  process.env.DATABASE_PATH = databasePath;
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

function documentUrl(baseUrl: string, route: string, projectId: string, filePath: string) {
  const query = new URLSearchParams({ projectId, path: filePath });
  return `${baseUrl}/docx-document${route}?${query}`;
}

async function putDocument(baseUrl: string, projectId: string, filePath: string, bytes: Uint8Array) {
  const response = await fetch(documentUrl(baseUrl, '', projectId, filePath), {
    method: 'PUT',
    headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    body: bytes,
  });
  return { status: response.status, body: await response.json() as DocumentResponse };
}

async function getReasoning(baseUrl: string, projectId: string, filePath: string) {
  const response = await fetch(documentUrl(baseUrl, '/reasoning', projectId, filePath));
  return { status: response.status, body: await response.json() as DocumentResponse };
}

function containsCalculatedAmount(value: unknown, expected: number): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsCalculatedAmount(entry, expected));
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.montant_calcule === expected || Object.values(record).some((entry) => containsCalculatedAmount(entry, expected));
}

test('PUT saves the DOCX and returns the result calculated from edited values', async () => {
  await withDocxServer(async (baseUrl, projectId, projectRoot) => {
    const filePath = 'scenario.docx';
    const edited = await mutate(await fixture(), (xml) => xml.replace('>30<', '>60<'));
    const result = await putDocument(baseUrl, projectId, filePath, edited);

    assert.equal(result.status, 200);
    assert.equal(result.body.reasoning?.status, 'tested');
    assert.equal(result.body.reasoning?.sources, 'offline');
    assert.ok(typeof result.body.version === 'number');
    assert.ok(containsCalculatedAmount(result.body.reasoning?.objectives, 720));
    assert.deepEqual(await readFile(path.join(projectRoot, filePath)), Buffer.from(edited));
  });
});

test('PUT reports a changed clause for review while saving the new DOCX', async () => {
  await withDocxServer(async (baseUrl, projectId, projectRoot) => {
    const filePath = 'scenario.docx';
    const edited = await mutate(await fixture(), (xml) => xml.replace('payable après réception.', 'payable après validation.'));
    const result = await putDocument(baseUrl, projectId, filePath, edited);

    assert.equal(result.status, 200);
    assert.equal(result.body.reasoning?.status, 'review');
    assert.deepEqual(result.body.reasoning?.changed, ['pm:clause-prix']);
    assert.equal(result.body.reasoning?.context?.[0]?.tag, 'pm:clause-prix');
    assert.deepEqual(await readFile(path.join(projectRoot, filePath)), Buffer.from(edited));
  });
});

test('PUT preserves the saved DOCX and returns an offline error when checking fails', async () => {
  await withDocxServer(async (baseUrl, projectId, projectRoot) => {
    const filePath = 'scenario.docx';
    const invalidZip = Buffer.from('invalid fictitious DOCX payload');
    const result = await putDocument(baseUrl, projectId, filePath, invalidZip);

    assert.equal(result.status, 200);
    assert.equal(result.body.reasoning?.status, 'error');
    assert.equal(result.body.reasoning?.sources, 'offline');
    assert.ok(result.body.reasoning?.message);
    assert.deepEqual(await readFile(path.join(projectRoot, filePath)), invalidZip);
  });
});

test('PUT reports an ordinary DOCX as unlinked', async () => {
  await withDocxServer(async (baseUrl, projectId) => {
    const ordinary = await JSZip.loadAsync(await fixture());
    ordinary.remove(DOCX_REASONING_PART);
    const bytes = await ordinary.generateAsync({ type: 'uint8array' });
    const result = await putDocument(baseUrl, projectId, 'ordinary.docx', bytes);

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.reasoning, { status: 'unlinked' });
  });
});

test('GET returns the linked model result on open and detects an external clause edit', async () => {
  await withDocxServer(async (baseUrl, projectId, projectRoot) => {
    const filePath = 'scenario.docx';
    await writeFile(path.join(projectRoot, filePath), await fixture());
    const initial = await getReasoning(baseUrl, projectId, filePath);

    assert.equal(initial.status, 200);
    assert.equal(initial.body.reasoning?.status, 'tested');
    assert.equal(initial.body.reasoning?.sources, 'offline');

    const edited = await mutate(await readFile(path.join(projectRoot, filePath)), (xml) => xml.replace('payable après réception.', 'payable après validation.'));
    await writeFile(path.join(projectRoot, filePath), edited);
    const refreshed = await getReasoning(baseUrl, projectId, filePath);

    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.reasoning?.status, 'review');
    assert.deepEqual(refreshed.body.reasoning?.changed, ['pm:clause-prix']);
  });
});

test('GET rejects an unknown project or unsafe path and reports a missing file', async () => {
  await withDocxServer(async (baseUrl, projectId) => {
    const unknownProject = await getReasoning(baseUrl, 'project-absent', 'scenario.docx');
    const unsafePath = await getReasoning(baseUrl, projectId, '../outside.docx');
    const missingFile = await getReasoning(baseUrl, projectId, 'absent.docx');

    assert.equal(unknownProject.status, 400);
    assert.equal(unsafePath.status, 400);
    assert.equal(missingFile.status, 404);
  });
});


test('GET tracks the external model independently and PUT preserves a document with an unavailable model', async () => {
  await withDocxServer(async (baseUrl, projectId, projectRoot) => {
    await mkdir(path.join(projectRoot, '.piecemaker'));
    const modelPath = path.join(projectRoot, '.piecemaker', 'raisonnement.js');
    await writeFile(modelPath, code);
    const bytes = await embedDocxReasoning(await fixture(), {
      code, bindings, clauses, reference: { path: '.piecemaker/raisonnement.js', sha256: modelHash(code) },
    });
    const filePath = 'scenario-externe.docx';
    await writeFile(path.join(projectRoot, filePath), bytes);
    const first = await getReasoning(baseUrl, projectId, filePath);
    assert.equal(first.body.reasoning?.status, 'tested');
    assert.equal(first.body.reasoningVersion, modelHash(code));
    const originalVersion = first.body.version;
    const versionUrl = documentUrl(baseUrl, '/version', projectId, filePath);
    await writeFile(modelPath, `${code}\n`);
    const changed = await (await fetch(versionUrl)).json() as DocumentResponse;
    assert.equal(changed.version, originalVersion);
    assert.equal(changed.reasoningVersion, modelHash(`${code}\n`));
    const mismatch = await getReasoning(baseUrl, projectId, filePath);
    assert.equal(mismatch.body.reasoning?.status, 'error');
    assert.match(mismatch.body.reasoning?.message ?? '', /modifié/u);
    await rm(modelPath);
    const missing = await (await fetch(versionUrl)).json() as DocumentResponse;
    assert.equal(missing.version, originalVersion);
    assert.notEqual(missing.reasoningVersion, changed.reasoningVersion);
    const saved = await putDocument(baseUrl, projectId, filePath, bytes);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.reasoning?.status, 'error');
    assert.match(saved.body.reasoning?.message ?? '', /absent/u);
    assert.deepEqual(await readFile(path.join(projectRoot, filePath)), Buffer.from(bytes));
    await writeFile(modelPath, code);
    const restored = await getReasoning(baseUrl, projectId, filePath);
    assert.equal(restored.body.reasoning?.status, 'tested');
    assert.equal(restored.body.reasoningVersion, modelHash(code));
  });
});
