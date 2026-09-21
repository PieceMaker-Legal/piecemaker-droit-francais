/**
 * Client HTTP de la conversion PieceMaker.
 *
 * La conversion et l'analyse PII n'ont qu'un seul point d'entrée : la route
 * `knowledge/scan` du serveur. Le CLI en est un client, sur la boucle locale,
 * via le montage `/api/piecemaker/local` placé avant l'authentification. Le
 * certificat du serveur est auto-signé : `rejectUnauthorized` est désactivé
 * comme dans `probeServer`, et la requête ne sort jamais de 127.0.0.1.
 */

import https from 'node:https';

const LOCAL_BASE = '/api/piecemaker/local';

function serverPort(config) {
  return Number(config?.port) || 43098;
}

function requestJson(config, { method, path, body }) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: '127.0.0.1',
        port: serverPort(config),
        path,
        method,
        rejectUnauthorized: false,
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

export function startLocalScan(config, { folder, files }) {
  return requestJson(config, {
    method: 'POST',
    path: `${LOCAL_BASE}/scan`,
    body: { folder, ...(files?.length ? { files } : {}) },
  });
}

export function readLocalScanJob(config, { folder, id }) {
  const query = new URLSearchParams({ folder, ...(id ? { id } : {}) });
  return requestJson(config, { method: 'GET', path: `${LOCAL_BASE}/scan/job?${query}` });
}
