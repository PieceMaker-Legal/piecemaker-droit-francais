import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import express from 'express';
import { WebSocket } from 'ws';

test('native reset preserves the account, revokes REST, refresh and live WebSockets, and persists the new password', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pm-auth-'));
  const previous = { DATABASE_PATH: process.env.DATABASE_PATH, CLOUDCLI_HOME: process.env.CLOUDCLI_HOME, JWT_SECRET: process.env.JWT_SECRET, VITE_IS_PLATFORM: process.env.VITE_IS_PLATFORM, PIECEMAKER_DESKTOP_AUTH_SECRET: process.env.PIECEMAKER_DESKTOP_AUTH_SECRET, PIECEMAKER_DESKTOP_AUTH_ROOT: process.env.PIECEMAKER_DESKTOP_AUTH_ROOT };
  const capability = 'fictitious-desktop-capability';
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  process.env.CLOUDCLI_HOME = directory;
  delete process.env.JWT_SECRET;
  delete process.env.VITE_IS_PLATFORM;
  await writeFile(process.env.DATABASE_PATH, '');
  process.env.PIECEMAKER_DESKTOP_AUTH_SECRET = capability;
  process.env.PIECEMAKER_DESKTOP_AUTH_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
  await import('../../../../desktop-bootstrap/overlay/electron-piecemaker/auth/server-hooks.mjs');
  const { initializeDatabase, getConnection, closeConnection } = await import('@/modules/database/index.js');
  await initializeDatabase();
  const { authRoutes, authenticateWebSocket } = await import('@/modules/auth/index.js');
  const { desktopAuthRoutes } = await import('../index.js');
  const { createWebSocketServer } = await import('@/modules/websocket/index.js');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/piecemaker/local', desktopAuthRoutes());
  const server = createServer(app);
  const sockets = createWebSocketServer(server, {
    verifyClient: { isPlatform: false, authenticateWebSocket },
    chat: { runtime: {} as never },
    shell: { resolveProviderSessionId: () => null },
    getPluginPort: () => null,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const post = (route: string, body: unknown, headers = {}) => fetch(`${origin}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const challenge = 'a'.repeat(64);
    const identity = await fetch(`${origin}/api/piecemaker/local/desktop-auth/identity?challenge=${challenge}`);
    assert.equal(identity.status, 200);
    assert.deepEqual(await identity.json(), { proof: createHmac('sha256', capability).update(challenge).digest('hex') });
    const registered = await post('/api/auth/register', { username: 'avocat', password: 'ancien-secret-123' });
    assert.equal(registered.status, 200);
    const { token } = await registered.json() as { token: string };
    const database = getConnection();
    database.prepare("INSERT INTO user_preferences(user_id, preference_key, preference_value) VALUES (1, 'theme', '\"dark\"')").run();
    const userBefore = database.prepare('SELECT * FROM users').get() as Record<string, unknown>;
    const secretBefore = database.prepare("SELECT value FROM app_config WHERE key = 'jwt_secret'").get();
    assert.equal(process.env.PIECEMAKER_DESKTOP_AUTH_SECRET, undefined);
    const socket = new WebSocket(`${origin.replace('http', 'ws')}/ws?token=${token}`);
    await once(socket, 'open');

    for (const headers of [{}, { 'X-PieceMaker-Desktop-Auth': 'wrong' }, { 'X-PieceMaker-Desktop-Auth': capability, Origin: origin }, { 'X-PieceMaker-Desktop-Auth': capability, 'X-PieceMaker-Remote': '1' }, { 'X-PieceMaker-Desktop-Auth': capability, 'Tailscale-User-Login': 'test@example.com' }]) {
      assert.equal((await post('/api/piecemaker/local/desktop-auth/reset', { password: 'nouveau-secret-456' }, headers)).status, 403);
    }
    for (const password of [null, 'court', 'é'.repeat(37), 'secret\0interdit']) {
      assert.equal((await post('/api/piecemaker/local/desktop-auth/reset', { password }, { 'X-PieceMaker-Desktop-Auth': capability })).status, 400);
    }
    assert.deepEqual(database.prepare('SELECT * FROM users').get(), userBefore);
    assert.deepEqual(database.prepare("SELECT value FROM app_config WHERE key = 'jwt_secret'").get(), secretBefore);
    database.exec("CREATE TEMP TRIGGER reject_secret BEFORE UPDATE ON app_config WHEN NEW.key = 'jwt_secret' BEGIN SELECT RAISE(ABORT, 'simulated-write-failure'); END");
    assert.equal((await post('/api/piecemaker/local/desktop-auth/reset', { password: 'nouveau-secret-456' }, { 'X-PieceMaker-Desktop-Auth': capability })).status, 409);
    assert.deepEqual(database.prepare('SELECT * FROM users').get(), userBefore);
    assert.ok(authenticateWebSocket(token));
    database.exec('DROP TRIGGER reject_secret');
    const bcrypt = createRequire(import.meta.url)('bcrypt') as { compare(password: string, hash: string): Promise<boolean> };
    const compare = bcrypt.compare;
    let signalComparison!: () => void;
    let resumeComparison!: () => void;
    const comparisonStarted = new Promise<void>(resolve => { signalComparison = resolve; });
    const continueComparison = new Promise<void>(resolve => { resumeComparison = resolve; });
    bcrypt.compare = async (password, hash) => {
      const result = await compare(password, hash);
      signalComparison();
      await continueComparison;
      return result;
    };
    const racingLogin = post('/api/auth/login', { username: 'avocat', password: 'ancien-secret-123' });
    await comparisonStarted;
    const closed = once(socket, 'close');
    assert.equal((await post('/api/piecemaker/local/desktop-auth/reset', { password: 'nouveau-secret-456' }, { 'X-PieceMaker-Desktop-Auth': capability })).status, 200);
    resumeComparison();
    assert.equal((await racingLogin).status, 401);
    bcrypt.compare = compare;
    await closed;
    assert.equal((await fetch(`${origin}/api/auth/user`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
    assert.equal((await post('/api/auth/refresh', {}, { Authorization: `Bearer ${token}` })).status, 401);
    assert.equal(authenticateWebSocket(token), null);
    assert.equal((await post('/api/auth/login', { username: 'avocat', password: 'ancien-secret-123' })).status, 401);
    const signedIn = await post('/api/auth/login', { username: 'avocat', password: 'nouveau-secret-456' });
    assert.equal(signedIn.status, 200);
    const fresh = await signedIn.json() as { token: string };
    assert.ok(authenticateWebSocket(fresh.token));
    assert.equal((await fetch(`${origin}/api/auth/user`, { headers: { Authorization: `Bearer ${fresh.token}` } })).status, 200);
    const userAfter = database.prepare('SELECT * FROM users').get() as Record<string, unknown>;
    assert.equal(userAfter.id, userBefore.id);
    assert.equal(userAfter.username, userBefore.username);
    assert.notEqual(userAfter.password_hash, userBefore.password_hash);
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM user_preferences').get() as { count: number }).count, 1);
    assert.notDeepEqual(database.prepare("SELECT value FROM app_config WHERE key = 'jwt_secret'").get(), secretBefore);
    process.env.JWT_SECRET = 'externally-managed-key';
    assert.equal((await post('/api/piecemaker/local/desktop-auth/reset', { password: 'autre-secret-789' }, { 'X-PieceMaker-Desktop-Auth': capability })).status, 409);
    delete process.env.JWT_SECRET;
  } finally {
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeConnection();
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(directory, { recursive: true, force: true });
  }
});
