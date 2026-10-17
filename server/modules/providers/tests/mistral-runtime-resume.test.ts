import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readVibeMessageTimes } from '@/modules/providers/list/mistral/mistral-message-times.js';
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

async function runVibe(t: test.TestContext, providerSessionId: string | null, records: unknown[] = [...replayedTurn, ...newTurn], sent: unknown[] = []) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const previous = process.env.PIECEMAKER_HOME;
  process.env.PIECEMAKER_HOME = home;
  const bin = path.join(home, 'vibe', process.platform === 'win32' ? 'Scripts' : 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'vibe.exe' : 'vibe'), '');
  fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'python.exe' : 'python'), '');
  t.after(() => {
    if (previous === undefined) delete process.env.PIECEMAKER_HOME;
    else process.env.PIECEMAKER_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  });
  t.mock.method(childProcess, 'spawn', () => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
    setImmediate(() => {
      const bytes = Buffer.from(records.map((record) => JSON.stringify(record)).join('\n') + '\n');
      for (const byte of bytes) child.stdout.emit('data', Buffer.from([byte]));
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
  const writer = { send(message: unknown) { sent.push(message); }, userId: null } as unknown as ProviderRuntimeWriter;
  await mistralRuntime.run('deux', { sessionId: 'app-1', cwd: os.tmpdir() }, writer, context);
  return normalizedIds;
}

test('a resumed Vibe turn shows only its own entries, not the replayed history', async (t) => {
  assert.deepEqual(await runVibe(t, 'vibe-1'), ['new-user', 'new-assistant']);
});

test('Vibe forwards UTF-8 text fragments and closes each message without replaying its text', async (t) => {
  const sent: unknown[] = [];
  const normalized = await runVibe(t, 'vibe-1', [
    { type: 'piecemaker_reasoning', sessionId: 'vibe-1', id: 'r', turnId: 'turn-2', createdAt: Date.UTC(2026, 0, 1), content: 'Je' },
    { type: 'piecemaker_reasoning', sessionId: 'vibe-1', id: 'r', turnId: 'turn-2', createdAt: Date.UTC(2026, 0, 1), content: 'Je réfléchis' },
    { type: 'piecemaker_text_delta', sessionId: 'vibe-1', id: 'a', content: 'Début → ' },
    { type: 'piecemaker_text_delta', sessionId: 'vibe-1', id: 'a', content: 'fin' },
    { type: 'piecemaker_text_end', sessionId: 'vibe-1', id: 'a' },
    { type: 'message', sessionId: 'vibe-1', id: 'tool', content: [] },
    { type: 'piecemaker_text_delta', sessionId: 'vibe-1', id: 'b', content: 'Suite' },
    { type: 'piecemaker_text_end', sessionId: 'vibe-1', id: 'b' },
  ], sent);
  assert.deepEqual(normalized, ['tool']);
  const messages = sent as { id?: string; kind?: string; content?: string; timestamp?: string }[];
  assert.deepEqual(messages.filter((message) => message.kind === 'thinking').map((message) => [message.id, message.content, message.timestamp]), [
    ['r', 'Je', '2026-01-01T00:00:00.000Z'],
    ['r', 'Je réfléchis', '2026-01-01T00:00:00.000Z'],
  ]);
  assert.deepEqual(messages.filter((message) => message.kind === 'stream_delta').map((message) => message.content), ['Début → ', 'fin', 'Suite']);
  assert.equal(messages.filter((message) => message.kind === 'stream_end').length, 2);
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

test('Vibe writes its stream in UTF-8 whatever the Windows code page', async (t) => {
  const previous = process.env.PYTHONIOENCODING;
  process.env.PYTHONIOENCODING = 'cp1252';
  t.after(() => {
    if (previous === undefined) delete process.env.PYTHONIOENCODING;
    else process.env.PYTHONIOENCODING = previous;
  });
  let spawnedEnv: NodeJS.ProcessEnv | undefined;
  t.mock.method(childProcess, 'spawn', (_command: string, _args: string[], options: { env?: NodeJS.ProcessEnv }) => {
    spawnedEnv = options.env;
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
    setImmediate(() => child.emit('close', 0));
    return child;
  });
  const context = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
  } as unknown as ProviderRuntimeContext;
  const writer = { send() {}, userId: null } as unknown as ProviderRuntimeWriter;
  await mistralRuntime.run('bonjour', { sessionId: 'app-2', cwd: os.tmpdir() }, writer, context);
  assert.equal(spawnedEnv?.PYTHONIOENCODING, 'utf-8');
});

test('only entries without a turn are recognised as replayed history', () => {
  assert.equal(isReplayedVibeHistoryEntry({ turnId: null }), true);
  assert.equal(isReplayedVibeHistoryEntry({ turnId: 'turn-2' }), false);
  assert.equal(isReplayedVibeHistoryEntry({}), false);
  assert.equal(isReplayedVibeHistoryEntry(null), false);
});
