import { app, BrowserWindow, session } from 'electron';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { installUiUpdates } from '../../../desktop-bootstrap/overlay/electron-piecemaker/ui-updates/index.mjs';
import { archiveHash } from '../../../desktop-bootstrap/overlay/electron-piecemaker/ui-updates/package.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'pm-ui-electron-'));
app.setPath('userData', path.join(root, 'browser-profile'));
const startupError = process.argv.includes('--startup-error');
const broken = process.argv.includes('--broken') || startupError;
const sockets = new Set();
const backend = createServer(async (request, response) => {
  if (request.url === '/api/echo') {
    let body = '';
    for await (const chunk of request) body += chunk;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ body, cookie: request.headers.cookie || '' }));
  } else if (request.url === '/api/stream') {
    response.setHeader('Content-Type', 'text/event-stream');
    response.write('data: first\n\n');
    setTimeout(() => response.end('data: second\n\n'), 30);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<div id="root">Embedded interface</div>');
  }
});
backend.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
backend.on('upgrade', (request, socket) => {
  const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const message = Buffer.from('socket-ok');
  socket.write(Buffer.concat([Buffer.from([0x81, message.length]), message]));
});

async function run() {
  let window;
  let timeout;
  try {
    await app.whenReady();
    app.on('window-all-closed', () => {});
    await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${backend.address().port}`;
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const config = { runtime: 'desktop-1.0.0', publicKey: publicKey.export({ type: 'spki', format: 'pem' }), feed: 'https://example.invalid/updates' };
    await fs.mkdir(path.join(root, 'electron-piecemaker'), { recursive: true });
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(path.join(root, 'dist/index.html'), '<div id="root">Embedded interface</div>');
    await fs.writeFile(path.join(root, 'electron-piecemaker/ui-update-runtime.json'), JSON.stringify(config));
    const entries = [
      ['index.html', Buffer.from('<div id="root"></div><script type="module" src="/assets/main.js"></script>').toString('base64')],
      ['assets/main.js', Buffer.from(startupError
        ? 'document.getElementById("root").innerHTML = "<p>Loading</p>"; throw new Error("Simulated startup exception")'
        : broken ? 'throw new Error("Simulated render failure")' : 'document.getElementById("root").innerHTML = "<p>Updated interface</p>"').toString('base64')],
    ];
    const archive = gzipSync(JSON.stringify(entries));
    const sha256 = archiveHash(archive);
    const manifest = { format: 1, runtime: config.runtime, sequence: 1, sha256, bytes: archive.length, archive: `ui-${sha256}.json.gz` };
    const payload = JSON.stringify(manifest);
    const envelope = { payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') };
    const dataRoot = path.join(root, 'data');
    const storeRoot = path.join(dataRoot, 'ui-updates', config.runtime);
    await fs.mkdir(storeRoot, { recursive: true });
    await fs.writeFile(path.join(storeRoot, manifest.archive), archive);
    await fs.writeFile(path.join(storeRoot, 'state.json'), JSON.stringify({ highest: 1, pending: envelope }));
    const seed = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    await seed.loadURL(origin);
    await seed.webContents.executeJavaScript('localStorage.setItem("session-test", "preserved"); document.cookie = "session-test=preserved; SameSite=Strict";');
    seed.destroy();
    class Controller {
      dataRoot = dataRoot;
      async resolveLocalServerUrl() { return origin; }
    }
    const packagedApp = new Proxy(app, {
      get(target, name) {
        if (name === 'isPackaged') return true;
        const value = Reflect.get(target, name);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await installUiUpdates({ app: packagedApp, session, LocalServerController: Controller, applicationRoot: root, log: (message) => console.log(message) });
    assert.equal(await new Controller().resolveLocalServerUrl(), origin);
    window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    await window.loadURL(origin);
    await Promise.race([
      (async () => {
        const expected = broken ? 'Embedded interface' : 'Updated interface';
        for (let attempt = 0; attempt < 180; attempt++) {
          const text = await window.webContents.executeJavaScript('document.getElementById("root")?.textContent');
          const state = JSON.parse(await fs.readFile(path.join(storeRoot, 'state.json')));
          if (text === expected && !state.trial) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error('Interface did not become healthy');
      })(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Smoke test timed out')), 50000); }),
    ]);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const response = await fetch('/api/echo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'example' }) });
      const echo = await response.json();
      const stream = await (await fetch('/api/stream')).text();
      const socket = await new Promise((resolve, reject) => {
        const connection = new WebSocket(location.origin.replace('http:', 'ws:') + '/ws');
        connection.onmessage = event => { resolve(event.data); connection.close(); };
        connection.onerror = reject;
      });
      return { echo, stream, socket, storage: localStorage.getItem('session-test'), origin: location.origin };
    })()`);
    assert.deepEqual(JSON.parse(result.echo.body), { value: 'example' });
    assert.match(result.echo.cookie, /session-test=preserved/);
    assert.match(result.stream, /first[\s\S]*second/);
    assert.equal(result.socket, 'socket-ok');
    assert.equal(result.storage, 'preserved');
    assert.equal(result.origin, origin);
    console.log(`PASS ${process.platform}: ${broken ? 'automatic rollback' : 'signed UI activation'}, POST, cookies, streaming, WebSocket and localStorage`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    window?.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => backend.close(resolve));
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    app.exit(process.exitCode || 0);
  }
}

void run();
