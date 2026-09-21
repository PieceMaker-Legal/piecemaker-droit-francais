/**
 * Client HTTP de la conversion PieceMaker.
 *
 * La conversion et l'analyse PII n'ont qu'un seul point d'entrée : la route
 * `knowledge/scan` du serveur applicatif. Le CLI en est un client, sur la
 * boucle locale, via le montage `/api/piecemaker/local` placé avant
 * l'authentification. Le serveur applicatif écoute en clair sur le port du
 * CLI (`PIECEMAKER_APP_PORT`, 3003 par défaut) : aucun certificat n'entre en
 * jeu et la requête ne sort jamais de 127.0.0.1.
 */

import http from 'node:http';

const LOCAL_BASE = '/api/piecemaker/local';

export function appServerPort() {
  const parsed = Number.parseInt(process.env.PIECEMAKER_APP_PORT || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3003;
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

export function readLocalScanJob({ folder, id }) {
  const query = new URLSearchParams({ folder, ...(id ? { id } : {}) });
  return requestJson({ method: 'GET', path: `${LOCAL_BASE}/scan/job?${query}` });
}
