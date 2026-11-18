import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ProviderRuntimeContext, NormalizedMessage } from '@/shared/types.js';

import { createMistralHistory } from './history.js';
import { createMistralSdkFork, createMistralSdkRuntime } from './runtime.js';
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

function fixtureTools(execute: (input: Record<string, unknown>) => Promise<string>, readOnly = true, turnEnd = async () => '') {
  return (async () => ({
    instructions: 'Skills disponibles : fictitious-skill', close: async () => {}, turnEnd,
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

test('the turn goes on once when the turn-end report still lists errors', async t => {
  const { home, history } = await setup(t);
  const requests: unknown[] = [];
  const reports = ['End of turn stopped by Le Hérisson: 1 check(s)'];
  const tools = fixtureTools(async () => '', true, async () => reports.shift() ?? '');
  const auth = fixtureClient([[{ content: 'Terminé.' }], [{ content: 'Corrigé.' }]], requests);
  await createMistralSdkRuntime(history, async () => [], home, auth, tools).run('Écrire le suivi', { sessionId: 'mistral-sdk-fin-de-tour' }, { userId: 1, send() {} } as never, context);
  assert.equal(requests.length, 2);
  assert.ok(JSON.stringify(requests[1]).includes('End of turn stopped by Le Hérisson'));
  assert.equal((await history.load('mistral-sdk-fin-de-tour'))?.transcript.at(-1)?.content, 'Corrigé.');
});

test('the client turn limit counts model calls, also when it arrives as text', async t => {
  const { home, history } = await setup(t);
  const requests: unknown[] = [];
  const call = [{ toolCalls: [{ id: 'abcdef123', function: { name: 'probe', arguments: '{}' } }] }];
  const auth = fixtureClient([call, call, call, call], requests);
  await assert.rejects(
    createMistralSdkRuntime(history, async () => [], home, auth, fixtureTools(async () => '')).run('boucler', { sessionId: 'mistral-sdk-tours', maxTurns: '3' }, { userId: 1, send() {} } as never, context),
    /Limite de tours Mistral atteinte/,
  );
  assert.equal(requests.length, 3);
});

test('an exhausted Mistral budget is shown and kept in the session history', async t => {
  const { home, history } = await setup(t);
  const events: NormalizedMessage[] = [];
  const billing = Object.assign(new Error('API error occurred: Status 402'), { statusCode: 402, body: '{"message":"Budget fictif épuisé.","code":"2304"}' });
  const auth = () => ({ client: { chat: { stream: async () => { throw billing; } } }, close: async () => {} }) as unknown as ReturnType<typeof mistralSdkAuth.createClient>;
  await assert.rejects(
    createMistralSdkRuntime(history, async () => [], home, auth, fixtureTools(async () => '')).run('bonjour', { sessionId: 'mistral-sdk-budget' }, { userId: 1, send: event => events.push(event as NormalizedMessage) }, context),
    /Status 402/,
  );
  const expected = 'Your Mistral credit or budget is exhausted (HTTP 402): Budget fictif épuisé. Top up your Mistral account, then send the message again.';
  assert.equal(events.find(event => event.kind === 'error')?.content, expected);
  const saved = (await history.load('mistral-sdk-budget'))?.transcript.at(-1);
  assert.deepEqual([saved?.kind, saved?.content], ['error', expected]);
});

test('a fork copies the whole conversation and answers apart from its source', async t => {
  const { home, history } = await setup(t);
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  const runtime = createMistralSdkRuntime(history, async () => [], home, fixtureClient([[{ content: 'première réponse' }], [{ content: 'réponse annexe' }]], requests), fixtureTools(async () => ''));
  const writer = { send() {}, setSessionId() {}, userId: 1 } as never;
  await runtime.run('première question', { sessionId: 'source' }, writer, context);
  const source = await history.load('source');

  const forked = await createMistralSdkFork(history).forkSession({ providerSessionId: 'source', jsonlPath: '', projectPath: home });

  assert.match(forked.providerSessionId, /^mistral-sdk-/);
  await fs.access(forked.jsonlPath);
  assert.deepEqual(await history.load(forked.providerSessionId), source);

  await runtime.run('question annexe', { sessionId: forked.providerSessionId }, writer, context);

  assert.deepEqual(requests[1].messages.slice(1).map(message => message.role), ['user', 'assistant', 'user']);
  assert.deepEqual(await history.load('source'), source);
});

test('a conversation without an SDK record cannot be forked', async t => {
  const { history } = await setup(t);
  await assert.rejects(
    () => createMistralSdkFork(history).forkSession({ providerSessionId: 'ancienne-session', jsonlPath: '', projectPath: '' }),
    (error: Error & { code?: string }) => error.code === 'FORK_SOURCE_NOT_READY',
  );
});

test('every tool is auto-approved: no permission prompt, execution happens', async t => {
  const { home, history } = await setup(t);
  let executions = 0;
  const events: NormalizedMessage[] = [];
  const runtime = createMistralSdkRuntime(history, async () => [], home, fixtureClient([
    [{ toolCalls: [{ id: 'abcdef123', function: { name: 'probe', arguments: '{}' } }] }], [{ content: 'Exécuté.' }],
  ]), fixtureTools(async () => { executions++; return 'résultat fictif'; }, false));
  await runtime.run('tester', { sessionId: 'mistral-sdk-auto-approve' }, { userId: 1, send: event => events.push(event as NormalizedMessage) }, context);
  assert.equal(executions, 1);
  assert.ok(!events.some(event => event.kind === 'permission_request'));
  assert.ok(events.some(event => event.toolResult?.content === 'résultat fictif'));
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

test('abort during a tool call emits one completion and leaves a resumable transcript', async t => {
  const { home, history } = await setup(t);
  const events: NormalizedMessage[] = [];
  let executions = 0;
  const runtime = createMistralSdkRuntime(history, async () => [], home, fixtureClient([
    [{ toolCalls: [{ id: 'abcdef123', function: { name: 'probe', arguments: '{}' } }] }],
  ]), fixtureTools(async () => { executions++; runtime.abort('mistral-sdk-abort'); return 'interrompu'; }, false));
  await runtime.run('tester', { sessionId: 'mistral-sdk-abort' }, { userId: 1, send: event => events.push(event as NormalizedMessage) }, context);
  assert.equal(executions, 1);
  assert.equal(events.filter(event => event.kind === 'complete').length, 1);
  assert.equal(events.at(-1)?.aborted, true);
  assert.equal((await history.load('mistral-sdk-abort'))?.messages.at(-1)?.role, 'tool');
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
