const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createServer } = require('node:http');
const { createHmac } = require('node:crypto');
const { app, BrowserWindow, dialog, ipcMain, session, safeStorage } = require('electron');

const directory = fsSync.mkdtempSync(path.join(os.tmpdir(), 'pm-electron-auth-'));
process.env.CLOUDCLI_HOME = path.join(directory, 'data');
fsSync.mkdirSync(path.join(directory, 'profile'));
app.setPath('userData', path.join(directory, 'profile'));
let server;
let window;

async function run() {
  const root = path.resolve(__dirname, '../../../..');
  const overlay = path.join(directory, 'electron-piecemaker/auth');
  await fs.mkdir(path.join(directory, 'shared'), { recursive: true });
  await fs.mkdir(path.join(directory, 'desktop-bootstrap/lib'), { recursive: true });
  await fs.cp(__dirname, overlay, { recursive: true });
  await fs.copyFile(path.join(root, 'shared/product-config.mjs'), path.join(directory, 'shared/product-config.mjs'));
  await fs.copyFile(path.join(root, 'desktop-bootstrap/lib/shell.mjs'), path.join(directory, 'desktop-bootstrap/lib/shell.mjs'));
  const password = 'secret-fictif-natif-123';
  server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.endsWith('/desktop-auth/identity')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ proof: createHmac('sha256', process.env.PIECEMAKER_DESKTOP_AUTH_SECRET).update(url.searchParams.get('challenge')).digest('hex') }));
    } else if (url.pathname === '/api/auth/login') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      assert.equal(input.username, 'avocat');
      assert.equal(input.password, password);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ token: 'header.payload.signature', user: { username: 'avocat' } }));
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><body><form><input id="username"><input id="password" type="password" autocomplete="current-password"><button type="submit">Connexion</button></form></body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await fs.mkdir(process.env.CLOUDCLI_HOME, { recursive: true });
  await fs.writeFile(path.join(process.env.CLOUDCLI_HOME, 'local-server.json'), JSON.stringify({ url: origin }));
  await app.whenReady();
  const { installDesktopPasswords } = await import(pathToFileURL(path.join(overlay, 'main.mjs')).href);
  await installDesktopPasswords({ app, BrowserWindow, dialog, ipcMain, session, safeStorage, applicationRoot: directory });
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(origin);
  await window.webContents.executeJavaScript(`new Promise(resolve => setTimeout(resolve, 100))`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[data-piecemaker-password]').length`), 1);
  await window.webContents.executeJavaScript(`
    document.querySelector('#username').value = 'avocat';
    document.querySelector('#password').value = ${JSON.stringify(password)};
    document.querySelector('form').addEventListener('submit', event => event.preventDefault());
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    localStorage.setItem('auth-token', 'initial-token');
    window.dispatchEvent(new Event('auth-token-refreshed'));
    location.reload();
  `);
  const credentialFile = path.join(process.env.CLOUDCLI_HOME, 'desktop-password.enc');
  let encrypted;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { encrypted = await fs.readFile(credentialFile); break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(encrypted, 'Le mot de passe doit être enregistré même si React recharge immédiatement la page.');
  assert.equal(encrypted.includes(Buffer.from(password)), false);
  assert.deepEqual(JSON.parse((await safeStorage.decryptStringAsync(encrypted)).result), { username: 'avocat', password });
  await window.webContents.executeJavaScript(`localStorage.removeItem('auth-token'); location.reload();`);
  let token;
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try { token = await window.webContents.executeJavaScript(`localStorage.getItem('auth-token')`); } catch {}
    if (token) break;
  }
  assert.equal(token, 'header.payload.signature');
  console.log('PASS: stockage système natif, preload isolé, sauvegarde après connexion et reconnexion automatique.');
}

let exitCode = 0;
run().catch(error => { console.error(error); exitCode = 1; }).finally(async () => {
  window?.destroy();
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
  await session.defaultSession.clearCache();
  app.exit(exitCode);
});
