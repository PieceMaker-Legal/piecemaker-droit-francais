import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ProviderRuntimeContext, NormalizedMessage } from '@/shared/types.js';
import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { credentialsDb, userDb } from '@/modules/database/index.js';

import { createMistralHistory } from './history.js';
import { createMistralSdkFork, createMistralSdkRuntime, installMistralSdk, installMistralTokenUsage } from './runtime.js';
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
  const advertised = (requests[0] as { tools?: Array<{ function: { name: string } }> }).tools ?? [];
  assert.ok(!advertised.some(tool => tool.function.name === 'probe'));
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

test('a tool name in another case runs the tool and the answer ends with a final text like Claude', async t => {
  const { home, history } = await setup(t);
  const events: NormalizedMessage[] = [];
  let executions = 0;
  await createMistralSdkRuntime(history, async () => [], home, fixtureClient([
    [{ toolCalls: [{ id: 'abcdef123', function: { name: 'PROBE', arguments: '{}' } }] }], [{ content: 'Fait.' }],
  ]), fixtureTools(async () => { executions++; return 'ok'; })).run('tester', { sessionId: 'mistral-sdk-casse' }, { userId: 1, send: event => events.push(event as NormalizedMessage) }, context);
  assert.equal(executions, 1);
  const end = events.find(event => event.kind === 'stream_end');
  const text = events.find(event => event.kind === 'text' && event.role === 'assistant');
  assert.equal(text?.content, 'Fait.');
  assert.equal(text?.id, end?.id);
  assert.ok(events.indexOf(end!) < events.indexOf(text!));
});

test('stopping an executing tool delivers its result before abort returns and resumes all tool calls', async t => {
  const { history, home } = await setup(t);
  const sessionId = 'mistral-sdk-interruption';
  const events: NormalizedMessage[] = [];
  let start!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  let executions = 0;
  const tools: typeof createMistralTools = async (_cwd, _skills, signal) => fixtureTools(async () => {
    executions++;
    start();
    return new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  })();
  const requests: Array<{ messages: Array<{ role: string; toolCallId?: string; content: string }> }> = [];
  const runtime = createMistralSdkRuntime(history, async () => [], home, fixtureClient([
    [{ toolCalls: ['abcdef123', 'abcdef124'].map((id, index) => ({ id, index, function: { name: 'probe', arguments: '{}' } })) }],
    [{ content: 'Repris.' }],
  ], requests), tools);
  const writer = { userId: 1, send(event: unknown) { events.push(event as NormalizedMessage); } };
  const run = runtime.run('Vérifier', { sessionId }, writer, context);
  await started;
  assert.equal(await runtime.abort(sessionId), true);
  assert.equal(events.at(-1)?.kind, 'complete');
  await run;
  assert.equal(executions, 1);
  assert.deepEqual(events.filter(event => event.kind === 'complete').map(event => [event.aborted, event.exitCode]), [[true, 0]]);
  const results = events.filter(event => event.toolResult);
  assert.equal(results.length, 2);
  assert.deepEqual((await history.load(sessionId))?.transcript.at(-1), events.at(-1));
  assert.ok(results.every(event => event.toolResult?.isError && /interrompu/i.test(String(event.toolResult.content))));
  await runtime.run('Continuer', { sessionId }, writer, context);
  assert.deepEqual(requests[1].messages.filter(message => message.role === 'tool').map(message => [message.toolCallId, message.content]),
    results.map(event => [event.toolId, event.toolResult?.content]));
});

test('a subscription rejection shows the same readable error live and after reload', async t => {
  const { history, home } = await setup(t);
  const events: NormalizedMessage[] = [];
  const body = JSON.stringify({ message: 'This model is not available in your subscription tier', code: 'forbidden' });
  const auth = () => ({ client: { chat: { stream: async () => { throw Object.assign(new Error('Status 403. Body: ' + body), { statusCode: 403, body }); } } }, close: async () => {} }) as unknown as ReturnType<typeof mistralSdkAuth.createClient>;
  const runtime = createMistralSdkRuntime(history, async () => [], home, auth, fixtureTools(async () => ''));
  const sessionId = 'mistral-sdk-abonnement';
  await assert.rejects(runtime.run('Bonjour', { sessionId }, { userId: 1, send: event => events.push(event as NormalizedMessage) }, context),
    (error: Error) => /abonnement/.test(error.message) && !error.message.includes('{'));
  const content = events.find(event => event.kind === 'error')?.content;
  assert.match(content ?? '', /abonnement/);
  assert.equal((await history.load(sessionId))?.transcript.at(-1)?.content, content);
});

test('an interrupted stream closes and retains the partial assistant text for the next turn', async t => {
  const { history, home } = await setup(t);
  const events: NormalizedMessage[] = [];
  const sessionId = 'mistral-sdk-partiel';
  const runtime = createMistralSdkRuntime(history, async () => [], home, fixtureClient([[{ content: 'Début.' }, { content: 'Suite.' }]]), fixtureTools(async () => ''));
  await runtime.run('Commencer', { sessionId }, { userId: 1, send(event) {
    const message = event as NormalizedMessage;
    events.push(message);
    if (message.kind === 'stream_delta') void runtime.abort(sessionId);
  } }, context);
  assert.deepEqual(events.map(event => event.kind), ['stream_delta', 'stream_end', 'text', 'complete']);
  assert.equal(events.at(-2)?.content, 'Début.');
  const record = await history.load(sessionId);
  assert.deepEqual(record?.messages.at(-1), { role: 'assistant', content: 'Début.' });
  assert.equal(record?.transcript.find(event => event.kind === 'text' && event.role === 'assistant')?.content, 'Début.');
});

test('an invalid model name shows a readable error instead of the raw API body', async t => {
  const { history, home } = await setup(t);
  const events: NormalizedMessage[] = [];
  const body = JSON.stringify({ object: 'error', message: 'Invalid model: modele-fictif', type: 'invalid_model' });
  const auth = () => ({ client: { chat: { stream: async () => { throw Object.assign(new Error('Status 400. Body: ' + body), { statusCode: 400, body }); } } }, close: async () => {} }) as unknown as ReturnType<typeof mistralSdkAuth.createClient>;
  const runtime = createMistralSdkRuntime(history, async () => [], home, auth, fixtureTools(async () => ''));
  await assert.rejects(runtime.run('Bonjour', { sessionId: 'mistral-sdk-modele' }, { userId: 1, send: event => events.push(event as NormalizedMessage) }, context),
    (error: Error) => /ne connaît pas ce modèle/.test(error.message) && !error.message.includes('{'));
  assert.match(events.find(event => event.kind === 'error')?.content ?? '', /Choisissez un modèle Mistral/);
});

test('le compteur Mistral montre le contexte du dernier appel sur la fenêtre du modèle', async t => {
  const { home, history } = await setup(t);
  const events: NormalizedMessage[] = [];
  const auth = () => ({ client: {
    models: { retrieve: async ({ modelId }: { modelId: string }) => ({ id: modelId, maxContextLength: 256_000 }) },
    chat: { stream: async () => (async function* () {
      yield { data: { choices: [{ delta: { content: 'Réponse.' } }] } };
      yield { data: { choices: [{ delta: {} }], usage: { promptTokens: 41_000, completionTokens: 900, totalTokens: 41_900 } } };
    })() },
  }, close: async () => {} }) as unknown as ReturnType<typeof mistralSdkAuth.createClient>;
  await createMistralSdkRuntime(history, async () => [], home, auth, fixtureTools(async () => '')).run('Question', { sessionId: 'mistral-sdk-compteur', model: 'mistral-medium-latest' }, { userId: 1, send: (event: unknown) => events.push(event as NormalizedMessage) } as never, context);
  const budget = events.find(event => event.kind === 'status' && event.text === 'token_budget')?.tokenBudget;
  assert.deepEqual(budget, { used: 41_900, total: 256_000, inputTokens: 41_000, outputTokens: 900, breakdown: { input: 41_000, output: 900 } });
  assert.deepEqual((await history.load('mistral-sdk-compteur'))?.tokenUsage, budget);

  const service = { getSessionTokenUsage: async (_sessionId: string): Promise<unknown> => ({ used: -1 }) };
  installMistralTokenUsage(service, id => ({ 'app-mistral': { provider: 'mistral', provider_session_id: 'mistral-sdk-compteur' }, 'app-claude': { provider: 'claude' } })[id], history);
  assert.deepEqual(await service.getSessionTokenUsage('app-mistral'), budget);
  assert.deepEqual(await service.getSessionTokenUsage('app-claude'), { used: -1 });
});

test('le statut du fournisseur suit les identifiants enregistrés, pas une valeur figée', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mistral-runtime-test-'));
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mistral-status-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  t.after(async () => {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await fs.rm(tempDirectory, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });
  const provider = { auth: {}, models: {}, sessions: { fetchHistory: async () => { throw new Error('Sans historique.'); } } } as unknown as Parameters<typeof installMistralSdk>[0];
  installMistralSdk(provider, home);
  assert.equal((await provider.auth.getStatus()).authenticated, false);
  const user = userDb.createUser('compte-fictif', 'empreinte-fictive');
  credentialsDb.createCredential(Number(user.id), 'Compte Mistral', 'mistral_sdk', 'cle-fictive');
  assert.equal((await provider.auth.getStatus()).authenticated, true);
});

test('les outils refusés par le tour ne sont pas proposés au modèle', async t => {
  const { home, history } = await setup(t);
  const requests: unknown[] = [];
  const definition = (name: string) => ({ type: 'function' as const, function: { name, parameters: { type: 'object' } } });
  const tools = (async () => ({
    instructions: 'Skills disponibles : fictitious-skill', close: async () => {}, turnEnd: async () => '',
    tools: new Map([
      ['probe', { name: 'probe', readOnly: true, execute: async () => '', definition: definition('probe') }],
      ['interdit-shell', { name: 'interdit-shell', readOnly: false, execute: async () => '', definition: definition('interdit-shell') }],
      ['mcp__excl__outil', { name: 'mcp__excl__outil', readOnly: true, execute: async () => '', definition: definition('mcp__excl__outil') }],
    ]),
  })) satisfies typeof createMistralTools;
  const auth = fixtureClient([[{ content: 'Réponse sans outils refusés.' }]], requests);
  await createMistralSdkRuntime(history, async () => [], home, auth, tools).run('Bonjour', { sessionId: 'mistral-sdk-outils-refuses', toolsSettings: { disallowedTools: ['interdit-shell', 'mcp__excl', 'hors-table'] } }, { userId: 1, send() {} } as never, context);
  const offered = ((requests[0] as { tools?: Array<{ function: { name: string } }> }).tools ?? []).map(tool => tool.function.name);
  assert.ok(offered.includes('probe'));
  assert.ok(!offered.includes('interdit-shell'));
  assert.ok(!offered.includes('mcp__excl__outil'));
});
