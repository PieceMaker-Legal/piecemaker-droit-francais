#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { ROOT, PAGE, buildGraph, applyEdit, commitChanges, status } from './graph.mjs';

const port = Number(process.env.CARTE_OUTILS_PORT || 4785);
const token = crypto.randomBytes(16).toString('hex');
const page = path.join(ROOT, PAGE);

const headers = (type) => ({
  'content-type': type,
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-private-network': 'true',
});

const send = (res, code, type, body) => {
  res.writeHead(code, headers(type));
  res.end(body);
};
const json = (res, code, value) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(value));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2e6) reject(new Error('Requête trop volumineuse.'));
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

function livePage() {
  const html = fs.readFileSync(page, 'utf8');
  return html.replace('<script id="live-config" type="application/json">{}</script>', `<script id="live-config" type="application/json">${JSON.stringify({ token })}</script>`);
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'OPTIONS') return send(res, 204, 'text/plain', '');
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) return send(res, 200, 'text/html; charset=utf-8', livePage());
    if (req.method === 'GET' && pathname === '/api/graph') return json(res, 200, buildGraph(ROOT, { live: true }));
    if (req.method === 'GET' && pathname === '/api/status') return json(res, 200, status());
    if (req.method !== 'POST') return json(res, 404, { error: 'Introuvable.' });
    if (req.headers['x-carte-token'] !== token) return json(res, 403, { error: 'Écriture réservée à la page servie par npm run carte-outils.' });
    const body = await readBody(req);
    if (pathname === '/api/instruction') {
      if (typeof body.id !== 'string' || typeof body.lu !== 'string') return json(res, 400, { error: 'id et lu attendus.' });
      const result = applyEdit(ROOT, body.id, body.lu, body.expected);
      return json(res, 200, { ok: true, ...result, status: status() });
    }
    if (pathname === '/api/commit') {
      return json(res, 200, { ok: true, ...commitChanges(ROOT, typeof body.message === 'string' ? body.message : ''), status: status() });
    }
    return json(res, 404, { error: 'Introuvable.' });
  } catch (error) {
    return json(res, 400, { ok: false, error: error.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`Carte des outils : ${url}`);
  if (!process.argv.includes('--no-open') && !process.env.CI) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    execFile(opener, [url], () => {});
  }
});
