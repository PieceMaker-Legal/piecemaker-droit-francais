import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { createArtifactFrameRouter, createArtifactsRouter, frameCsp, injectRuntime } from './artifacts.js';
import { openArtifacts } from './vendor/mcp/artifacts/artifacts.mjs';

test('le runtime passe en tête de page, avant tout script', () => {
  assert.equal(injectRuntime('<!doctype html><html><head><script>1</script></head></html>'), '<!doctype html><html><head>\n<script src="__piecemaker/runtime.js"></script><script>1</script></head></html>');
  assert.match(injectRuntime('<!doctype html><p>x</p>'), /^<!doctype html>\n<script src="__piecemaker\/runtime\.js"><\/script>/);
  const csp = frameCsp('http://127.0.0.1:1');
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /img-src http:\/\/127\.0\.0\.1:1 data: blob:/);
  assert.match(csp, /https:\/\/cdnjs\.cloudflare\.com/);
});

test('la page s’affiche par un jeton, sa base n’est ouverte qu’avec la capability db', async (context) => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'artifacts-routes-'));
  context.after(() => rm(project, { recursive: true, force: true }));
  await writeFile(path.join(project, 'page.html'), '<!doctype html><html><head><title>Suivi</title></head><body>v1</body></html>');
  await writeFile(path.join(project, 'style.css'), 'body{}');
  const artifacts = openArtifacts(project);
  const page = (await import('node:fs')).readFileSync(path.join(project, 'page.html'), 'utf8');
  const plain = artifacts.publish({ page, files: { 'style.css': 'style.css' } });
  const withDb = artifacts.publish({ page, capabilities: { db: {} } });

  const app = express();
  app.use('/api/piecemaker/local', createArtifactFrameRouter());
  app.use('/api/piecemaker', createArtifactsRouter({ getProjectPathById: () => null, getProjectPaths: () => [{ project_path: project }] }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const query = `projectPath=${encodeURIComponent(project)}`;
  const post = (route: string, body: object = {}) => fetch(`${origin}/api/piecemaker/${route}?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const list = await (await fetch(`${origin}/api/piecemaker/artifacts?${query}`)).json() as Array<{ id: string }>;
  assert.equal(list.length, 2);
  assert.equal((await fetch(`${origin}/api/piecemaker/artifacts?projectPath=%2Fautre`)).status, 404);

  const { src } = await (await post(`artifacts/${plain.id}/frame`)).json() as { src: string };
  const html = await fetch(`${origin}${src}`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy') ?? '', /connect-src 'none'/);
  assert.match(await html.text(), /__piecemaker\/runtime\.js/);
  assert.equal((await fetch(`${origin}${src.replace('index.html', 'style.css')}`)).status, 200);
  assert.match(await (await fetch(`${origin}${src.replace('index.html', '__piecemaker/runtime.js')}`)).text(), /window\.artifact/);
  assert.equal((await fetch(`${origin}${src.replace('index.html', 'absent.js')}`)).status, 404);
  assert.equal((await fetch(`${origin}/api/piecemaker/local/artifact-frame/${'0'.repeat(48)}/index.html`)).status, 404);

  assert.equal((await post(`artifacts/${plain.id}/data`, { op: 'list', args: { collection: 'items' } })).status, 403);
  const set = await post(`artifacts/${withDb.id}/data`, { op: 'set', args: { collection: 'items', doc_id: 'a', data: { done: false } } });
  assert.equal(set.status, 200);
  const conflict = await post(`artifacts/${withDb.id}/data`, { op: 'update', args: { collection: 'items', doc_id: 'a', data: { done: true } } });
  assert.equal(conflict.status, 409);
  const detail = await (await fetch(`${origin}/api/piecemaker/artifacts/${withDb.id}?${query}`)).json() as { data_stamp: number };
  assert.ok(detail.data_stamp > 0);

  assert.equal((await post(`artifacts/${plain.id}/comments`, { text: 'Ajouter la date', anchor: { version: 1 } })).status, 201);
  const threads = await (await fetch(`${origin}/api/piecemaker/artifacts/${plain.id}/comments?${query}`)).json() as Array<{ messages: Array<{ author: string }> }>;
  assert.equal(threads[0].messages[0].author, 'lawyer');
});
