import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import test from 'node:test';

import { isReplayedVibeHistoryEntry, mistralRuntime } from '@/modules/providers/list/mistral/mistral-runtime.provider.js';
import type { ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/index.js';

const replayedTurn = [
  { id: 'old-user', sessionId: 'vibe-1', turnId: null, type: 'message', role: 'user', content: [{ type: 'text', text: 'un' }] },
  { id: 'old-assistant', sessionId: 'vibe-1', turnId: null, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'un' }] },
  { id: 'checkpoint:resume:x', sessionId: 'vibe-1', turnId: null, type: 'checkpoint' },
];
const newTurn = [
  { id: 'new-user', sessionId: 'vibe-1', turnId: 'turn-2', type: 'message', role: 'user', content: [{ type: 'text', text: 'deux' }] },
  { id: 'new-assistant', sessionId: 'vibe-1', turnId: 'turn-2', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'deux' }] },
];

async function runVibe(t: test.TestContext, providerSessionId: string | null) {
  t.mock.method(childProcess, 'spawn', () => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
    setImmediate(() => {
      child.stdout.emit('data', Buffer.from([...replayedTurn, ...newTurn].map((record) => JSON.stringify(record)).join('\n') + '\n'));
      child.emit('close', 0);
    });
    return child;
  });
  const normalizedIds: string[] = [];
  const context = {
    resolveProviderSessionId: () => providerSessionId,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
    normalizeMessage: (record: { id: string }) => {
      normalizedIds.push(record.id);
      return [];
    },
    isProviderInstalled: async () => true,
  } as unknown as ProviderRuntimeContext;
  const writer = { send() {}, userId: null } as unknown as ProviderRuntimeWriter;
  await mistralRuntime.run('deux', { sessionId: 'app-1', cwd: os.tmpdir() }, writer, context);
  return normalizedIds;
}

test('a resumed Vibe turn shows only its own entries, not the replayed history', async (t) => {
  assert.deepEqual(await runVibe(t, 'vibe-1'), ['new-user', 'new-assistant']);
});

test('a new Vibe session keeps every streamed entry', async (t) => {
  assert.equal((await runVibe(t, null)).length, replayedTurn.length + newTurn.length);
});

test('only entries without a turn are recognised as replayed history', () => {
  assert.equal(isReplayedVibeHistoryEntry({ turnId: null }), true);
  assert.equal(isReplayedVibeHistoryEntry({ turnId: 'turn-2' }), false);
  assert.equal(isReplayedVibeHistoryEntry({}), false);
  assert.equal(isReplayedVibeHistoryEntry(null), false);
});
