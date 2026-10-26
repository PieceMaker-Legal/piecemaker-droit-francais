import assert from 'node:assert/strict';
import test from 'node:test';

import { createMistralSdkAuthService } from './auth.service.js';

function credentialStore() {
  const rows = new Map<number, { user: number; name: string; type: string; value: string }>();
  let nextId = 0;
  return {
    getActiveCredential(user: number, type: string) {
      return [...rows.values()].find(row => row.user === user && row.type === type)?.value ?? null;
    },
    getCredentials(user: number, type: string | null = null) {
      return [...rows.entries()].filter(([, row]) => row.user === user && (!type || row.type === type)).map(([id, row]) => ({
        id, credential_name: row.name, credential_type: row.type, description: null, created_at: '2026-01-01', is_active: 1,
      }));
    },
    createCredential(user: number, name: string, type: string, value: string) {
      const id = ++nextId;
      rows.set(id, { user, name, type, value });
      return { id, credentialName: name, credentialType: type };
    },
    deleteCredential(user: number, id: number) {
      return rows.get(id)?.user === user && rows.delete(id);
    },
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('browser login persists per user and status never returns the SDK credential', async () => {
  const credentials = credentialStore();
  const service = createMistralSdkAuthService(credentials, async ({ openBrowser }) => {
    await openBrowser('https://console.mistral.ai/fictitious-login');
    return 'fictitious-private-key';
  });
  assert.equal(await service.startLogin(1), 'https://console.mistral.ai/fictitious-login');
  await flush();
  assert.equal(service.status(1).authenticated, true);
  assert.equal(service.status(2).authenticated, false);
  assert.ok(!JSON.stringify(service.status(1)).includes('fictitious-private-key'));
  assert.equal(createMistralSdkAuthService(credentials).status(1).authenticated, true);
  service.logout(1);
  assert.equal(service.status(1).authenticated, false);
});

test('cancelling login discards a late browser approval', async () => {
  let approve!: (key: string) => void;
  const service = createMistralSdkAuthService(credentialStore(), async ({ openBrowser }) => {
    await openBrowser('https://console.mistral.ai/fictitious-login');
    return new Promise<string>(resolve => { approve = resolve; });
  });
  await service.startLogin(1);
  await flush();
  service.logout(1);
  approve('fictitious-private-key');
  await flush();
  assert.equal(service.status(1).authenticated, false);
});

test('a repeated click reuses the pending login and an unsuccessful start stays disconnected', async () => {
  let calls = 0;
  const service = createMistralSdkAuthService(credentialStore(), async ({ openBrowser }) => {
    calls += 1;
    await openBrowser('https://console.mistral.ai/fictitious-login');
    return new Promise<string>(() => {});
  });
  await service.startLogin(1);
  await service.startLogin(1);
  assert.equal(calls, 1);
  const failed = createMistralSdkAuthService(credentialStore(), async () => { throw new Error('Essai refusé'); });
  await assert.rejects(failed.startLogin(1), /Essai refusé/);
  assert.equal(failed.status(1).authenticated, false);
  assert.equal(failed.status(1).loginState, 'error');
});
