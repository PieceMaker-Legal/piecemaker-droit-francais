import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ProviderRuntimeContext, NormalizedMessage } from '@/shared/types.js';

import { createMistralHistory } from './history.js';
import { createMistralSdkRuntime } from './runtime.js';
import type { createMistralTools } from './tools.js';
import type { mistralSdkAuth } from './auth.service.js';

const context: ProviderRuntimeContext = {
  resolveProviderSessionId: id => id ?? null,
  resolveResumeModel: async (_id, model) => model || 'mistral-small-latest',
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'mistral-small-latest' }),
  normalizeMessage: () => [], isProviderInstalled: async () => true,
};

async function setup(t: TestContext) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mistral-runtime-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return { home, history: createMistralHistory(home) };
}

function fixtureTools(execute: (input: Record<string, unknown>) => Promise<string>, readOnly = true) {
  return (async () => ({
    instructions: 'Skills disponibles : fictitious-skill', close: async () => {},
    tools: new Map([['probe', { name: 'probe', readOnly, execute, definition: { type: 'function' as const, function: { name: 'probe', parameters: { type: 'object' } } } }]]),
  })) satisfies typeof createMistralTools;
}

function fixtureClient(replies: Array<Array<unknown>>, requests: unknown[] = []) {
  return () => ({ client: { chat: { stream: async (request: unknown) => {
    requests.push(structuredClone(request));
    const reply = replies.shift()!;
    return (async function* () { for (const delta of reply) yield { data: { choices: [{ delta }] } }; })();
  } } }, close: async () => {} }) as unknown as ReturnType<typeof mistralSdkAuth.createClient>;
}

test('streamed tool fragments execute once and persisted history resumes after a runtime restart', async t => {
  const { home, history } = await setup(t);
  const events: NormalizedMessage[] = [];
  const requests: unknown[] = [];
  let executions = 0;
  const tools = fixtureTools(async input => { executions++; assert.equal(input.value, 'alpha'); return 'preuve fictive'; });
  const auth = fixtureClient([
    [{ toolCalls: [{ index: 0, id: 'abcdef123', function: { name: 'probe', arguments: '{"value":' } }] }, { toolCalls: [{ index: 0, function: { arguments: '"alpha"}' } }] }],
    [{ content: 'Réponse ' }, { content: 'vérifiée.' }],
    [{ content: 'Conversation reprise.' }],
  ], requests);
  const writer = { userId: 1, send: (event: unknown) => events.push(event as NormalizedMessage) };
  await createMistralSdkRuntime(history, async () => [], home, auth, tools).run('Vérifier alpha', { sessionId: 'mistral-sdk-example' }, writer, context);
  assert.equal(executions, 1);
  assert.equal(events.filter(event => event.kind === 'complete').length, 1);
  assert.equal(events.filter(event => event.kind === 'stream_delta').map(event => event.content).join(''), 'Réponse vérifiée.');
  const record = await history.load('mistral-sdk-example');
  assert.equal(record?.transcript.at(-1)?.content, 'Réponse vérifiée.');
  await createMistralSdkRuntime(history, async () => [], home, auth, tools).run('Continuer', { sessionId: 'mistral-sdk-example' }, writer, context);
  assert.ok(JSON.stringify(requests.at(-1)).includes('preuve fictive'));
  assert.ok(JSON.stringify(requests.at(-1)).includes('Vérifier alpha'));
  await assert.rejects(createMistralSdkRuntime(history, async () => [], home, auth, tools).run('autre utilisateur', { sessionId: 'mistral-sdk-example' }, { ...writer, userId: 2 }, context), /autre utilisateur/);
  assert.equal((await history.load('mistral-sdk-example'))?.userId, 1);
});

test('a denied permission prevents execution and remains visible in the tool result', async t => {
  const { home, history } = await setup(t);
  let executions = 0;
  const events: NormalizedMessage[] = [];
  const runtime = createMistralSdkRuntime(history, async () => [], home, fixtureClient([
    [{ toolCalls: [{ id: 'abcdef123', function: { name: 'probe', arguments: '{}' } }] }], [{ content: 'Refus respecté.' }],
  ]), fixtureTools(async () => { executions++; return 'unexpected'; }, false));
  await runtime.run('tester', { sessionId: 'mistral-sdk-permission' }, {
    userId: 1, send(event) {
      const message = event as NormalizedMessage;
      events.push(message);
      if (message.kind === 'permission_request') runtime.permissions!.resolve(message.requestId!, { allow: false, message: 'Refus de test.' });
    },
  }, context);
  assert.equal(executions, 0);
  assert.ok(events.some(event => event.toolResult?.content === 'Refus de test.'));
  assert.deepEqual(runtime.permissions!.listPending('mistral-sdk-permission'), []);
});

test('plan mode hides writes and rejects an unsolicited write call', async t => {
  const { home, history } = await setup(t);
  let executions = 0;
  const requests: unknown[] = [];
  const runtime = createMistralSdkRuntime(history, async () => [], home, fixtureClient([
    [{ toolCalls: [{ id: 'abcdef123', function: { name: 'probe', arguments: '{}' } }] }], [{ content: 'Plan seulement.' }],
  ], requests), fixtureTools(async () => { executions++; return ''; }, false));
  await runtime.run('planifier', { sessionId: 'mistral-sdk-plan', permissionMode: 'plan' }, { userId: 1, send() {} }, context);
  assert.equal(executions, 0);
  assert.equal((requests[0] as { tools?: unknown }).tools, undefined);
});

test('abort cancels a pending approval, emits one completion and leaves a resumable transcript', async t => {
  const { home, history } = await setup(t);
  const events: NormalizedMessage[] = [];
  let executions = 0;
  const runtime = createMistralSdkRuntime(history, async () => [], home, fixtureClient([
    [{ toolCalls: [{ id: 'abcdef123', function: { name: 'probe', arguments: '{}' } }] }],
  ]), fixtureTools(async () => { executions++; return ''; }, false));
  await runtime.run('tester', { sessionId: 'mistral-sdk-abort' }, {
    userId: 1, send(event) {
      const message = event as NormalizedMessage;
      events.push(message);
      if (message.kind === 'permission_request') runtime.abort('mistral-sdk-abort');
    },
  }, context);
  assert.equal(executions, 0);
  assert.equal(events.filter(event => event.kind === 'complete').length, 1);
  assert.equal(events.at(-1)?.aborted, true);
  assert.equal((await history.load('mistral-sdk-abort'))?.messages.at(-1)?.role, 'tool');
  assert.deepEqual(runtime.permissions!.listPending('mistral-sdk-abort'), []);
});

test('reasoning fragments retain their signature in the resumed SDK message', async t => {
  const { home, history } = await setup(t);
  const events: NormalizedMessage[] = [];
  const runtime = createMistralSdkRuntime(history, async () => [], home, fixtureClient([[
    { content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'Réflexion ' }] }] },
    { content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'fictive.' }], signature: 'fictitious-signature', closed: true }] },
    { content: 'Réponse fictive.' },
  ]]), fixtureTools(async () => ''));
  await runtime.run('tester', { sessionId: 'mistral-sdk-thinking' }, { userId: 1, send: event => events.push(event as NormalizedMessage) }, context);
  assert.equal(events.filter(event => event.kind === 'thinking').at(-1)?.content, 'Réflexion fictive.');
  const record = await history.load('mistral-sdk-thinking');
  const answer = record?.messages.at(-1)?.content;
  assert.ok(Array.isArray(answer));
  const thought = answer.find(chunk => chunk.type === 'thinking');
  assert.equal(thought && 'signature' in thought ? thought.signature : null, 'fictitious-signature');
});
