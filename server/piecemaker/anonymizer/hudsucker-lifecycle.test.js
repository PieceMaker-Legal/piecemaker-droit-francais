import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import Database from 'better-sqlite3';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyAgent, fetch } from 'undici';
import WebSocket, { WebSocketServer } from 'ws';

const require = createRequire(import.meta.url);
const { startHudsuckerSession } = require('./hudsucker-fixture.cjs');
const { removeLegacyProxyConfig } = require('./client-config.cjs');

const CODE = 'PERSONNE_PHYSIQUE_01';
const NAME = 'Jean Dupont';

function mappingDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-life-'));
  const file = path.join(directory, 'auth.db');
  const database = new Database(file);
  database.exec(`
    CREATE TABLE piecemaker_nodes (project_id TEXT, id TEXT, label TEXT, PRIMARY KEY (project_id,id));
    CREATE TABLE piecemaker_mappings (project_id TEXT,node_id TEXT,real_value TEXT,masked_value TEXT,updated_at TEXT);
  `);
  database.prepare('INSERT INTO piecemaker_nodes VALUES(?,?,?)').run('p', 'n0', NAME);
  database.prepare('INSERT INTO piecemaker_mappings VALUES(?,?,?,?,?)').run('p', 'n0', NAME, CODE, '2026-01-01T00:00:00.000Z');
  database.close();
  return file;
}

function startUpstream() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  const sockets = new WebSocketServer({ server });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ seen, server, sockets, port: server.address().port }));
  });
}

async function withSession(run) {
  const upstream = await startUpstream();
  const session = await startHudsuckerSession({ databasePath: mappingDatabase(), upstreamPort: upstream.port });
  try {
    return await run({ session, upstream });
  } finally {
    await session.close().catch(() => {});
    upstream.sockets.close();
    await new Promise((resolve) => upstream.server.close(resolve));
  }
}

function send(session, { body, headers }) {
  const dispatcher = new ProxyAgent({ uri: session.origin, requestTls: { ca: fs.readFileSync(session.caFile) } });
  return fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body, dispatcher });
}

async function health(origin) {
  const response = await fetch(`${origin}/health`);
  return response.status;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

test('hudsucker meurt quand son parent est tué net', async () => {
  const parent = spawn(process.execPath, ['-e', `
    const { startHudsuckerSession } = require(${JSON.stringify(require.resolve('./hudsucker-fixture.cjs'))});
    startHudsuckerSession({ databasePath: ${JSON.stringify(mappingDatabase())}, upstreamPort: 9 })
      .then((session) => console.log('pid ' + session.child.pid));
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  const pid = await new Promise((resolve) => {
    parent.stdout.on('data', (chunk) => {
      const match = String(chunk).match(/pid (\d+)/);
      if (match) resolve(Number(match[1]));
    });
  });
  assert.ok(processAlive(pid));
  parent.kill('SIGKILL');
  assert.ok(await waitUntil(() => !processAlive(pid), 2000), 'hudsucker a survécu à son parent');
});

test('deux proxys coexistent sur des ports distincts', async () => {
  await withSession(async ({ session: first }) => {
    await withSession(async ({ session: second }) => {
      assert.notEqual(first.origin, second.origin);
      assert.equal(await health(first.origin), 200);
      assert.equal(await health(second.origin), 200);
    });
  });
});

test('réécrivain arrêté : santé en échec, requête refusée et journalisée', async () => {
  await withSession(async ({ session, upstream }) => {
    await session.bridge.close();
    assert.equal(await health(session.origin), 503);
    const response = await send(session, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: NAME }] }),
    });
    assert.equal(response.status, 502);
    assert.equal(upstream.seen.length, 0);
    assert.ok(await waitUntil(() => session.logs().includes('refus 502'), 1000), session.logs());
  });
});

test('un corps compressé est décompressé puis anonymisé', async () => {
  await withSession(async ({ session, upstream }) => {
    const response = await send(session, {
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: zlib.gzipSync(JSON.stringify({ messages: [{ role: 'user', content: `Contrat de ${NAME}` }] })),
    });
    assert.equal(response.status, 200);
    assert.equal(upstream.seen.length, 1);
    assert.ok(upstream.seen[0].body.includes(CODE));
    assert.ok(!upstream.seen[0].body.includes(NAME));
  });
});

test('un corps non JSON vers un hôte intercepté est refusé', async () => {
  await withSession(async ({ session, upstream }) => {
    const response = await send(session, { headers: { 'content-type': 'text/plain' }, body: `Contrat de ${NAME}` });
    assert.equal(response.status, 415);
    assert.equal(upstream.seen.length, 0);
  });
});

test('un WebSocket dont la réécriture échoue est fermé, pas bloqué', async () => {
  await withSession(async ({ session, upstream }) => {
    const received = [];
    upstream.sockets.on('connection', (socket) => socket.on('message', (data) => received.push(String(data))));
    const socket = new WebSocket('wss://chatgpt.com/backend-api/codex/responses', {
      agent: new HttpsProxyAgent(session.origin),
      ca: fs.readFileSync(session.caFile),
    });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send(JSON.stringify({ input: `Contrat de ${NAME}` }));
    assert.ok(await waitUntil(() => received.length === 1, 2000), JSON.stringify({ received, logs: session.logs() }));
    assert.ok(received[0].includes(CODE) && !received[0].includes(NAME), received[0]);

    await session.bridge.close();
    const closed = new Promise((resolve) => socket.once('close', resolve));
    socket.send(JSON.stringify({ input: NAME }));
    await closed;
    assert.equal(received.length, 1);
  });
});

test('les anciennes traces du proxy sont retirées, rien d’autre n’est touché', () => {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-legacy-'));
  const homeDir = path.join(userHome, '.piecemaker');
  const claudeSettings = path.join(userHome, '.claude', 'settings.json');
  const codexHooks = path.join(userHome, '.codex', 'hooks.json');
  const personalHook = { type: 'command', command: 'echo perso' };
  fs.mkdirSync(path.dirname(claudeSettings), { recursive: true });
  fs.mkdirSync(path.dirname(codexHooks), { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.writeFileSync(claudeSettings, JSON.stringify({
    model: 'opus',
    env: { HTTPS_PROXY: 'http://127.0.0.1:4111', NODE_EXTRA_CA_CERTS: '/ca.crt', MY_VAR: '1' },
    hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'node "/x/proxy-guard.mjs"' }, personalHook] }] },
  }));
  fs.writeFileSync(codexHooks, JSON.stringify({
    hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'PIECEMAKER_HOOK_CLIENT=codex node "/x/proxy-guard.mjs"' }] }] },
  }));
  fs.writeFileSync(path.join(homeDir, 'config.json'), JSON.stringify({ mikePiiPort: 4111, caseFolders: ['a'], venvPath: '/v' }));
  fs.writeFileSync(path.join(homeDir, 'proxy-statusline.json'), '{}');

  assert.deepEqual(removeLegacyProxyConfig({ userHome, homeDir }), ['claude', 'codex', 'piecemaker']);
  assert.deepEqual(JSON.parse(fs.readFileSync(claudeSettings, 'utf8')), {
    model: 'opus',
    env: { MY_VAR: '1' },
    hooks: { SessionStart: [{ matcher: 'startup', hooks: [personalHook] }] },
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(codexHooks, 'utf8')), { hooks: {} });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(homeDir, 'config.json'), 'utf8')), { venvPath: '/v' });
  assert.equal(fs.existsSync(path.join(homeDir, 'proxy-statusline.json')), false);
  assert.deepEqual(removeLegacyProxyConfig({ userHome, homeDir }), []);
});
