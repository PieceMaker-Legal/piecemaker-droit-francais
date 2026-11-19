import assert from 'node:assert/strict';
import test from 'node:test';

import { createOrchestratorProviderStatuses } from '../orchestrator-providers.js';

test('Le statut Mistral suit le compte SDK et une reconnexion Claude apparaît au prochain contrôle', async () => {
  let connected = false;
  const providers = createOrchestratorProviderStatuses(
    async provider => ({ installed: true, authenticated: provider === 'codex' || connected }),
    userId => ({ authenticated: userId === 7 }),
  );
  assert.deepEqual((await providers(7)).map(status => status.authenticated), [false, true, true]);
  connected = true;
  assert.deepEqual((await providers(8)).map(status => status.authenticated), [true, true, false]);
  assert.equal((await providers(null)).find(status => status.provider === 'mistral')?.authenticated, false);
});

test('Une sonde en erreur laisse les autres statuts disponibles et réussit au contrôle suivant', async () => {
  let failing = true;
  const providers = createOrchestratorProviderStatuses(
    async provider => {
      if (failing && provider === 'claude') throw new Error('Sonde CLI indisponible');
      return { installed: true, authenticated: true };
    },
    () => {
      if (failing) throw new Error('Sonde Mistral indisponible');
      return { authenticated: true };
    },
  );
  assert.deepEqual(await providers(7), [
    { provider: 'claude', installed: false, authenticated: false },
    { provider: 'codex', installed: true, authenticated: true },
    { provider: 'mistral', installed: false, authenticated: false },
  ]);
  failing = false;
  assert.deepEqual(await providers(7), [
    { provider: 'claude', installed: true, authenticated: true },
    { provider: 'codex', installed: true, authenticated: true },
    { provider: 'mistral', installed: true, authenticated: true },
  ]);
});
