import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';

import { browserUseService } from '@/modules/browser-use/browser-use.service.js';
import { appConfigDb } from '@/modules/database/index.js';
import { providerMcpService } from '@/modules/providers/index.js';

const originalElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;

afterEach(() => {
  mock.restoreAll();
  if (originalElectronRunAsNode === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
  else process.env.ELECTRON_RUN_AS_NODE = originalElectronRunAsNode;
});

async function registeredMcpEnv() {
  mock.method(appConfigDb, 'get', () => 'jeton-test');
  mock.method(providerMcpService, 'removeMcpServerFromAllProviders', async () => []);
  const add = mock.method(providerMcpService, 'addMcpServerToAllProviders', async () => []);
  await browserUseService.registerAgentMcp();
  return add.mock.calls[0].arguments[0].env;
}

test('exception CloudCLI : le MCP navigateur de l\'app de bureau tourne en Node, sans relancer l\'app', async () => {
  process.env.ELECTRON_RUN_AS_NODE = '1';
  assert.equal((await registeredMcpEnv()).ELECTRON_RUN_AS_NODE, '1');
});

test('hors app de bureau, le MCP navigateur garde l\'environnement d\'upstream', async () => {
  delete process.env.ELECTRON_RUN_AS_NODE;
  assert.equal('ELECTRON_RUN_AS_NODE' in (await registeredMcpEnv()), false);
});
