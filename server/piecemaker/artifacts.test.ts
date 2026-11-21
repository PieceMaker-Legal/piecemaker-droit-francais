import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import type { NormalizedMessage } from '@/shared/types.js';

import { createArtifactFrameRouter, createArtifactsRouter, frameCsp, injectRuntime } from './artifacts.js';
import { openArtifacts } from './vendor/mcp/artifacts/artifacts.mjs';

/** Appelle une appli express sans port : un IncomingMessage/ ServerResponse sur un socket factice. */
function serve(app: express.Express) {
  return (url: string, body?: object) => new Promise<Response>((resolve, reject) => {
    const socket = new Socket();
    const incoming = new IncomingMessage(socket);
    incoming.url = url;
    incoming.method = body ? 'POST' : 'GET';
    incoming.headers.host = '127.0.0.1';
    if (body) {
      const json = Buffer.from(JSON.stringify(body));
      incoming.headers['content-type'] = 'application/json';
      incoming.headers['content-length'] = String(json.length);
      incoming.push(json);
    }
    incoming.push(null);

    const outgoing = new ServerResponse(incoming);
    incoming.on('error', reject);
    outgoing.end = (chunk?: unknown) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(outgoing.getHeaders())) headers.set(name, String(value));
      resolve(new Response(chunk === undefined ? null : String(chunk), { status: outgoing.statusCode, headers }));
      return outgoing;
    };
    app(incoming, outgoing);
  });
}

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
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01T12:00:00Z') });
  const plain = artifacts.publish({ page, files: { 'style.css': 'style.css' } });
  context.mock.timers.tick(1000);
  const withDb = artifacts.publish({ page, capabilities: { db: {} } });

  context.mock.timers.tick(1000);
  const foreign = artifacts.publish({ page, title: 'Hors session' });
  const customView = artifacts.publish({ page: page.replace('>v1<', '>Vue réservée<'), customView: true, pin: true });
  context.mock.timers.tick(1000);
  artifacts.publish({ url: plain.url, page });
  const toolName = 'mcp__artifacts__Artifact';
  const row = { sessionId: 'fil-a', timestamp: plain.created_at };
  const receipt = (item: typeof plain) => `Artifact ${item.url} — ${item.title}\nversion 1 of 1 · updated ${item.created_at}`;
  const messages: NormalizedMessage[] = [
    { ...row, id: 'c1', provider: 'claude', kind: 'tool_use', toolName, toolId: 'c1', toolInput: { file_path: 'page.html' } },
    { ...row, id: 'r1', provider: 'claude', kind: 'tool_result', toolId: 'c1', content: JSON.stringify([{ type: 'text', text: receipt(plain) }]) },
    { ...row, id: 'c2', provider: 'codex', kind: 'tool_use', toolName, toolId: 'c2', toolInput: JSON.stringify({ file_path: 'page.html' }) },
    { ...row, id: 'r2', provider: 'codex', kind: 'tool_result', toolId: 'c2', content: JSON.stringify({ content: [{ type: 'text', text: receipt(withDb) }] }) },
    { ...row, id: 'c3', provider: 'mistral', kind: 'tool_use', toolName, toolId: 'c3', toolInput: { action: 'read', url: foreign.url }, toolResult: { content: receipt(foreign) } },
    { ...row, id: 'c5', provider: 'codex', kind: 'tool_use', toolName, toolId: 'c5', toolInput: { file_path: 'page.html' }, toolResult: { content: receipt(customView) } },
  ];
  const app = express();
  app.use('/api/piecemaker/local', createArtifactFrameRouter());
  app.use('/api/piecemaker', createArtifactsRouter({ getProjectPathById: () => null, getProjectPaths: () => [{ project_path: project }] }, {
    getSessionById: (id) => ({ project_path: id === 'autre-dossier' ? '/autre' : project, created_at: plain.created_at, forked_from_session_id: null }),
    listProjectSessions: () => [
      { session_id: 'fil-a', created_at: plain.created_at, updated_at: plain.created_at, forked_from_session_id: null },
      { session_id: 'fil-b', created_at: foreign.created_at, updated_at: foreign.created_at, forked_from_session_id: null },
      { session_id: 'bifurcation', created_at: foreign.created_at, updated_at: foreign.created_at, forked_from_session_id: 'fil-a' },
    ],
    fetchHistory: async (id) => ({ messages: (id === 'fil-a' || id === 'bifurcation') ? messages : id === 'fil-b' ? [{
      ...row, sessionId: id, id: 'c4', provider: 'mistral', kind: 'tool_use', toolName, toolId: 'c4',
      toolInput: { type_url: 'piecemaker://template/page' }, toolResult: { content: receipt(foreign) },
    }] : [] }),
  }));
  const request = serve(app);
  const query = `projectPath=${encodeURIComponent(project)}`;
  const post = (route: string, body: object = {}) => request(`/api/piecemaker/${route}?${query}`, body);

  const list = await (await request(`/api/piecemaker/artifacts?${query}`)).json() as Array<{ id: string }>;
  assert.deepEqual(list.map(({ id }) => id).sort(), [plain.id, withDb.id, foreign.id].sort());
  assert.deepEqual(await (await request(`/api/piecemaker/artifacts?${query}&scope=pinned`)).json(), []);
  const sessionItems = async (id: string) => request(`/api/piecemaker/artifacts/session/${id}?${query}`);
  const created = await (await sessionItems('fil-a')).json() as Array<{ id: string }>;
  assert.deepEqual(created.map(({ id }) => id), [withDb.id, plain.id]);
  const secondSession = await (await sessionItems('fil-b')).json() as Array<{ id: string }>;
  assert.deepEqual(secondSession.map(({ id }) => id), [foreign.id]);
  assert.deepEqual(await (await sessionItems('fil-vide')).json(), []);
  assert.equal((await sessionItems('autre-dossier')).status, 404);
  assert.equal((await request(`/api/piecemaker/artifacts?projectPath=%2Fautre`)).status, 404);

  const creator = async (id: string) => (await request(`/api/piecemaker/artifacts/${id}/creator?${query}`)).json();
  assert.deepEqual(await creator(plain.id), { sessionId: 'fil-a' });
  assert.deepEqual(await creator(foreign.id), { sessionId: 'fil-b' });

  const { src } = await (await post(`artifacts/${plain.id}/frame`)).json() as { src: string };
  const { src: customSrc } = await (await post(`artifacts/${customView.id}/frame`)).json() as { src: string };
  assert.match(await (await request(customSrc)).text(), />Vue réservée</);
  const html = await request(src);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy') ?? '', /connect-src 'none'/);
  assert.match(await html.text(), /__piecemaker\/runtime\.js/);
  assert.equal((await request(src.replace('index.html', 'style.css'))).status, 200);
  assert.match(await (await request(src.replace('index.html', '__piecemaker/runtime.js'))).text(), /window\.artifact/);
  assert.equal((await request(src.replace('index.html', 'absent.js'))).status, 404);
  assert.equal((await request(`/api/piecemaker/local/artifact-frame/${'0'.repeat(48)}/index.html`)).status, 404);

  assert.equal((await post(`artifacts/${plain.id}/data`, { op: 'list', args: { collection: 'items' } })).status, 403);
  const set = await post(`artifacts/${withDb.id}/data`, { op: 'set', args: { collection: 'items', doc_id: 'a', data: { done: false } } });
  assert.equal(set.status, 200);
  const conflict = await post(`artifacts/${withDb.id}/data`, { op: 'update', args: { collection: 'items', doc_id: 'a', data: { done: true } } });
  assert.equal(conflict.status, 409);
  const detail = await (await request(`/api/piecemaker/artifacts/${withDb.id}?${query}`)).json() as { data_stamp: number };
  assert.ok(detail.data_stamp > 0);

  const sourceRoute = `artifacts/${plain.id}/source`;
  const { path: source } = await (await post(sourceRoute, { version: 2, update: false })).json() as { path: string };
  await writeFile(path.join(project, source), page.replace('>v1<', '>v2<'));
  assert.equal((await post(sourceRoute, { version: 2, update: true })).status, 200);
  assert.equal((await post(sourceRoute, { version: 2, update: true })).status, 409);
  const { src: latest } = await (await post(`artifacts/${plain.id}/frame`)).json() as { src: string };
  assert.match(await (await request(latest)).text(), />v2</);
  assert.match(await (await request(src)).text(), />v1</);

  const wordFile = 'note-fictive.docx';
  await writeFile(path.join(project, wordFile), Buffer.from('PK\x03\x04'));
  const word = artifacts.publishDocument({ filePath: wordFile, title: undefined, description: undefined, icon: undefined, pin: undefined });
  const wordDetail = await (await request(`/api/piecemaker/artifacts/${word.id}?${query}`)).json() as { document_path: string };
  assert.equal(wordDetail.document_path, wordFile);
  assert.deepEqual(await creator(word.id), { sessionId: null });
  assert.equal((await post(`artifacts/${word.id}/frame`)).status, 400);

  const commentRoute = `artifacts/${plain.id}/comments`;
  const reviewRoute = `artifacts/${plain.id}/reviews`;
  const passage = { quote: 'v1', start: 0, before: '', after: '' };
  assert.equal((await post(commentRoute, { text: 'Ajouter la date', anchor: { version: 1, passage } })).status, 201);
  assert.equal((await post(commentRoute, { text: 'Erreur de version', anchor: { version: 99 } })).status, 404);
  assert.equal((await post(reviewRoute, { version: 1, decision: 'changes_requested' })).status, 400);
  assert.equal((await post(reviewRoute, { version: 99, decision: 'approved' })).status, 404);
  assert.equal((await post(reviewRoute, { version: 1, decision: 'approved' })).status, 201);
  const threads = await (await request(`/api/piecemaker/${commentRoute}?${query}`)).json() as {
    anchor: unknown;
    messages: { author: string }[];
  }[];
  assert.deepEqual(threads[0].anchor, { version: 1, passage });
  assert.deepEqual(threads[1].anchor, { kind: 'review', decision: 'approved', version: 1 });
  assert.equal(threads[0].messages[0].author, 'lawyer');
});

test('routes des templates : liste, statut GitHub et synchronisation (jamais de push)', async (context) => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'artifacts-templates-routes-'));
  context.after(() => rm(project, { recursive: true, force: true }));
  const synced: unknown[] = [];
  const status = { repository: 'https://github.com/exemple/biblio.git', branch: 'main', last_sync: '2026-11-20T10:00:00.000Z', clone: '/tmp/biblio', cloned: true, head: 'abc1234 2026-11-20 biblio', local_changes: [' M suivi/index.html'], templates: ['suivi (repository)'] };
  const fake = {
    list: () => [{ type_url: 'piecemaker://template/suivi', name: 'suivi', title: 'Suivi', description: 'Tableau de suivi', intent: 'other', icon: null, capabilities: {}, read_first: [], entry: 'index.html', data_files: [], references: [], scripts: [], source: 'repository', folder: '/tmp/biblio/suivi' }],
    status: async () => status,
    sync: async (options?: unknown) => { synced.push(options ?? {}); return status; },
  };
  const app = express();
  app.use('/api/piecemaker', createArtifactsRouter(
    { getProjectPathById: () => null, getProjectPaths: () => [{ project_path: project }] },
    { getSessionById: () => null, listProjectSessions: () => [], fetchHistory: async () => ({ messages: [] }) },
    fake as unknown as Parameters<typeof createArtifactsRouter>[2],
  ));
  const request = serve(app);

  const list = await (await request('/api/piecemaker/artifact-templates')).json() as Array<Record<string, unknown>>;
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { type_url: 'piecemaker://template/suivi', name: 'suivi', title: 'Suivi', description: 'Tableau de suivi', intent: 'other', icon: null, source: 'repository' });

  const gitStatus = await (await request('/api/piecemaker/artifact-templates/status')).json() as typeof status;
  assert.equal(gitStatus.repository, 'https://github.com/exemple/biblio.git');
  assert.equal(gitStatus.cloned, true);
  assert.deepEqual(gitStatus.local_changes, [' M suivi/index.html']);

  const sync = await request('/api/piecemaker/artifact-templates/sync', {});
  assert.equal(sync.status, 200);
  assert.deepEqual(synced, [{}]);
  const withRepo = await request('/api/piecemaker/artifact-templates/sync', { repository: 'https://github.com/exemple/autre.git', branch: 'dev' });
  assert.equal(withRepo.status, 200);
  assert.deepEqual(synced[1], { repository: 'https://github.com/exemple/autre.git', branch: 'dev' });
});
