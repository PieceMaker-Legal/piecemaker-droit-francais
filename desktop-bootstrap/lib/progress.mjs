import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IS_MAC, IS_WINDOWS, PRODUCT_NAME, bootstrapHome } from './paths.mjs';
import {
  pisteCredentialsConfigured,
  pisteEnvFile,
  savePisteCredentials,
  validatePisteCredentials,
} from './piste.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.join(here, '..', 'installer-ui');
const logoPath = path.join(here, '..', '..', 'public', 'logo-256.png');
const ESTIMATED_STEPS = 14;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const FINAL_STATE_DELAY_MS = 3_000;
const WINDOW_WIDTH = 860;
const WINDOW_HEIGHT = 800;

export const PISTE_LINKS = {
  registration: 'https://piste.gouv.fr/registration',
  login: 'https://piste.gouv.fr/se-connecter',
  cgu: 'https://piste.gouv.fr/apimgt/consentement-cgu-api',
  applications: 'https://piste.gouv.fr/apps',
};

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
};

let session = null;

export function progressWindowEnabled() {
  if (process.env.PIECEMAKER_NO_PROGRESS === '1') return false;
  if (process.env.CI === 'true' || process.env.CI === '1') return false;
  return true;
}

function pisteState() {
  const { piste } = session;
  return {
    offered: piste.offered,
    configured: pisteCredentialsConfigured(piste.envFile),
    skipped: piste.skipped,
    envFile: piste.envFile,
  };
}

function snapshot() {
  return { ...session.state, piste: pisteState() };
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function sendFile(response, file) {
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(data);
  });
}

function readBody(request) {
  return new Promise((resolve) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10_000) request.destroy();
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
    request.on('error', () => resolve({}));
  });
}

function openExternal(url) {
  spawn(IS_MAC ? 'open' : 'explorer.exe', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

function readClipboard() {
  const result = IS_MAC
    ? spawnSync('pbpaste', [], { encoding: 'utf8' })
    : spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8', windowsHide: true });
  return (result.stdout || '').trim().slice(0, 200);
}

async function handlePiste(request, response) {
  const body = await readBody(request);
  const clientId = String(body.clientId || '').trim();
  const clientSecret = String(body.clientSecret || '').trim();
  if (!clientId || !clientSecret) {
    sendJson(response, 400, { ok: false, message: 'Collez le Client ID et le Client Secret.' });
    return;
  }
  const result = await session.piste.validate({ clientId, clientSecret });
  if (result.ok) savePisteCredentials({ clientId, clientSecret }, session.piste.envFile);
  sendJson(response, 200, result);
}

async function route(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  const prefix = `/${session.token}/`;
  if (!url.pathname.startsWith(prefix)) {
    response.writeHead(404).end();
    return;
  }
  const target = url.pathname.slice(prefix.length);
  if (request.method === 'GET' && target === '') {
    sendFile(response, path.join(uiDir, 'index.html'));
  } else if (request.method === 'GET' && target === 'logo.png') {
    sendFile(response, logoPath);
  } else if (request.method === 'GET' && /^piste\/[a-z-]+\.png$/.test(target)) {
    sendFile(response, path.join(uiDir, target));
  } else if (request.method === 'GET' && target === 'state') {
    session.lastSeen = Date.now();
    sendJson(response, 200, snapshot());
  } else if (request.method === 'GET' && target === 'clipboard') {
    sendJson(response, 200, { text: readClipboard() });
  } else if (request.method === 'POST' && target === 'open') {
    const link = PISTE_LINKS[(await readBody(request)).link];
    if (link) openExternal(link);
    sendJson(response, link ? 200 : 400, { ok: Boolean(link) });
  } else if (request.method === 'POST' && target === 'piste') {
    await handlePiste(request, response);
  } else if (request.method === 'POST' && target === 'piste/skip') {
    session.piste.skipped = (await readBody(request)).skipped !== false;
    sendJson(response, 200, { ok: true });
  } else {
    response.writeHead(404).end();
  }
}

function edgeExecutable() {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  return roots
    .map((root) => path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    .find((candidate) => fs.existsSync(candidate));
}

function windowCommand(url) {
  if (IS_MAC) {
    return ['osascript', ['-l', 'JavaScript', path.join(here, 'window-darwin.js'), url, String(WINDOW_WIDTH), String(WINDOW_HEIGHT)]];
  }
  const edge = IS_WINDOWS && edgeExecutable();
  if (!edge) return null;
  return [edge, [
    `--app=${url}`,
    `--user-data-dir=${path.join(bootstrapHome, 'fenetre-installation')}`,
    `--window-size=${WINDOW_WIDTH},${WINDOW_HEIGHT}`,
    '--no-first-run',
    '--no-default-browser-check',
  ]];
}

function launchWindow(url) {
  const command = windowCommand(url);
  if (!command) {
    openExternal(url);
    return;
  }
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' });
  child.on('error', () => {
    session.window = null;
    openExternal(url);
  });
  child.on('exit', () => {
    if (session?.window !== child) return;
    session.window = null;
    session.windowClosed = true;
  });
  child.unref();
  session.window = child;
}

function windowAlive() {
  if (!session || session.windowClosed) return false;
  if (session.window) return true;
  return Date.now() - session.lastSeen < HEARTBEAT_TIMEOUT_MS;
}

export async function openProgressWindow({
  version = '',
  offerPiste = true,
  launch = progressWindowEnabled(),
  validate = validatePisteCredentials,
  envFile = pisteEnvFile(),
} = {}) {
  if (session) return session.url;
  session = {
    token: crypto.randomBytes(16).toString('hex'),
    lastSeen: 0,
    window: null,
    windowClosed: false,
    state: {
      title: `Installation de ${PRODUCT_NAME}`,
      version,
      step: 'Démarrage…',
      detail: '',
      current: 0,
      total: ESTIMATED_STEPS,
      state: 'running',
      error: '',
    },
    piste: { offered: offerPiste, skipped: false, validate, envFile },
  };
  session.server = http.createServer((request, response) => {
    route(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise((resolve) => session.server.listen(0, '127.0.0.1', resolve));
  session.server.unref();
  session.url = `http://127.0.0.1:${session.server.address().port}/${session.token}/`;
  if (launch) {
    try {
      launchWindow(session.url);
    } catch (error) {
      process.stderr.write(`Fenêtre d'installation indisponible (${error.message}).\n`);
    }
  }
  return session.url;
}

export function noteProgress({ step, detail, increment } = {}) {
  const state = session?.state;
  if (!state || state.state !== 'running') return;
  if (increment) {
    state.current += 1;
    if (state.current >= state.total) state.total = state.current + 1;
    state.detail = '';
  }
  if (step) state.step = step;
  if (detail !== undefined) state.detail = detail;
}

export function finishProgress({ ok, message, error } = {}) {
  const state = session?.state;
  if (!state) return;
  state.current = state.total;
  if (ok) {
    state.state = 'done';
    state.step = message || `${PRODUCT_NAME} est installé.`;
    state.detail = '';
    state.error = '';
  } else {
    state.state = 'failed';
    state.step = 'Installation interrompue';
    state.error = error || "L'installation a échoué.";
    state.detail = state.error;
  }
}

function pisteStillExpected() {
  const piste = pisteState();
  return piste.offered && !piste.configured && !piste.skipped;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function settleProgressWindow({ pollMs = 500 } = {}) {
  if (!session) return;
  if (session.state.state === 'done' && pisteStillExpected() && windowAlive()) {
    console.log("\nDernière étape : configurez l'accès Légifrance et Judilibre dans la fenêtre PieceMaker (ou fermez-la pour le faire plus tard).");
    while (pisteStillExpected() && windowAlive()) await delay(pollMs);
  }
  if (windowAlive()) await delay(FINAL_STATE_DELAY_MS);
  if (session.state.state === 'done') session.window?.kill();
  session.server.close();
  session.server.closeAllConnections();
  session = null;
}
