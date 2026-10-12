import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createTabularReviewLocalRouter } from './tabular-review-assistant.js';

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

test('transmet l’action au plugin avec son secret et l’adresse du proxy', async (t) => {
  const received: Array<{ secret: unknown; body: Record<string, unknown> }> = [];
  const plugin = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      received.push({ secret: request.headers['x-plugin-secret-access'], body });
      response.end(JSON.stringify(body.action === 'lancer' ? { error: 'À compléter avant de lancer : documents.' } : { projet: 'p-1' }));
    });
  });
  const pluginPort = await listen(plugin);
  const app = express();
  app.use(express.json());
  app.use(createTabularReviewLocalRouter({ proxyOrigin: () => 'http://127.0.0.1:9', pluginPort: () => pluginPort, pluginSecrets: () => ({ ACCESS: 'secret-exemple' }) }));
  const server = http.createServer(app);
  const port = await listen(server);
  t.after(() => { server.close(); plugin.close(); });

  const call = (body: unknown) => fetch(`http://127.0.0.1:${port}/tabular-review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const prepared = await call({ action: 'preparer', project: '/dossier' });
  assert.equal(prepared.status, 200);
  assert.deepEqual(await prepared.json(), { resultat: { projet: 'p-1' } });
  assert.deepEqual(received[0], { secret: 'secret-exemple', body: { action: 'preparer', project: '/dossier', proxyOrigin: 'http://127.0.0.1:9' } });
  const refused = await call({ action: 'lancer' });
  assert.equal(refused.status, 400);
  assert.deepEqual(await refused.json(), { erreur: 'À compléter avant de lancer : documents.' });
});

test('signale un plugin arrêté', async (t) => {
  const app = express();
  app.use(express.json());
  app.use(createTabularReviewLocalRouter({ proxyOrigin: () => null, pluginPort: () => null, pluginSecrets: () => ({}) }));
  const server = http.createServer(app);
  const port = await listen(server);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${port}/tabular-review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 503);
});
