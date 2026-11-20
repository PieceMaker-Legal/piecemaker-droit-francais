import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { installOrchestratorRuntime } from './orchestrator-runtime.js';

test('le compositeur et les pages du chat restent indépendants du fournisseur', async () => {
  type Dependencies = Parameters<typeof installOrchestratorRuntime>;
  const privateRun = mock.fn(async () => 'activité privée');
  const runtime: Dependencies[0] = { run: privateRun, getRunner: () => privateRun };
  const privateHistory = mock.fn(async () => ({ messages: [], total: 0, offset: 0, limit: null, hasMore: false }));
  const sessions: Dependencies[1] = { fetchHistory: privateHistory };
  const post = mock.fn();
  const messages = ['Demande', 'Résultat'].map((content, index) => ({
    id: String(index), content, sessionId: 'chat', provider: 'claude' as const, kind: 'text' as const,
    timestamp: '2026-01-01', role: index ? 'assistant' as const : 'user' as const,
    images: undefined, files: undefined, agentCard: undefined,
  }));
  installOrchestratorRuntime(runtime, sessions, {
    sessionId: () => 'chat', postUserMessage: post,
    chatHistory: (_root, id) => id === 'chat' ? Promise.resolve(messages) : null,
  }, () => '/projet-fictif');
  const send = mock.fn();
  await runtime.getRunner('claude')('Demande', { sessionId: 'chat' }, { send, userId: 7 });
  assert.deepEqual(post.mock.calls[0].arguments, ['/projet-fictif', 'Demande', 7, []]);
  assert.equal(privateRun.mock.callCount(), 0);
  assert.deepEqual(send.mock.calls.map(call => call.arguments[0].kind), ['complete']);
  const page = await sessions.fetchHistory('chat', { limit: 1 });
  assert.deepEqual(page.messages.map(row => row.content), ['Résultat']);
  assert.equal(page.hasMore, true);
  assert.equal(page.total, 2);
  assert.equal(privateHistory.mock.callCount(), 0);
  assert.equal(await runtime.run('claude', 'Suite', { sessionId: 'fil' }, { send }), 'activité privée');
  await sessions.fetchHistory('fil');
  assert.equal(privateHistory.mock.callCount(), 1);
});
