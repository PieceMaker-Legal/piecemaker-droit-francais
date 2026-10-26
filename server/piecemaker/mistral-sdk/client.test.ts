import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

import Database from 'better-sqlite3';

import { createMistralClient } from './client.js';

const { startHudsuckerSession, hudsuckerBinary } = createRequire(import.meta.url)('../anonymizer/hudsucker-fixture.cjs');

test('SDK requests are anonymized through hudsucker, responses restored, and proxy loss fails closed', { skip: !fs.existsSync(hudsuckerBinary()) }, async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-proxy-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const databasePath = path.join(home, 'auth.db');
  const database = new Database(databasePath);
  database.exec('CREATE TABLE piecemaker_nodes(project_id TEXT,id TEXT,label TEXT,PRIMARY KEY(project_id,id)); CREATE TABLE piecemaker_mappings(project_id TEXT,node_id TEXT,real_value TEXT,masked_value TEXT,updated_at TEXT)');
  database.prepare('INSERT INTO piecemaker_nodes VALUES(?,?,?)').run('p', 'n', 'Jean Dupont');
  database.prepare('INSERT INTO piecemaker_mappings VALUES(?,?,?,?,?)').run('p', 'n', 'Jean Dupont', 'PERSONNE_PHYSIQUE_01', '2026-01-01');
  database.close();
  const received: string[] = [];
  const upstream = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk.toString(); });
    request.on('end', () => {
      received.push(body);
      if (JSON.parse(body).stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'mistral-small-latest', choices: [{ index: 0, delta: { role: 'assistant', content: 'PERSONNE_PHYSIQUE_01' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'test', object: 'chat.completion', created: 1, model: 'mistral-small-latest', choices: [{ index: 0, message: { role: 'assistant', content: 'PERSONNE_PHYSIQUE_01' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const session = await startHudsuckerSession({ databasePath, upstreamPort: (upstream.address() as { port: number }).port, directory: home });
  let stopped = false;
  t.after(async () => { if (!stopped) await session.close(); });
  const environment = { HTTPS_PROXY: process.env.HTTPS_PROXY, NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS };
  process.env.HTTPS_PROXY = session.origin;
  process.env.NODE_EXTRA_CA_CERTS = session.caFile;
  t.after(() => {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const connection = createMistralClient('fictitious-test-key');
  t.after(() => connection.close());
  const request = { model: 'mistral-small-latest', messages: [{ role: 'user' as const, content: 'Bonjour Jean Dupont' }] };
  const response = await connection.client.chat.complete(request);
  assert.ok(received[0].includes('PERSONNE_PHYSIQUE_01'));
  assert.ok(!received[0].includes('Jean Dupont'));
  assert.equal(response.choices?.[0]?.message?.content, 'Jean Dupont');
  const stream = await connection.client.chat.stream(request);
  let streamed = '';
  for await (const event of stream) streamed += event.data.choices[0]?.delta?.content || '';
  assert.equal(streamed, 'Jean Dupont');
  assert.ok(!received[1].includes('Jean Dupont'));
  await session.close();
  stopped = true;
  await assert.rejects(connection.client.chat.complete(request, { timeoutMs: 1500, retries: { strategy: 'none' } }));
  assert.equal(received.length, 2);
});
