import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const FAKE_AGENT = `#!/usr/bin/env node
const readline = require('node:readline');
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
const sessionId = 'provider-session-1';
let promptId = null;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: { agentCapabilities: { loadSession: true } } });
  if (message.method === 'session/new') send({ id: message.id, result: { sessionId } });
  if (message.method === 'session/load') send({ id: message.id, result: { sessionId: message.params.sessionId } });
  if (message.method === 'session/prompt') {
    promptId = message.id;
    send({ id: 900, method: 'session/request_permission', params: { sessionId, toolCall: { title: 'write' }, options: [{ optionId: 'ok', kind: 'allow_once' }] } });
  }
  if (message.id === 900) send({ id: promptId, result: { stopReason: message.result.outcome.optionId } });
});
`;

const directory = mkdtempSync(path.join(os.tmpdir(), 'hermes-runtime-'));
const agentPath = path.join(directory, 'fake-acp');
writeFileSync(agentPath, FAKE_AGENT);
chmodSync(agentPath, 0o755);
process.env.HERMES_CLI_PATH = agentPath;

const { hermesConnectionManager } = await import('@/modules/providers/list/hermes/hermes-acp-client.js');
const { hermesRuntime } = await import('@/modules/providers/list/hermes/hermes-runtime.provider.js');

after(() => {
  hermesConnectionManager.closeAll();
  rmSync(directory, { recursive: true, force: true });
});

type Sent = { kind?: string; requestId?: string; newSessionId?: string; sessionId?: string; exitCode?: number };

function runTurn(providerSessionId: string | null, answer: (requestId: string) => unknown = (requestId) => hermesRuntime.permissions.resolve(requestId, { allow: true })) {
  const sent: Sent[] = [];
  const pendingAtRequest: unknown[] = [];
  let announced: string | null = null;
  const writer = {
    send(message: Sent) {
      sent.push(message);
      if (message.kind === 'permission_request' && message.requestId) {
        const { requestId } = message;
        setImmediate(() => {
          pendingAtRequest.push(...hermesRuntime.permissions.listPending('app-session-1'));
          answer(requestId);
        });
      }
    },
    setSessionId(id: string) {
      announced = id;
    },
  };
  const context = {
    resolveProviderSessionId: () => providerSessionId,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
  };
  const done = hermesRuntime.run('bonjour', { sessionId: 'app-session-1', cwd: directory }, writer, context);
  return { sent, done, pendingAtRequest, announced: () => announced };
}

test('a first turn announces the provider session and answers the permission', async () => {
  const turn = runTurn(null);
  await turn.done;
  assert.equal(turn.announced(), 'provider-session-1');
  assert.equal(turn.sent.find((message) => message.kind === 'session_created')?.newSessionId, 'provider-session-1');
  assert.equal(turn.sent.find((message) => message.kind === 'complete')?.exitCode, 0);
  assert.equal(turn.pendingAtRequest.length, 1);
  assert.deepEqual(hermesRuntime.permissions.listPending('app-session-1'), []);
});

test('a resumed turn reuses the provider session without announcing a new one', async () => {
  const turn = runTurn('provider-session-1');
  await turn.done;
  assert.equal(turn.sent.some((message) => message.kind === 'session_created'), false);
  assert.equal(turn.sent.find((message) => message.kind === 'complete')?.exitCode, 0);
});

test('aborting by the app session cancels the pending permission and the run', async () => {
  let aborted: Promise<boolean> | undefined;
  const turn = runTurn('provider-session-1', () => {
    aborted = hermesRuntime.abort('app-session-1');
  });
  await turn.done;
  assert.equal(await aborted, true);
  assert.equal(turn.pendingAtRequest.length, 1);
  assert.deepEqual(hermesRuntime.permissions.listPending('app-session-1'), []);
  assert.equal(await hermesRuntime.abort('app-session-1'), false);
});

test('aborting an unknown session reports nothing to stop', async () => {
  assert.equal(await hermesRuntime.abort('unknown-session'), false);
});
