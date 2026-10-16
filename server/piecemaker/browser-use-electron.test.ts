import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';
import { appConfigDb } from '@/modules/database/index.js';
import { providerMcpService } from '@/modules/providers/index.js';

afterEach(() => {
  mock.restoreAll();
});

test('exception CloudCLI : PieceMaker n\'installe pas cloudcli-browser dans les providers', async () => {
  mock.method(appConfigDb, 'get', () => 'jeton-test');
  const add = mock.method(providerMcpService, 'addMcpServerToAllProviders', async () => []);
  const remove = mock.method(providerMcpService, 'removeMcpServerFromAllProviders', async () => []);
  await browserUseService.registerAgentMcp();
  assert.equal(add.mock.calls.length, 0);
  assert.ok(remove.mock.calls.length >= 1);
});
