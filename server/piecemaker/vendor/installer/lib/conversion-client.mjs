/**
 * Client HTTP de la conversion PieceMaker.
 *
 * La conversion et l'analyse PII n'ont qu'un seul point d'entrée : la route
 * `knowledge/scan` du serveur applicatif. Le CLI en est un client, sur la
 * boucle locale, via le montage `/api/piecemaker/local` placé avant
 * l'authentification. Le serveur applicatif écoute en clair sur la boucle
 * locale : celui qui tourne déjà (application de bureau comprise, annoncé par
 * `local-server.json` dans le dossier de données), sinon le port du CLI
 * (`PIECEMAKER_APP_PORT`, 3003 par défaut). Aucun certificat n'entre en jeu et
 * la requête ne sort jamais de 127.0.0.1.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { dirname, join } from 'node:path';

import { GIT_REPO_ROOT } from './platform.mjs';

const LOCAL_BASE = '/api/piecemaker/local';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::']);
const FALLBACK_DATA_DIRECTORY = '.piecemaker-droit-francais';

let adoptedHome = null;

export function appServerPort() {
  const parsed = Number.parseInt(process.env.PIECEMAKER_APP_PORT || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3003;
}

function productDataDirectoryName() {
  try {
    const config = JSON.parse(fs.readFileSync(join(GIT_REPO_ROOT, 'product.config.json'), 'utf8'));
    if (typeof config?.dataDirectoryName === 'string' && config.dataDirectoryName) return config.dataDirectoryName;
  } catch {}
  return FALLBACK_DATA_DIRECTORY;
}

export function runningServerMarkerPaths({ env = process.env, homedir = os.homedir } = {}) {
  if (env.CLOUDCLI_HOME) return [join(env.CLOUDCLI_HOME, 'local-server.json')];
  const name = productDataDirectoryName();
  return [...new Set([`${name}-dev`, name, '.piecemaker'])].map((dir) => join(homedir(), dir, 'local-server.json'));
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readLoopbackPort(markerPath) {
  if (!markerPath) return null;
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    const port = Number(marker?.port);
    if (!Number.isInteger(port) || port <= 0 || !LOOPBACK_HOSTS.has(marker?.host)) return null;
    return port;
  } catch {
    return null;
  }
}

export function runningServerPort(markerPath = runningServerMarkerPaths()[0]) {
  const port = readLoopbackPort(markerPath);
  if (!port) return null;
  try {
    const pid = Number(JSON.parse(fs.readFileSync(markerPath, 'utf8'))?.pid);
    if (!Number.isInteger(pid) || pid <= 0 || !processAlive(pid)) return null;
    return port;
  } catch {
    return null;
  }
}

export function localServerReachable(port = appServerPort()) {
  return new Promise((resolve) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/api/auth/status', timeout: 2_000 }, (response) => {
      response.resume();
      resolve(response.statusCode < 500);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

export function adoptedServerHome() {
  return adoptedHome;
}

export async function adoptRunningServerPort({ markerPath, markerPaths, reachable = localServerReachable } = {}) {
  if (process.env.PIECEMAKER_APP_PORT) return appServerPort();
  adoptedHome = null;
  const paths = markerPath ? [markerPath] : (markerPaths ?? runningServerMarkerPaths());
  for (const candidate of paths) {
    const port = runningServerPort(candidate) ?? readLoopbackPort(candidate);
    if (!port) continue;
    if (await reachable(port)) {
      process.env.PIECEMAKER_APP_PORT = String(port);
      adoptedHome = dirname(candidate);
      return port;
    }
  }
  return appServerPort();
}

function requestJson({ method, path, body, timeout = 30_000 }) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: appServerPort(),
        path,
        method,
        timeout,
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            reject(new Error(`Réponse illisible du serveur PieceMaker (${response.statusCode}).`));
            return;
          }
          if (response.statusCode >= 400) {
            reject(new Error(parsed?.error || parsed?.erreur || `Le serveur PieceMaker a répondu ${response.statusCode}.`));
            return;
          }
          resolve(parsed);
        });
      }
    );
    request.on('timeout', () => request.destroy(new Error('Le serveur PieceMaker n’a pas répondu à temps.')));
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

export function startLocalScan({ folder, files }) {
  return requestJson({
    method: 'POST',
    path: `${LOCAL_BASE}/scan`,
    body: { folder, ...(files?.length ? { files } : {}) },
  });
}

export function renameLocalPiece({ folder, path: piecePath, name }) {
  return requestJson({
    method: 'POST',
    path: `${LOCAL_BASE}/rename`,
    body: { folder, path: piecePath, name },
  });
}

export async function runSql({ requete, cwd }) {
  await adoptRunningServerPort();
  const response = await requestJson({
    method: 'POST',
    path: `${LOCAL_BASE}/sql`,
    body: { requete, ...(cwd ? { cwd } : {}) },
  });
  return response.resultat;
}

export async function runReasoning(body) {
  await adoptRunningServerPort();
  const response = await requestJson({ method: 'POST', path: `${LOCAL_BASE}/reasoning`, body, timeout: 180_000 });
  return response.resultat;
}

export async function runDocxReasoning(body) {
  await adoptRunningServerPort();
  const response = await requestJson({ method: 'POST', path: `${LOCAL_BASE}/docx-reasoning`, body, timeout: 180_000 });
  return response.resultat;
}

export async function sessionDossier(session) {
  await adoptRunningServerPort();
  const response = await requestJson({ method: 'GET', path: `${LOCAL_BASE}/session-dossier?${new URLSearchParams({ session })}`, timeout: 5_000 });
  return response.dossier || null;
}

export async function runTabularReview(body) {
  await adoptRunningServerPort();
  const response = await requestJson({ method: 'POST', path: `${LOCAL_BASE}/tabular-review`, body });
  return response.resultat;
}

export async function requestPanelOpen(body) {
  await adoptRunningServerPort();
  return requestJson({ method: 'POST', path: `${LOCAL_BASE}/open-panel`, body });
}

export async function panelRequestCompleted({ project, id }) {
  await adoptRunningServerPort();
  const query = new URLSearchParams({ project, id });
  const response = await requestJson({ method: 'GET', path: `${LOCAL_BASE}/open-panel?${query}` });
  return response.completed === true;
}

export async function acknowledgePanelRequest({ project, id }) {
  await adoptRunningServerPort();
  const response = await requestJson({
    method: 'POST',
    path: `${LOCAL_BASE}/open-panel/ack`,
    body: { project, id },
  });
  return response.acknowledged === true;
}

export async function requestPanelClose(body) {
  await adoptRunningServerPort();
  return requestJson({ method: 'POST', path: `${LOCAL_BASE}/close-panel`, body });
}

export async function panelCloseCompleted({ project, id }) {
  await adoptRunningServerPort();
  const query = new URLSearchParams({ project, id });
  const response = await requestJson({ method: 'GET', path: `${LOCAL_BASE}/close-panel?${query}` });
  return response.completed === true;
}

export function readLocalScanJob({ folder, id }) {
  const query = new URLSearchParams({ folder, ...(id ? { id } : {}) });
  return requestJson({ method: 'GET', path: `${LOCAL_BASE}/scan/job?${query}` });
}
