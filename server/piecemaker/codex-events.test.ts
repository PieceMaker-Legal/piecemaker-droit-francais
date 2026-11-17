import assert from 'node:assert/strict';
import test from 'node:test';

import { installCodexEventsRuntime } from './codex-events.js';

type Row = Record<string, unknown>;

function setup(history: { messages?: Row[]; tokenUsage?: Row }, emitted: unknown[]) {
  const sent: unknown[] = [];
  const runtime = {
    run: async (_provider: string, _command: string, _options: Record<string, unknown>, writer: { send(data: unknown): void }) => {
      for (const message of emitted) writer.send(message);
    },
  };
  const sessions = { fetchHistory: async () => ({ messages: [], ...history }) };
  installCodexEventsRuntime(runtime as never, sessions as never);
  const run = (provider: string, options: Row) => (runtime.run as (...args: unknown[]) => Promise<void>)(provider, 'x', options, { send: (data: unknown) => sent.push(data) });
  return { sent, run };
}

const budget = { kind: 'status', text: 'token_budget', tokenBudget: { used: 656_000, total: 200_000, inputTokens: 650_000, outputTokens: 6_000 } };

test('le compteur Codex prend le contexte occupé et la fenêtre du modèle', async () => {
  const { sent, run } = setup({ tokenUsage: { used: 41_000, total: 258_400 } }, [budget]);
  await run('codex', { sessionId: 'app-1' });
  assert.deepEqual(sent, [{ ...budget, tokenBudget: { used: 41_000, total: 258_400, inputTokens: 650_000, outputTokens: 6_000 } }]);
});

test('un appel de sous-agent devient la ligne Task de l’historique, dans l’ordre', async () => {
  const task = { kind: 'tool_use', toolName: 'Task', toolId: 'spawn-1', timestamp: new Date(Date.now() + 5_000).toISOString(), toolInput: '{"description":"Index pieces","subagent_type":"index-maker"}' };
  const old = { ...task, toolId: 'spawn-0', timestamp: '2020-01-01T00:00:00.000Z' };
  const text = { kind: 'text', role: 'assistant', content: 'fini' };
  const { sent, run } = setup({ messages: [old, task] }, [{ kind: 'tool_use', toolName: 'collab_tool_call', toolId: 'item_3' }, text]);
  await run('codex', { sessionId: 'app-1' });
  assert.deepEqual(sent, [task, text]);
});

test('sans ligne Task ni usage connu, les messages passent inchangés, même en JSON', async () => {
  const collab = JSON.stringify({ kind: 'tool_use', toolName: 'collab_tool_call', toolId: 'item_3' });
  const { sent, run } = setup({}, [collab, budget]);
  await run('codex', { sessionId: 'app-1' });
  assert.deepEqual(sent, [collab, budget]);
});

test('les autres providers et Codex sans session ne sont pas touchés', async () => {
  const { sent, run } = setup({ tokenUsage: { used: 1, total: 2 } }, [budget]);
  await run('claude', { sessionId: 'app-1' });
  await run('codex', {});
  assert.deepEqual(sent, [budget, budget]);
});
