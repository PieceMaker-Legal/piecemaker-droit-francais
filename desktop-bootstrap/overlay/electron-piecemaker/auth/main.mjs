import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadProductConfig } from '../../shared/product-config.mjs';
import { windowsPowerShellEnvironment } from '../../desktop-bootstrap/lib/shell.mjs';

export async function installDesktopPasswords({ app, dialog, ipcMain, session, safeStorage, BrowserWindow, applicationRoot }) {
  if (!['darwin', 'win32'].includes(process.platform)) return;
  const directory = path.join(applicationRoot, 'electron-piecemaker/auth');
  const dataRoot = process.env.CLOUDCLI_HOME || path.join(os.homedir(), loadProductConfig().dataDirectoryName);
  const credentialFile = path.join(dataRoot, 'desktop-password.enc');
  const secret = randomBytes(32).toString('hex');
  process.env.PIECEMAKER_DESKTOP_AUTH_SECRET = secret;
  process.env.PIECEMAKER_DESKTOP_AUTH_ROOT = applicationRoot;
  const hook = pathToFileURL(path.join(directory, 'server-hooks.mjs')).href;
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --import=${hook}`.trim();
  let busy = false;

  async function serverOrigin(event) {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error('Action réservée à la fenêtre principale.');
    const source = new URL(event.senderFrame.url).origin;
    const marker = JSON.parse(await fs.readFile(path.join(dataRoot, 'local-server.json'), 'utf8'));
    const expected = new URL(marker.url);
    if (expected.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname)
      || source !== expected.origin) throw new Error('Origine PieceMaker non autorisée.');
    const challenge = randomBytes(32).toString('hex');
    const { proof } = await request(expected.origin, `/api/piecemaker/local/desktop-auth/identity?challenge=${challenge}`);
    const expectedProof = createHmac('sha256', secret).update(challenge).digest('hex');
    if (typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof) || !timingSafeEqual(Buffer.from(proof), Buffer.from(expectedProof))) throw new Error('Le serveur PieceMaker n’a pas pu prouver son identité.');
    return expected.origin;
  }

  async function request(origin, route, body, privileged = false) {
    const response = await fetch(`${origin}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(privileged ? { 'X-PieceMaker-Desktop-Auth': secret } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(response.status === 401 ? 'Identifiants enregistrés refusés. Connectez-vous avec votre mot de passe.' : 'Action impossible. Vérifiez que le serveur PieceMaker est disponible.');
    return response.json();
  }

  async function encryptedCredentials(username, password) {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Le stockage sécurisé du système est indisponible.');
    return safeStorage.encryptStringAsync(JSON.stringify({ username, password }));
  }

  async function save(encrypted) {
    await fs.mkdir(dataRoot, { recursive: true });
    const temporary = `${credentialFile}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, credentialFile);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  async function verifySystem() {
    const handle = BrowserWindow.getFocusedWindow()?.getNativeWindowHandle();
    const command = process.platform === 'darwin' ? path.join(directory, 'PieceMaker') : path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const args = process.platform === 'darwin'
      ? []
      : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(directory, 'verify-windows.ps1'), '-WindowHandle', handle ? handle.readBigUInt64LE().toString() : '0'];
    const environment = { ...process.env };
    delete environment.PIECEMAKER_DESKTOP_AUTH_SECRET;
    await new Promise((resolve, reject) => execFile(command, args, { timeout: 120000, windowsHide: true, maxBuffer: 8192, env: windowsPowerShellEnvironment(path.basename(command), environment) }, (error, stdout) => {
      if (error || stdout.trim() !== 'verified') reject(new Error('Authentification système annulée, refusée ou indisponible.'));
      else resolve();
    }));
  }

  const actions = {
    async remember(origin, credentials) {
      if (typeof credentials?.username !== 'string' || typeof credentials?.password !== 'string'
        || !credentials.username || !credentials.password || credentials.username.length > 1024 || credentials.password.length > 4096) throw new Error('Identifiants invalides.');
      await request(origin, '/api/auth/login', credentials);
      try { await save(await encryptedCredentials(credentials.username, credentials.password)); }
      catch (error) {
        await dialog.showMessageBox({ type: 'warning', title: 'Mot de passe PieceMaker', message: 'Connexion réussie, mais le mot de passe n’a pas été enregistré.', detail: 'Conservez votre mot de passe. La prochaine connexion pourra le demander.' });
        throw error;
      }
      return { saved: true };
    },
    async login(origin) {
      let encrypted;
      try { encrypted = await fs.readFile(credentialFile); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Le stockage sécurisé du système est indisponible.');
      const { result } = await safeStorage.decryptStringAsync(encrypted);
      const credentials = JSON.parse(result);
      if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string') throw new Error('Identifiants enregistrés invalides.');
      return request(origin, '/api/auth/login', credentials);
    },
    async reset(origin, password, event) {
      if (typeof password !== 'string' || password.length < 6 || Buffer.byteLength(password) > 72 || password.includes('\0')) throw new Error('Le mot de passe doit contenir au moins 6 caractères et au plus 72 octets.');
      const { username } = await request(origin, '/api/piecemaker/local/desktop-auth/account', undefined, true);
      if (!username) throw new Error('Créez d’abord votre compte PieceMaker.');
      const encrypted = await encryptedCredentials(username, password);
      await verifySystem();
      if (await serverOrigin(event) !== origin) throw new Error('La fenêtre PieceMaker a changé. Recommencez.');
      await request(origin, '/api/piecemaker/local/desktop-auth/reset', { password }, true);
      let saved = true;
      try { await save(encrypted); } catch { saved = false; }
      let result;
      try { result = await request(origin, '/api/auth/login', { username, password }); }
      catch { throw new Error('Le mot de passe a été réinitialisé. La reconnexion automatique a échoué : connectez-vous avec le nouveau mot de passe.'); }
      return { ...result, saved };
    },
  };

  ipcMain.handle('piecemaker-password', async (event, action, input) => {
    try {
      const origin = await serverOrigin(event);
      if (!Object.hasOwn(actions, action)) throw new Error('Action inconnue.');
      if (busy) throw new Error('Une action sur le mot de passe est déjà en cours.');
      busy = true;
      try { return { result: await actions[action](origin, input, event) }; } finally { busy = false; }
    } catch (error) {
      return { error: error.message || 'Action impossible.' };
    }
  });
  const preload = session.defaultSession.registerPreloadScript({ type: 'frame', filePath: path.join(directory, 'preload.cjs') });
  app.once('quit', () => {
    ipcMain.removeHandler('piecemaker-password');
    session.defaultSession.unregisterPreloadScript(preload);
  });
}
