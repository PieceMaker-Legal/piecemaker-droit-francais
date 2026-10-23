import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readVibeMessageTimes } from '@/modules/providers/list/mistral/mistral-message-times.js';
import { readLegacyVibeSessionOrigin } from '@/modules/providers/list/mistral/mistral-legacy-history.js';
import { isReplayedVibeHistoryEntry, mistralRuntime } from '@/modules/providers/list/mistral/mistral-runtime.provider.js';
import type { ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/index.js';

const replayedTurn = [
  { id: 'old-user', sessionId: 'vibe-1', turnId: null, createdAt: Date.UTC(2026, 0, 2, 9, 0), type: 'message', role: 'user', content: [{ type: 'text', text: 'un' }] },
  { id: 'old-assistant', sessionId: 'vibe-1', turnId: null, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'un' }] },
  { id: 'checkpoint:resume:x', sessionId: 'vibe-1', turnId: null, type: 'checkpoint' },
];
const newTurn = [
  { id: 'new-user', sessionId: 'vibe-1', turnId: 'turn-2', createdAt: Date.UTC(2026, 0, 1, 9, 0), type: 'message', role: 'user', content: [{ type: 'text', text: 'deux' }] },
  { id: 'new-assistant', sessionId: 'vibe-1', turnId: 'turn-2', createdAt: Date.UTC(2026, 0, 1, 9, 1), type: 'message', role: 'assistant', content: [{ type: 'text', text: 'deux' }] },
];

async function runVibe(t: test.TestContext, providerSessionId: string | null, legacy = false) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const previous = process.env.PIECEMAKER_HOME;
  const previousVibeHome = process.env.VIBE_HOME;
  process.env.PIECEMAKER_HOME = home;
  process.env.VIBE_HOME = home;
  if (legacy) {
    const directory = path.join(home, 'logs', 'session', `session_example_${providerSessionId!.slice(0, 8)}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'meta.json'), JSON.stringify({ session_id: providerSessionId }));
    fs.writeFileSync(path.join(directory, 'messages.jsonl'), JSON.stringify({ role: 'user', content: 'Exemple fictif.' }));
  }
  t.after(() => {
    if (previous === undefined) delete process.env.PIECEMAKER_HOME;
    else process.env.PIECEMAKER_HOME = previous;
    if (previousVibeHome === undefined) delete process.env.VIBE_HOME;
    else process.env.VIBE_HOME = previousVibeHome;
    fs.rmSync(home, { recursive: true, force: true });
  });
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

test('a resumed Vibe turn records the real time of its own entries only', async (t) => {
  await runVibe(t, 'vibe-1');
  assert.deepEqual(readVibeMessageTimes('vibe-1'), {
    'new-user': '2026-01-01T09:00:00.000Z',
    'new-assistant': '2026-01-01T09:01:00.000Z',
  });
});

test('a new Vibe session keeps every streamed entry', async (t) => {
  assert.equal((await runVibe(t, null)).length, replayedTurn.length + newTurn.length);
});

test('a legacy resume persists its original history before completing the turn', async (t) => {
  await runVibe(t, 'legacy-example', true);
  assert.equal((await readLegacyVibeSessionOrigin('vibe-1'))?.sessionId, 'legacy-example');
});

test('only entries without a turn are recognised as replayed history', () => {
  assert.equal(isReplayedVibeHistoryEntry({ turnId: null }), true);
  assert.equal(isReplayedVibeHistoryEntry({ turnId: 'turn-2' }), false);
  assert.equal(isReplayedVibeHistoryEntry({}), false);
  assert.equal(isReplayedVibeHistoryEntry(null), false);
});
