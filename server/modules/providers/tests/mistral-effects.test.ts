import assert from 'node:assert/strict';
import test from 'node:test';

import { MistralSessionsProvider } from '@/modules/providers/list/mistral/mistral-sessions.provider.js';

const provider = new MistralSessionsProvider();
const effect = {
  id: 'effect-example', sessionId: 'native-example', type: 'effect',
  createdAt: Date.UTC(2026, 0, 1), updatedAt: Date.UTC(2026, 0, 1, 0, 1),
  detail: { toolName: 'file_system.bash', kind: 'shell', input: { command: 'printf exemple' } },
};

test('Unified tool effects expose their input and completed output', () => {
  const [message] = provider.normalizeMessage({ ...effect, state: { status: 'completed', outputText: 'exemple', output: { stdout: 'exemple' } } }, 'app-example');
  assert.equal(message.kind, 'tool_use');
  assert.equal(message.id, effect.id);
  assert.equal(message.toolId, effect.id);
  assert.equal(message.sessionId, effect.sessionId);
  assert.equal(message.toolName, 'file_system.bash');
  assert.deepEqual(message.toolInput, { command: 'printf exemple' });
  assert.deepEqual(message.toolResult, { content: 'exemple', isError: false });
  assert.equal(message.timestamp, '2026-01-01T00:01:00.000Z');
});

test('failed effects retain their error and structured fallback output', () => {
  const [failed] = provider.normalizeMessage({ ...effect, state: { status: 'failed', error: { message: 'Commande refusée' } } }, null);
  assert.deepEqual(failed.toolResult, { content: 'Commande refusée', isError: true });
  const [structured] = provider.normalizeMessage({ ...effect, state: { status: 'completed', output: { count: 2 } } }, null);
  assert.equal(structured.toolResult?.content, JSON.stringify({ count: 2 }, null, 2));
});

test('pending effects have no result and non-tool effects remain ignored', () => {
  const [running] = provider.normalizeMessage({ ...effect, state: { status: 'running', outputText: 'en cours' } }, null);
  assert.equal(running.toolResult, undefined);
  assert.deepEqual(provider.normalizeMessage({ ...effect, detail: { kind: 'notification' }, state: { status: 'completed' } }, null), []);
});

test('cancelled and skipped effects preserve their reason', () => {
  for (const status of ['cancelled', 'skipped']) {
    const [message] = provider.normalizeMessage({ ...effect, state: { status, reason: 'Permission refusée' } }, null);
    assert.deepEqual(message.toolResult, { content: 'Permission refusée', isError: true });
  }
});
