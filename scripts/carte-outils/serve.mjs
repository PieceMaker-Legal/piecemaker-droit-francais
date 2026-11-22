#!/usr/bin/env node
// Serveur local de la carte des outils : sert la page et relit le code à chaque requête.
// Écoute uniquement sur 127.0.0.1, car il écrit dans les fichiers du dépôt.
//
// Usage : npm run carte-outils   (puis ouvrir http://127.0.0.1:8765)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PAGE, buildGraph, applyEdit, commitChanges } from './graph.mjs';

const port = Number(process.env.CARTE_OUTILS_PORT || 8765);
const page = path.join(ROOT, PAGE);

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const json = (res, status, value) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) reject(new Error('Requête trop volumineuse.'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('JSON invalide.'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && pathname === '/') return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(page));
    if (req.method === 'GET' && pathname === '/api/graph') return json(res, 200, buildGraph());
    if (req.method === 'PUT' && pathname === '/api/instruction') {
      const { id, text } = await readBody(req);
      if (typeof id !== 'string' || typeof text !== 'string') return json(res, 400, { error: 'id et text attendus.' });
      return json(res, 200, { ok: true, ...applyEdit(ROOT, id, text) });
    }
    if (req.method === 'POST' && pathname === '/api/commit') {
      const { message } = await readBody(req);
      return json(res, 200, { ok: true, ...commitChanges(ROOT, typeof message === 'string' ? message : '') });
    }
    return json(res, 404, { error: 'Introuvable.' });
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Carte des outils : http://127.0.0.1:${port}`);
});
