import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import * as crypto from 'node:crypto';
import * as url from 'node:url';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { windowsPowerShellEnvironment } from '../../../lib/shell.mjs';

for (const platform of ['darwin', 'win32']) test(`${platform}: desktop encrypts passwords, validates IPC origins and requires OS authentication`, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-vault-'));
  const environment = { CLOUDCLI_HOME: directory, PSModulePath: 'foreign-modules' };
  const calls = [];
  let warnings = 0;
  const native = { verified: false, available: true, spoof: false };
  let logins = 0;
  let systemCommand;
  let current = 'premier-secret-123';
  let desktopCapability;
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const privileged = request.headers['x-piecemaker-desktop-auth'] === desktopCapability;
    if (request.url.startsWith('/api/piecemaker/local/desktop-auth/identity?')) {
      assert.equal(request.headers['x-piecemaker-desktop-auth'], undefined);
      const challenge = new URL(request.url, 'http://localhost').searchParams.get('challenge');
      response.end(JSON.stringify({ proof: crypto.createHmac('sha256', native.spoof ? 'wrong-server' : desktopCapability).update(challenge).digest('hex') }));
    } else if (request.url === '/api/piecemaker/local/desktop-auth/account' && privileged) {
      response.end(JSON.stringify({ username: 'avocat' }));
    } else if (request.url === '/api/piecemaker/local/desktop-auth/reset' && privileged) {
      calls.push('reset');
      current = body.password;
      response.end('{}');
    } else if (request.url === '/api/auth/login' && body.username === 'avocat' && body.password === current) {
      logins++;
      response.end(JSON.stringify({ token: 'header.payload.signature', user: { username: 'avocat' } }));
    } else response.writeHead(401).end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  await fs.writeFile(path.join(directory, 'local-server.json'), JSON.stringify({ url: origin }));
  const app = new EventEmitter();
  const handlers = new Map();
  const key = crypto.randomBytes(32);
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => native.available,
    encryptStringAsync: async plaintext => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptStringAsync: async encrypted => {
      const cipher = crypto.createDecipheriv('aes-256-gcm', key, encrypted.subarray(0, 12));
      cipher.setAuthTag(encrypted.subarray(12, 28));
      return { result: Buffer.concat([cipher.update(encrypted.subarray(28)), cipher.final()]).toString() };
    },
  };
  const context = createContext({ process: { platform, env: environment }, console, Buffer, fetch, AbortSignal, URL, Object });
  const source = await fs.readFile(new URL('./main.mjs', import.meta.url), 'utf8');
  const mocks = {
    'node:fs/promises': { default: fs }, 'node:path': { default: path }, 'node:os': { default: os },
    'node:crypto': crypto, 'node:url': url,
    'node:child_process': { execFile: (command, _args, options, callback) => {
      systemCommand = command;
      assert.equal(options.env.PIECEMAKER_DESKTOP_AUTH_SECRET, undefined);
      if (platform === 'win32') assert.equal(options.env.PSModulePath, undefined);
      calls.push('system');
      callback(native.verified ? null : new Error('cancel'), native.verified ? 'verified\n' : '');
    } },
    '../../shared/product-config.mjs': { loadProductConfig: () => ({ dataDirectoryName: '.unused' }) },
    '../../desktop-bootstrap/lib/shell.mjs': { windowsPowerShellEnvironment },
  };
  const module = new SourceTextModule(source, { context });
  await module.link(specifier => {
    assert.ok(mocks[specifier], specifier);
    return new SyntheticModule(Object.keys(mocks[specifier]), function () { for (const [name, value] of Object.entries(mocks[specifier])) this.setExport(name, value); }, { context });
  });
  await module.evaluate();
  try {
    await module.namespace.installDesktopPasswords({
      app, safeStorage, applicationRoot: directory,
      dialog: { showMessageBox: async () => { warnings++; } },
      BrowserWindow: { getFocusedWindow: () => null },
      ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
      session: { defaultSession: { registerPreloadScript: () => 'preload', unregisterPreloadScript: () => {} } },
    });
    desktopCapability = environment.PIECEMAKER_DESKTOP_AUTH_SECRET;
    const mainFrame = { url: `${origin}/` };
    const event = { senderFrame: mainFrame, sender: { mainFrame } };
    const invoke = (action, input, sender = event) => handlers.get('piecemaker-password')(sender, action, input);
    assert.equal((await invoke('login')).result, null);
    assert.ok((await invoke('remember', { username: 'avocat', password: 'incorrect' })).error);
    await assert.rejects(fs.readFile(path.join(directory, 'desktop-password.enc')));
    assert.equal((await invoke('remember', { username: 'avocat', password: current })).result.saved, true);
    const encrypted = await fs.readFile(path.join(directory, 'desktop-password.enc'));
    assert.equal(encrypted.includes(Buffer.from(current)), false);
    assert.equal((await invoke('login')).result.user.username, 'avocat');
    native.spoof = true;
    const beforeSpoof = logins;
    assert.ok((await invoke('login')).error);
    assert.equal(logins, beforeSpoof);
    native.spoof = false;
    for (const forbidden of [
      { senderFrame: { url: `${origin}/frame` }, sender: { mainFrame } },
      { senderFrame: null, sender: { mainFrame } },
      (() => { const frame = { url: 'http://localhost:1/' }; return { senderFrame: frame, sender: { mainFrame: frame } }; })(),
    ]) assert.ok((await invoke('reset', 'nouveau-secret-456', forbidden)).error);
    assert.equal(calls.length, 0);
    assert.ok((await invoke('reset', 'nouveau-secret-456')).error);
    assert.deepEqual(calls, ['system']);
    assert.equal(current, 'premier-secret-123');
    native.available = false;
    assert.ok((await invoke('remember', { username: 'avocat', password: current })).error);
    assert.equal(warnings, 1);
    native.verified = true;
    assert.ok((await invoke('reset', 'nouveau-secret-456')).error);
    assert.deepEqual(calls, ['system']);
    native.available = true;
    const result = await invoke('reset', 'nouveau-secret-456');
    assert.equal(result.result.saved, true);
    assert.deepEqual(calls, ['system', 'system', 'reset']);
    assert.ok(systemCommand.endsWith(platform === 'darwin' ? 'PieceMaker' : 'powershell.exe'));
    assert.equal((await invoke('login')).result.token, 'header.payload.signature');
    assert.equal((await fs.readFile(path.join(directory, 'desktop-password.enc'))).includes(Buffer.from(current)), false);
    app.emit('quit');
    assert.equal(handlers.size, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
