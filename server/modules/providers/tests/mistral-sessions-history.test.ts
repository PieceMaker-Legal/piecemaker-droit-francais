import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MistralSessionsProvider } from '@/modules/providers/list/mistral/mistral-sessions.provider.js';

const vibeSessionId = '1a2b3c4d-0000-4000-8000-000000000001';

function writeVibeSession(t: test.TestContext, records: unknown[], times: Record<string, string> = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-home-'));
  fs.mkdirSync(path.join(home, 'vibe-message-times'));
  fs.writeFileSync(path.join(home, 'vibe-message-times', `${vibeSessionId}.json`), JSON.stringify(times));
  const directory = path.join(home, 'logs', 'session', `session_20260101_090000_${vibeSessionId.slice(0, 8)}`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'meta.json'), JSON.stringify({ session_id: vibeSessionId, start_time: '2026-01-01T09:00:00+00:00' }));
  fs.writeFileSync(path.join(directory, 'messages.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n');
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
}

test('a Mistral session reloads its conversation from the Vibe log', async (t) => {
  writeVibeSession(t, [
    { role: 'user', content: '<vibe_warning>mode plan</vibe_warning>', injected: true, message_id: 'u0' },
    { role: 'user', content: 'Résume le contrat de Jean Dupont', injected: false, message_id: 'u1' },
    {
      role: 'assistant', injected: false, message_id: 'a1', reasoning_content: 'Je lis le contrat.',
      tool_calls: [{ id: 'call-1', function: { name: 'read_file', arguments: '{"path": "contrat.md"}' }, type: 'function' }],
    },
    { role: 'tool', content: 'Contrat de bail', injected: false, name: 'read_file', tool_call_id: 'call-1' },
    { role: 'assistant', content: 'Bail signé avec Société Exemple SAS.', injected: false, message_id: 'a2' },
  ]);

  const history = await new MistralSessionsProvider().fetchHistory('app-1', { providerSessionId: vibeSessionId, limit: null });

  assert.deepEqual(
    history.messages.map((message) => [message.kind, message.role ?? null, message.content ?? message.toolName ?? null]),
    [
      ['text', 'user', 'Résume le contrat de Jean Dupont'],
      ['thinking', null, 'Je lis le contrat.'],
      ['tool_use', null, 'read_file'],
      ['text', 'assistant', 'Bail signé avec Société Exemple SAS.'],
    ],
  );
  const toolUse = history.messages.find((message) => message.kind === 'tool_use');
  assert.deepEqual(toolUse?.toolInput, { path: 'contrat.md' });
  assert.deepEqual(toolUse?.toolResult, { content: 'Contrat de bail', isError: false });
  assert.equal(history.total, 4);
});

test('each reloaded Mistral message carries the time it was recorded live', async (t) => {
  writeVibeSession(t, [
    { role: 'user', content: 'Bonjour', injected: false, message_id: 'u1' },
    { role: 'assistant', content: 'Bonjour.', injected: false, message_id: 'a1', reasoning_content: 'Salutation.', reasoning_message_id: 'r1' },
    { role: 'user', content: 'Merci', injected: false, message_id: 'u2' },
  ], { u1: '2026-01-01T09:05:00.000Z', a1: '2026-01-01T09:06:00.000Z' });

  const history = await new MistralSessionsProvider().fetchHistory('app-1', { providerSessionId: vibeSessionId });

  assert.deepEqual(history.messages.map((message) => [message.id, message.timestamp]), [
    ['u1', '2026-01-01T09:05:00.000Z'],
    ['r1', '2026-01-01T09:05:00.000Z'],
    ['a1', '2026-01-01T09:06:00.000Z'],
    ['u2', '2026-01-01T09:06:00.000Z'],
  ]);
});

test('a Mistral session without a Vibe log has no history', async (t) => {
  writeVibeSession(t, []);
  const history = await new MistralSessionsProvider().fetchHistory('app-1', { providerSessionId: 'ffffffff-0000-4000-8000-000000000000' });
  assert.equal(history.total, 0);
});
