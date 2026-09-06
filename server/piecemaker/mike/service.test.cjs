const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalFetch = global.fetch;
const originalPiemakerPort = process.env.PIECEMAKER_MIKE_PORT;
const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-mike-service-'));
fs.mkdirSync(path.join(homeDir, 'mike'), { recursive: true });
fs.writeFileSync(path.join(homeDir, 'mike', 'compose.json'), JSON.stringify({ services: { backend: { environment: { SUPABASE_SECRET_KEY: 'test-secret' } } } }));
process.env.PIECEMAKER_MIKE_PORT = '3212';

global.fetch = async (input, options) => {
  const url = String(input);
  if (url.startsWith('http://127.0.0.1:3212')) return originalFetch(input, options);
  if (url === 'http://127.0.0.1:3011/health') return new Response('', { status: 200 });
  if (url === 'http://127.0.0.1:3010/workflows') return new Response('<!doctype html>', { status: 200 });
  if (url === 'http://127.0.0.1:3011/auth/login') return new Response('', { status: 401 });
  if (url === 'http://127.0.0.1:3011/auth/signup') return new Response(JSON.stringify({ user: { id: 'mike-test-user' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (url === 'http://127.0.0.1:3011/user/profile') return new Response('{}', { status: 200 });
  if (url === 'http://127.0.0.1:3011/auth/logout') return new Response('', { status: 200 });
  if (url.startsWith('http://127.0.0.1:54331/rest/v1/user_profiles')) return new Response(null, { status: 204 });
  throw new Error(`Unexpected test request: ${url}`);
};

const { createMikeService } = require('./service.cjs');
const service = createMikeService({ applicationRoot: path.resolve(__dirname, '../../..'), homeDir });

test.after(() => {
  global.fetch = originalFetch;
  if (originalPiemakerPort === undefined) delete process.env.PIECEMAKER_MIKE_PORT;
  else process.env.PIECEMAKER_MIKE_PORT = originalPiemakerPort;
});

test('status reports a healthy Mike stack without starting the gateway', async () => {
  assert.deepEqual(await service.status(), { ready: true, port: 3212 });
});

test('open rejects paths outside the Mike workspace', async () => {
  await assert.rejects(service.open('user-1', '/etc/passwd', 'http://localhost:5173'), /page Mike/);
  await assert.rejects(service.open('user-1', '//attacker', 'http://localhost:5173'), /page Mike/);
  await assert.rejects(service.open('user-1', '/workflows\\private', 'http://localhost:5173'), /page Mike/);
});

test('opened gateway rejects requests without its signed session cookie', async () => {
  const opened = await service.open('user-1', '/workflows', 'http://127.0.0.1:5173');
  const missingCookie = await originalFetch(opened.url);
  assert.equal(missingCookie.status, 401);
  const tamperedCookie = opened.cookie.replace(/(pm_mike_gate=[^;]+).*/, '$1x');
  const alteredCookie = await originalFetch(opened.url, { headers: { cookie: tamperedCookie } });
  assert.equal(alteredCookie.status, 401);
  const gatewayOrigin = new URL(opened.url).origin;
  const closed = await originalFetch(`${gatewayOrigin}/__piecemaker/close`, { method: 'POST', headers: { cookie: opened.cookie, origin: 'http://127.0.0.1:5173' } });
  assert.equal(closed.status, 204);
  const revokedCookie = await originalFetch(opened.url, { headers: { cookie: opened.cookie } });
  assert.equal(revokedCookie.status, 401);
});
