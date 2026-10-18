import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createSessionDossierRouter } from '../session-dossier-routes.js';

test('renvoie le dossier de la session par son identifiant fournisseur ou applicatif', async () => {
  const rows: Record<string, { project_path: string }> = { 'claude-1': { project_path: '/dossiers/Dupont' } };
  const app = express().use(createSessionDossierRouter({
    getSessionByProviderSessionId: (id) => rows[id] ?? null,
    getSessionById: (id) => (id === 'app-1' ? { project_path: '/dossiers/Exemple' } : null),
  }, () => true));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/session-dossier`;
  try {
    assert.deepEqual(await (await fetch(`${base}?session=claude-1`)).json(), { dossier: '/dossiers/Dupont' });
    assert.deepEqual(await (await fetch(`${base}?session=app-1`)).json(), { dossier: '/dossiers/Exemple' });
    assert.deepEqual(await (await fetch(`${base}?session=inconnue`)).json(), { dossier: null });
  } finally {
    server.close();
  }
});
