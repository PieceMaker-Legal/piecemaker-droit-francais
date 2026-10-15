import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

import { isOwner, startGateway } from './gateway.js';
import { createKeepAwake, keepAwakeCommand } from './keep-awake.js';
import { createKeepAwakeRouter } from './keep-awake-router.js';
import { createRemoteAccess, REMOTE_STATE_FILE } from './remote-access.js';
import { consentUrl, createTailscale, findTailscale, parseServeEntry, parseStatus, type CommandResult } from './tailscale.js';

const DNS = 'poste-exemple.tailnet-exemple.ts.net';
const OWNER = 'jean.dupont@example.com';

const STATUS_JSON = JSON.stringify({
  BackendState: 'Running',
  Self: { DNSName: `${DNS}.`, UserID: 42 },
  User: { 42: { LoginName: OWNER } },
  CertDomains: [DNS],
});

function fakeCli(initialServe: Record<string, unknown> = {}, serveOutput: Partial<CommandResult> = {}) {
  let serveConfig: Record<string, unknown> = initialServe;
  const calls: string[][] = [];
  const run = async (_binary: string, args: string[]): Promise<CommandResult> => {
    calls.push(args);
    if (args[0] === 'status') return { code: 0, stdout: STATUS_JSON, stderr: '', timedOut: false };
    if (args[1] === 'status') return { code: 0, stdout: JSON.stringify(serveConfig), stderr: '', timedOut: false };
    if (args.includes('off')) {
      serveConfig = {};
      return { code: 0, stdout: '', stderr: '', timedOut: false };
    }
    if (serveOutput.stdout || serveOutput.timedOut) return { code: -1, stdout: '', stderr: '', timedOut: false, ...serveOutput };
    const port = args.find((arg) => arg.startsWith('--https='))!.slice('--https='.length);
    serveConfig = { Web: { [`${DNS}:${port}`]: { Handlers: { '/': { Proxy: args[args.length - 1] } } } } };
    return { code: 0, stdout: '', stderr: '', timedOut: false };
  };
  return { tailscale: createTailscale('tailscale', run), calls };
}

function fakeKeepAwake() {
  let active = false;
  return { start: () => { active = true; }, stop: () => { active = false; }, active: () => active };
}

async function withRemote(cli: ReturnType<typeof fakeCli>, run: (remote: ReturnType<typeof createRemoteAccess>, dataRoot: string) => Promise<void>) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'pm-remote-'));
  const gateways: Array<{ close(): Promise<void> }> = [];
  const remote = createRemoteAccess({
    tailscale: cli.tailscale,
    dataRoot,
    devMode: false,
    serverPort: 3101,
    vitePort: 5173,
    keepAwake: fakeKeepAwake(),
    startGateway: async (target, owner) => {
      const gateway = await startGateway(target, owner);
      gateways.push(gateway);
      return gateway;
    },
  });
  try {
    await run(remote, dataRoot);
  } finally {
    await Promise.all(gateways.map((gateway) => gateway.close()));
    await rm(dataRoot, { recursive: true, force: true });
  }
}

test('parseStatus lit le nom DNS, le compte et l’activation HTTPS', () => {
  assert.deepEqual(parseStatus(STATUS_JSON), { running: true, dnsName: DNS, ownerLogin: OWNER, httpsEnabled: true });
  assert.equal(parseStatus(JSON.stringify({ BackendState: 'NeedsLogin', Self: {} })).running, false);
});

test('parseServeEntry trouve la cible et le Funnel du port demandé', () => {
  const config = { Web: { [`${DNS}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:4000' } } } }, AllowFunnel: { [`${DNS}:443`]: true } };
  assert.deepEqual(parseServeEntry(JSON.stringify(config), DNS, 443), { proxy: 'http://127.0.0.1:4000', funnel: true });
  assert.deepEqual(parseServeEntry(JSON.stringify(config), DNS, 8443), { proxy: null, funnel: false });
  assert.deepEqual(parseServeEntry('', DNS, 443), { proxy: null, funnel: false });
});

test('findTailscale cherche le binaire hors du PATH sur macOS et Windows', () => {
  assert.equal(findTailscale((file) => file === '/Applications/Tailscale.app/Contents/MacOS/Tailscale', 'darwin'), '/Applications/Tailscale.app/Contents/MacOS/Tailscale');
  assert.match(findTailscale((file) => file.endsWith('tailscale.exe'), 'win32'), /Tailscale\\tailscale\.exe$/);
  assert.equal(findTailscale(() => false, 'linux'), 'tailscale');
});

test('consentUrl extrait le lien d’autorisation affiché par Tailscale', () => {
  assert.equal(consentUrl('Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=abc\n'), 'https://login.tailscale.com/f/serve?node=abc');
  assert.equal(consentUrl('ok'), null);
});

function windowsKeepAwakeScript(pid: number): string {
  const args = keepAwakeCommand('win32', pid)![1];
  return Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
}

test('keepAwakeCommand empêche la veille sur macOS et Windows tant que le serveur vit', () => {
  assert.deepEqual(keepAwakeCommand('darwin', 123), ['caffeinate', ['-i', '-w', '123']]);
  const win = keepAwakeCommand('win32', 123)!;
  assert.match(win[0], /powershell\.exe$/i);
  assert.ok(win[1].includes('-EncodedCommand'));
  const script = windowsKeepAwakeScript(123);
  assert.match(script, /DllImport\("kernel32\.dll"\)/);
  assert.match(script, /SetThreadExecutionState/);
  assert.match(script, /PowerCreateRequest/);
  assert.match(script, /PowerSetRequest/);
  assert.match(script, /\$watch = 123\b/);
  assert.equal(keepAwakeCommand('linux', 123), null);
});

test('createKeepAwake délègue à l’app de bureau quand l’URL est posée', async () => {
  const previous = process.env.PIECEMAKER_DESKTOP_KEEP_AWAKE_URL;
  const app = express().use(express.json()).use((request, response) => {
    response.json({ active: request.body?.enabled === true });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const keep = createKeepAwake();
  try {
    process.env.PIECEMAKER_DESKTOP_KEEP_AWAKE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    await keep.start();
    assert.equal(keep.active(), true);
    await keep.stop();
    assert.equal(keep.active(), false);
  } finally {
    if (previous === undefined) delete process.env.PIECEMAKER_DESKTOP_KEEP_AWAKE_URL;
    else process.env.PIECEMAKER_DESKTOP_KEEP_AWAKE_URL = previous;
    server.close();
  }
});

test('createKeepAwake pose une requête d’exécution Windows', async () => {
  if (process.platform !== 'win32') return;
  const keep = createKeepAwake();
  keep.start();
  try {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    assert.equal(keep.active(), true);
    const requests = execFileSync('powercfg', ['/requests']);
    assert.ok(requests.includes(Buffer.from('PieceMaker')), requests.toString());
  } finally {
    keep.stop();
  }
});

test('le menu des onglets active et désactive le maintien d’éveil', async () => {
  const app = express().use(express.json()).use(createKeepAwakeRouter(fakeKeepAwake()));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/keep-awake`;
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.deepEqual(await (await fetch(url)).json(), { active: false });
    assert.deepEqual(await (await post({ enabled: true })).json(), { active: true });
    assert.deepEqual(await (await post({ enabled: false })).json(), { active: false });
    assert.equal((await post({})).status, 400);
  } finally {
    server.close();
  }
});

test('isOwner n’accepte que le compte Tailscale de l’ordinateur', () => {
  assert.equal(isOwner({ 'tailscale-user-login': 'Jean.Dupont@example.com' }, OWNER), true);
  assert.equal(isOwner({ 'tailscale-user-login': 'marie.martin@example.com' }, OWNER), false);
  assert.equal(isOwner({}, OWNER), false);
  assert.equal(isOwner({ 'tailscale-user-login': OWNER }, null), false);
});

test('publier puis dépublier ne touche que la cible PieceMaker', async () => {
  const cli = fakeCli();
  await withRemote(cli, async (remote, dataRoot) => {
    assert.deepEqual(await remote.enable(), { consentUrl: null });
    const published = await remote.status();
    assert.equal(published.published, true);
    assert.equal(published.url, `https://${DNS}`);
    assert.equal(published.keepAwake, true);
    const serveCall = cli.calls.find((args) => args.includes('--bg'))!;
    assert.ok(serveCall.includes('--https=443'));
    assert.match(serveCall[serveCall.length - 1], /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(!cli.calls.some((args) => args.includes('funnel') || args.includes('reset')));
    assert.equal(JSON.parse(await readFile(path.join(dataRoot, REMOTE_STATE_FILE), 'utf8')).enabled, true);

    await remote.disable();
    assert.ok(cli.calls.some((args) => args.join(' ') === 'serve --https=443 off'));
    const off = await remote.status();
    assert.equal(off.published, false);
    assert.equal(off.keepAwake, false);
  });
});

test('une cible Serve existante n’est jamais écrasée ni arrêtée', async () => {
  const cli = fakeCli({ Web: { [`${DNS}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:9999' } } } } });
  await withRemote(cli, async (remote) => {
    await assert.rejects(remote.enable(), /sert déjà/);
    assert.equal((await remote.status()).conflict, true);
    await remote.disable();
    assert.ok(!cli.calls.some((args) => args.includes('--bg') || args.includes('off')));
  });
});

test('Funnel actif : la publication est refusée', async () => {
  const cli = fakeCli({ AllowFunnel: { [`${DNS}:443`]: true } });
  await withRemote(cli, async (remote) => {
    await assert.rejects(remote.enable(), /Funnel/);
    assert.ok(!cli.calls.some((args) => args.includes('--bg')));
  });
});

test('Serve non autorisé sur le tailnet : le lien de consentement est renvoyé', async () => {
  const cli = fakeCli({}, { stdout: 'To enable, visit:\n https://login.tailscale.com/f/serve?node=xyz\n', timedOut: true });
  await withRemote(cli, async (remote, dataRoot) => {
    assert.deepEqual(await remote.enable(), { consentUrl: 'https://login.tailscale.com/f/serve?node=xyz' });
    assert.equal(JSON.parse(await readFile(path.join(dataRoot, REMOTE_STATE_FILE), 'utf8')).enabled, false);
    assert.equal((await remote.status()).published, false);
  });
});

test('après consentement, la publication restée en attente n’est pas prise pour un autre service', async () => {
  let consentGiven = false;
  let pendingTarget = '';
  const run = async (_binary: string, args: string[]): Promise<CommandResult> => {
    if (args[0] === 'status') return { code: 0, stdout: STATUS_JSON, stderr: '', timedOut: false };
    if (args[1] === 'status') {
      const config = consentGiven ? { Web: { [`${DNS}:443`]: { Handlers: { '/': { Proxy: pendingTarget } } } } } : {};
      return { code: 0, stdout: JSON.stringify(config), stderr: '', timedOut: false };
    }
    pendingTarget = args[args.length - 1];
    if (!consentGiven) return { code: -1, stdout: 'To enable, visit:\n https://login.tailscale.com/f/serve?node=xyz\n', stderr: '', timedOut: true };
    return { code: 0, stdout: '', stderr: '', timedOut: false };
  };
  await withRemote({ tailscale: createTailscale('tailscale', run), calls: [] }, async (remote) => {
    assert.ok((await remote.enable()).consentUrl);
    consentGiven = true;
    const pending = await remote.status();
    assert.equal(pending.conflict, false);
    assert.equal(pending.published, false);
    assert.deepEqual(await remote.enable(), { consentUrl: null });
    assert.equal((await remote.status()).published, true);
  });
});

test('en mode développement, Serve publie sur 8443 vers Vite', async () => {
  const cli = fakeCli();
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'pm-remote-dev-'));
  let targetPort = 0;
  const remote = createRemoteAccess({
    tailscale: cli.tailscale, dataRoot, devMode: true, serverPort: 3003, vitePort: 5173, keepAwake: fakeKeepAwake(),
    startGateway: async (target) => { targetPort = target(); return { port: 4567, close: async () => {} }; },
  });
  await remote.enable();
  assert.equal(targetPort, 5173);
  assert.ok(cli.calls.some((args) => args.join(' ') === 'serve --bg --yes --https=8443 http://127.0.0.1:4567'));
  await rm(dataRoot, { recursive: true, force: true });
});

test('la passerelle relaie HTTP et WebSocket du propriétaire et refuse les autres', async () => {
  const upstream = http.createServer((request, response) => {
    response.end(JSON.stringify({ host: request.headers.host, remote: request.headers['x-piecemaker-remote'], proto: request.headers['x-forwarded-proto'] }));
  });
  const sockets = new WebSocketServer({ server: upstream });
  sockets.on('connection', (socket) => socket.on('message', (data) => socket.send(`écho:${data}`)));
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;
  const gateway = await startGateway(() => upstreamPort, () => OWNER);
  try {
    const refused = await fetch(`http://127.0.0.1:${gateway.port}/api/x`, { headers: { 'Tailscale-User-Login': 'marie.martin@example.com' } });
    assert.equal(refused.status, 403);
    const accepted = await fetch(`http://127.0.0.1:${gateway.port}/api/x`, { headers: { 'Tailscale-User-Login': OWNER } });
    assert.deepEqual(await accepted.json(), { host: `localhost:${upstreamPort}`, remote: '1', proto: 'https' });

    const socket = new WebSocket(`ws://127.0.0.1:${gateway.port}/ws`, { headers: { 'Tailscale-User-Login': OWNER } });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send('bonjour');
    const [reply] = await new Promise<[Buffer]>((resolve) => socket.once('message', (...args) => resolve(args as unknown as [Buffer])));
    assert.equal(String(reply), 'écho:bonjour');
    socket.close();

    const intruder = new WebSocket(`ws://127.0.0.1:${gateway.port}/ws`);
    await new Promise<void>((resolve) => { intruder.once('error', () => resolve()); intruder.once('close', () => resolve()); });
    assert.notEqual(intruder.readyState, WebSocket.OPEN);
  } finally {
    await gateway.close();
    sockets.close();
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
