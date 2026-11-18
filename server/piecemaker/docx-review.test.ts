import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

import { DocxDocumentConflictError, readDocxReview, readDocxSnapshot, runDocxReview } from '@/modules/piecemaker-docx/index.js';
import { createDocxReviewRouter } from '@/piecemaker/docx-review.js';

async function fixture(context: { after(fn: () => Promise<unknown>): void }) {
  const project = await mkdtemp(path.join(os.tmpdir(), 'mike-docx-'));
  context.after(() => rm(project, { recursive: true, force: true }));
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Paiement sous 90 jours. Plafond de 100 euros.</w:t></w:r></w:p></w:body></w:document>');
  zip.file('word/header1.xml', '<w:hdr>Exemple</w:hdr>');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  await writeFile(path.join(project, 'contrat.docx'), bytes);
  return { project, bytes };
}

test('Mike conserve la source, propose deux substitutions et accepte ou refuse leurs vraies révisions Word', async (context) => {
  const { project, bytes } = await fixture(context);
  const first = await runDocxReview(project, 'contrat.docx', { action: 'edit', author: 'Codex', edits: [
    { find: '90', replace: '30', context_before: 'sous ', context_after: ' jours', reason: 'Réduire le délai.' },
    { find: '100', replace: '500', context_before: 'de ', context_after: ' euros' },
  ] });
  assert.equal(first.versions.length, 2);
  assert.deepEqual(await readDocxSnapshot(project, 'contrat.docx', first.versions[0].id), bytes);
  const proposed = await JSZip.loadAsync(await readFile(path.join(project, 'contrat.docx')));
  const xml = await proposed.file('word/document.xml')!.async('string');
  assert.match(xml, /<w:ins\b/); assert.match(xml, /<w:del\b/); assert.match(xml, /w:author="Codex"/);
  assert.equal(proposed.file('word/comments.xml'), null);
  assert.equal(await proposed.file('word/header1.xml')!.async('string'), '<w:hdr>Exemple</w:hdr>');
  assert.equal(first.annotations[0].reason, 'Réduire le délai.');
  assert.equal(first.annotations[1].reason, undefined);
  await runDocxReview(project, 'contrat.docx', { action: 'accept', edit_id: first.annotations[0].edit_id });
  const final = await runDocxReview(project, 'contrat.docx', { action: 'reject', edit_id: first.annotations[1].edit_id });
  assert.deepEqual(final.annotations.map((edit) => edit.status), ['accepted', 'rejected']);
  const finalZip = await JSZip.loadAsync(await readFile(path.join(project, 'contrat.docx')));
  const finalXml = await finalZip.file('word/document.xml')!.async('string');
  const parsed = new DOMParser().parseFromString(finalXml, 'text/xml');
  assert.equal(Array.from(parsed.getElementsByTagName('w:t')).map((node) => node.textContent).join(''), 'Paiement sous 30 jours. Plafond de 100 euros.');
  assert.doesNotMatch(finalXml, /<w:(ins|del)\b/);
  assert.equal(final.versions.length, 2);
  assert.equal((await readDocxReview(project, 'contrat.docx')).annotations[0].reason, 'Réduire le délai.');
});

test('un ancrage ambigu ou une empreinte périmée laisse le DOCX inchangé', async (context) => {
  const { project, bytes } = await fixture(context);
  await assert.rejects(runDocxReview(project, 'contrat.docx', { action: 'edit', edits: [
    { find: 'e', replace: 'a', context_before: '', context_after: '' },
  ] }), /Ambiguous/);
  await assert.rejects(runDocxReview(project, 'contrat.docx', { action: 'edit', expected_sha256: '0'.repeat(64), edits: [
    { find: '90', replace: '30', context_before: '', context_after: '' },
  ] }), DocxDocumentConflictError);
  assert.deepEqual(await readFile(path.join(project, 'contrat.docx')), bytes);
  assert.deepEqual((await readDocxReview(project, 'contrat.docx')).versions, []);
});

test('les cartes éditent le document par HTTP et les versions restent bornées au dossier autorisé', async (context) => {
  const { project, bytes } = await fixture(context);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'mike-docx-outside-'));
  context.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'externe.docx'), bytes);
  const projects = { getProjectPathById: (id: string) => id === 'exemple' ? project : null };
  const app = express();
  app.use('/api/piecemaker', createDocxReviewRouter(projects));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (filename: string, body: object, projectId = 'exemple') => fetch(`${origin}/api/piecemaker/docx-review?${new URLSearchParams({ projectId, path: filename })}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const response = await post('contrat.docx', { action: 'edit', edits: [
    { find: '90', replace: '30', context_before: 'sous ', context_after: ' jours' },
  ] });
  assert.equal(response.status, 200);
  const review = await response.json() as Awaited<ReturnType<typeof readDocxReview>>;
  assert.equal(review.annotations.length, 1);
  assert.equal((await post('contrat.docx', { action: 'read' }, 'inconnu')).status, 404);
  assert.equal((await post(path.join(outside, 'externe.docx'), { action: 'read' })).status, 403);
  const query = new URLSearchParams({ projectId: 'exemple', path: 'contrat.docx', id: review.versions[0].id });
  assert.deepEqual(Buffer.from(await (await fetch(`${origin}/api/piecemaker/docx-review/snapshot?${query}`)).arrayBuffer()), bytes);
  query.set('id', '../../externe');
  assert.equal((await fetch(`${origin}/api/piecemaker/docx-review/snapshot?${query}`)).status, 404);
});
