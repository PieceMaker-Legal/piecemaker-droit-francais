import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { readNativeVibeHistory } from '@/modules/providers/list/mistral/mistral-native-history.js';
import { MistralSessionsProvider } from '@/modules/providers/list/mistral/mistral-sessions.provider.js';
import { recordLegacyVibeSessionOrigin } from '@/modules/providers/list/mistral/mistral-legacy-history.js';
import { recordVibePlanMessage } from '@/modules/providers/list/mistral/mistral-plan-messages.js';

const sessionId = '00000000-0000-4000-8000-000000000001';

function setup(t: test.TestContext, repeatedCursor = false, includeEffect = false, importedLegacy = false) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-native-history-'));
  fs.mkdirSync(path.join(home, 'logs', 'session', 'unified', sessionId), { recursive: true });
  const previous = { VIBE_HOME: process.env.VIBE_HOME, PIECEMAKER_HOME: process.env.PIECEMAKER_HOME };
  process.env.VIBE_HOME = home;
  process.env.PIECEMAKER_HOME = home;
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(home, { recursive: true, force: true });
  });
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  t.mock.method(childProcess, 'spawn', () => {
    const stdout = new PassThrough();
    const stdin = Object.assign(new EventEmitter(), {
      write(line: string) {
        const request = JSON.parse(line);
        requests.push(request);
        if (!request.id) return true;
        const record = request.id === 2
          ? { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Plan proposé.' }] }
          : { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Prépare un plan.' }] };
        const result = request.method === 'initialize' ? {} : {
          items: importedLegacy ? (request.id === 2 ? [
            { type: 'message', id: 'new-user', role: 'user', content: 'Continue.' },
            { type: 'message', id: 'new-assistant', role: 'assistant', content: 'Suite du plan.' },
          ] : [
            { type: 'message', id: 'imported-1', role: 'user', content: 'Prépare un plan.' },
            { type: 'message', id: 'imported-2', role: 'assistant', content: 'Plan proposé.' },
          ]) : [{ type: 'message', sessionId, createdAt: Date.UTC(2026, 0, 1), ...record },
            ...(includeEffect && request.id === 2 ? [{
              type: 'effect', id: 'effect-read', sessionId, createdAt: Date.UTC(2026, 0, 1),
              detail: { toolName: 'file_system.read_file', input: { path: 'exemple.txt' } },
              state: { status: 'completed', outputText: 'Texte fictif.' },
            }] : [])],
          nextCursor: request.id === 2 || repeatedCursor ? 'older' : null,
        };
        setImmediate(() => stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`));
        return true;
      },
      end() { stdout.end(); },
    });
    return Object.assign(new EventEmitter(), { stdout, stdin, exitCode: 0, kill: () => true });
  });
  return requests;
}

test('stored Unified history uses only read RPC and preserves chronological page order', async (t) => {
  const requests = setup(t);
  const history = await new MistralSessionsProvider().fetchHistory('app-1', { providerSessionId: sessionId });
  assert.deepEqual(history.messages.map(({ kind, role, content }) => [kind, role, content]), [
    ['text', 'user', 'Prépare un plan.'], ['text', 'assistant', 'Plan proposé.'],
  ]);
  assert.ok(history.messages.every((message) => message.sessionId === 'app-1'));
  assert.deepEqual(requests.map(({ method }) => method), ['initialize', 'initialized', 'session/history/list', 'session/history/list']);
});

test('a repeated history cursor fails without looping or changing a session', async (t) => {
  const requests = setup(t, true);
  assert.equal(await readNativeVibeHistory(sessionId), null);
  assert.equal(requests.length, 4);
});

test('history reload restores the plan viewer card with the application session id', async (t) => {
  setup(t);
  recordVibePlanMessage({ sessionId, id: 'a1', turnId: 'turn-example', type: 'message', role: 'assistant' });
  const history = await new MistralSessionsProvider().fetchHistory('app-1', { providerSessionId: sessionId });
  const plan = history.messages.find(message => message.id === 'a1');
  assert.equal(plan?.kind, 'tool_use');
  assert.equal(plan?.sessionId, 'app-1');
  assert.equal(plan?.toolName, 'ExitPlanMode');
  assert.deepEqual(plan?.toolInput, { plan: 'Plan proposé.' });
  assert.equal(history.messages.filter(message => message.id === 'a1').length, 1);
});

test('Unified history reload includes tool effects and their results', async (t) => {
  setup(t, false, true);
  const history = await new MistralSessionsProvider().fetchHistory('app-1', { providerSessionId: sessionId });
  const effect = history.messages.find((message) => message.id === 'effect-read');
  assert.equal(effect?.kind, 'tool_use');
  assert.equal(effect?.sessionId, 'app-1');
  assert.equal(effect?.toolName, 'file_system.read_file');
  assert.deepEqual(effect?.toolInput, { path: 'exemple.txt' });
  assert.deepEqual(effect?.toolResult, { content: 'Texte fictif.', isError: false });
});

test('legacy import keeps original tools without duplicating the imported conversation', async (t) => {
  setup(t, false, false, true);
  const legacyId = '11111111-0000-4000-8000-000000000001';
  const directory = path.join(process.env.VIBE_HOME!, 'logs', 'session', 'session_example_11111111');
  fs.mkdirSync(directory);
  const meta = JSON.stringify({ session_id: legacyId, start_time: '2026-01-01T09:00:00Z' });
  const log = [
    { role: 'user', message_id: 'old-user', content: 'Prépare un plan.' },
    { role: 'assistant', message_id: 'old-call', tool_calls: [{ id: 'read-example', function: { name: 'read_file', arguments: '{"path":"exemple.txt"}' } }] },
    { role: 'tool', tool_call_id: 'read-example', content: 'Texte fictif.' },
    { role: 'assistant', message_id: 'old-assistant', content: 'Plan proposé.' },
  ].map(record => JSON.stringify(record)).join('\n');
  fs.writeFileSync(path.join(directory, 'meta.json'), meta);
  fs.writeFileSync(path.join(directory, 'messages.jsonl'), log);
  await recordLegacyVibeSessionOrigin(sessionId, legacyId);
  await recordLegacyVibeSessionOrigin(sessionId, legacyId);
  const history = await new MistralSessionsProvider().fetchHistory('app-1', { providerSessionId: sessionId });
  assert.deepEqual(history.messages.map(message => message.id), ['old-user', 'old-call_read-example', 'old-assistant', 'new-user', 'new-assistant']);
  assert.deepEqual(history.messages[1].toolResult, { content: 'Texte fictif.', isError: false });
  assert.equal(fs.readFileSync(path.join(directory, 'meta.json'), 'utf8'), meta);
  assert.equal(fs.readFileSync(path.join(directory, 'messages.jsonl'), 'utf8'), log);
  fs.unlinkSync(path.join(directory, 'messages.jsonl'));
  const fallback = await new MistralSessionsProvider().fetchHistory('app-1', { providerSessionId: sessionId });
  assert.deepEqual(fallback.messages.map(message => message.id), ['imported-1', 'imported-2', 'new-user', 'new-assistant']);
});
