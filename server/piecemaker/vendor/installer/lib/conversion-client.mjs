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
import { join } from 'node:path';

import { GIT_REPO_ROOT } from './platform.mjs';

const LOCAL_BASE = '/api/piecemaker/local';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::']);

export function appServerPort() {
  const parsed = Number.parseInt(process.env.PIECEMAKER_APP_PORT || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3003;
}

function runningServerMarkerPath() {
  if (process.env.CLOUDCLI_HOME) return join(process.env.CLOUDCLI_HOME, 'local-server.json');
  try {
    const config = JSON.parse(fs.readFileSync(join(GIT_REPO_ROOT, 'product.config.json'), 'utf8'));
    return join(os.homedir(), config.dataDirectoryName, 'local-server.json');
  } catch {
    return null;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function runningServerPort(markerPath = runningServerMarkerPath()) {
  if (!markerPath) return null;
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    const port = Number(marker?.port);
    const pid = Number(marker?.pid);
    if (!Number.isInteger(port) || port <= 0 || !LOOPBACK_HOSTS.has(marker?.host)) return null;
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

export async function adoptRunningServerPort({ markerPath, reachable = localServerReachable } = {}) {
  if (process.env.PIECEMAKER_APP_PORT) return appServerPort();
  const port = runningServerPort(markerPath);
  if (port && await reachable(port)) process.env.PIECEMAKER_APP_PORT = String(port);
  return appServerPort();
}

function requestJson({ method, path, body }) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: appServerPort(),
        path,
        method,
        timeout: 30_000,
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
            reject(new Error(parsed?.error || `Le serveur PieceMaker a répondu ${response.statusCode}.`));
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

export function readLocalScanJob({ folder, id }) {
  const query = new URLSearchParams({ folder, ...(id ? { id } : {}) });
  return requestJson({ method: 'GET', path: `${LOCAL_BASE}/scan/job?${query}` });
}
