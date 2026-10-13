import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage } from '@/shared/utils.js';

import { createCitationStore } from './citation-store.js';
import { installChatCitationHarness } from './chat-harness.js';
import { withCitationInstructions, withoutCitationInstructions } from './citation-instructions.js';

type Dependencies = Parameters<typeof installChatCitationHarness>[0];

async function setup(t: test.TestContext, messages: NormalizedMessage[]) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pm-chat-harness-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, 'piece.md'), 'La clause impose un préavis de trois mois.');
  const store = createCitationStore(cwd);
  const sent: NormalizedMessage[] = [];
  const runtime: Dependencies['runtime'] = {
    run: async (_provider, command, _options, writer) => {
      assert.match(command, /CITATION_INSTRUCTION/);
      writer.setSessionId?.('native-session');
      for (const message of messages) writer.send(message);
    },
    getRunner: () => async () => {},
  };
  const sessions: Dependencies['sessions'] = {
    fetchHistory: async () => ({ messages, total: messages.length, hasMore: false, offset: 0, limit: null }),
    getSessionDetailsById: () => ({
      sessionId: 'session', provider: 'claude', summary: '', createdAt: null, updatedAt: null, lastActivity: null, isArchived: false,
      project: { projectId: 'project', path: cwd, fullPath: cwd, displayName: 'Dossier', isArchived: false, isStarred: false },
    }),
  };
  installChatCitationHarness({ runtime, sessions, store, ensureProxy: () => {} });
  return { cwd, runtime, sessions, sent, store };
}

const content = 'Réponse [1].\n<CITATIONS>[{"ref":1,"doc_id":"piece.md","quote":"un préavis de trois mois"}]</CITATIONS>';
const message = (fields: Parameters<typeof createNormalizedMessage>[0]) => createNormalizedMessage({ sessionId: 'session', ...fields });

test('Claude : annotations avant complete, pas de bloc JSON visible ni de doublon de texte', async (t) => {
  const messages = [
    message({ kind: 'stream_delta', provider: 'claude', content: content.slice(0, 19) }),
    message({ kind: 'stream_delta', provider: 'claude', content: content.slice(19) }),
    message({ kind: 'stream_end', provider: 'claude' }),
    message({ kind: 'text', role: 'assistant', provider: 'claude', id: 'reply', content }),
    message({ kind: 'permission_request', provider: 'claude', requestId: 'permission' }),
    message({ kind: 'complete', provider: 'claude', exitCode: 0 }),
  ];
  const { runtime, sent, cwd } = await setup(t, messages);
  let native = '';
  await runtime.run('claude', 'Question', { cwd, sessionId: 'session' }, { send: (data) => sent.push(data as NormalizedMessage), setSessionId: (id) => { native = id; } });
  assert.equal(native, 'native-session');
  assert.equal(sent.at(-1)?.kind, 'complete');
  assert.ok(sent.find((event) => event.kind === 'permission_request'));
  const assistant = sent.filter((event) => event.kind === 'text' && event.role === 'assistant');
  assert.equal(assistant.length, 1);
  assert.doesNotMatch(assistant[0].content ?? '', /<CITATIONS>|doc_id/);
  assert.match(assistant[0].content ?? '', /#piecemaker-citation=/);
  assert.equal(sent.filter((event) => event.kind === 'stream_delta').map((event) => event.content).join(''), assistant[0].content);
  const log = await readFile(path.join(cwd, 'citations-verifiees.jsonl'), 'utf8');
  assert.doesNotMatch(log, /préavis|La clause/);
  assert.equal(JSON.parse(log).session_id, 'session');
});

test('Codex : même vérification via getRunner, sources accessibles et historique paginé cohérent', async (t) => {
  const messages = [
    message({ kind: 'text', role: 'user', provider: 'codex', id: 'user', content: withCitationInstructions('Question') }),
    message({ kind: 'text', role: 'assistant', provider: 'codex', id: 'reply', content }),
    message({ kind: 'complete', provider: 'codex', exitCode: 0 }),
  ];
  const { runtime, sessions, store, sent, cwd } = await setup(t, messages);
  await runtime.getRunner('codex')('Question', { cwd, sessionId: 'session' }, { send: (data) => sent.push(data as NormalizedMessage) });
  const reply = sent.filter((event) => event.id === 'reply').at(-1);
  assert.equal(sent.find((event) => event.id === 'user')?.content, 'Question');
  const token = /#piecemaker-citation=([a-f0-9]{64})/.exec(reply?.content ?? '')?.[1];
  assert.ok(token);
  assert.equal((await store.read(token))?.citation.verified, true);
  const history = await sessions.fetchHistory('session', { limit: 2 });
  assert.equal(history.messages.length, 2);
  assert.equal(history.hasMore, true);
  assert.equal(history.messages[0].content, reply?.content);
  const userPage = await sessions.fetchHistory('session', { limit: 1, offset: 2 });
  assert.equal(userPage.messages[0].content, 'Question');
});

test('historique : la lecture d’une décision dans le premier tour ne valide pas le suivant', async (t) => {
  const citation = '<CITATIONS>[{"ref":1,"decision_id":"JURITEXT1","quote":"Passage lu."}]</CITATIONS>';
  const messages = [
    message({ kind: 'text', role: 'user', provider: 'claude', content: 'Premier tour' }),
    message({ kind: 'tool_use', provider: 'claude', toolId: 'call', toolName: 'mcp__legifrance__consulter_decision', toolInput: { text_id: 'JURITEXT1' } }),
    message({ kind: 'tool_result', provider: 'claude', toolId: 'call', content: 'Passage lu.' }),
    message({ kind: 'text', role: 'assistant', provider: 'claude', content: citation }),
    message({ kind: 'text', role: 'user', provider: 'claude', content: 'Deuxième tour' }),
    message({ kind: 'text', role: 'assistant', provider: 'claude', content: citation }),
  ];
  const { sessions } = await setup(t, messages);
  const history = await sessions.fetchHistory('session');
  assert.doesNotMatch(history.messages[3].content ?? '', /à vérifier/);
  assert.match(history.messages[5].content ?? '', /à vérifier/);
});

test('un tour interrompu ne publie pas des annotations finales', async (t) => {
  const messages = [
    message({ kind: 'stream_delta', provider: 'claude', content }),
    message({ kind: 'stream_end', provider: 'claude' }),
    message({ kind: 'text', role: 'assistant', provider: 'claude', content }),
    message({ kind: 'complete', provider: 'claude', aborted: true }),
  ];
  const { runtime, sent, cwd } = await setup(t, messages);
  await runtime.run('claude', 'Question', { cwd, sessionId: 'session' }, { send: (data) => sent.push(data as NormalizedMessage) });
  assert.equal(sent.at(-1)?.aborted, true);
  assert.equal(sent.some((event) => /#piecemaker-citation=/.test(event.content ?? '')), false);
});

test('les instructions ajoutées au lancement sont retirées sans modifier le texte utilisateur', () => {
  const original = 'Question <CITATION_INSTRUCTION> à conserver';
  assert.equal(withoutCitationInstructions(withCitationInstructions(original)), original);
  assert.equal(withoutCitationInstructions(original), original);
});

test('un runtime arrêté sans événement complete ne publie pas des annotations finales', async (t) => {
  const { runtime, sent, cwd } = await setup(t, [message({ kind: 'text', role: 'assistant', provider: 'codex', content })]);
  await runtime.run('codex', 'Question', { cwd, sessionId: 'session' }, { send: (data) => sent.push(data as NormalizedMessage) });
  assert.equal(sent.some((event) => /#piecemaker-citation=/.test(event.content ?? '')), false);
});

test('historique du dossier : begin avant le tour, end avec la demande, la conclusion et l’abandon', async (t) => {
  const { store, sessions, cwd } = await setup(t, []);
  const calls: unknown[] = [];
  const turns = [
    [message({ kind: 'text', role: 'assistant', provider: 'claude', id: 'reply', content: 'J’ai mis à jour les notes.' }), message({ kind: 'complete', provider: 'claude', exitCode: 0 })],
    [message({ kind: 'complete', provider: 'claude', aborted: true })],
  ];
  const runtime: Dependencies['runtime'] = {
    run: async (_provider, _command, _options, writer) => {
      calls.push('run');
      for (const event of turns.shift() ?? []) writer.send(event);
    },
    getRunner: () => async () => {},
  };
  installChatCitationHarness({
    runtime, sessions, store, ensureProxy: () => {},
    folderHistory: { begin: (folder) => calls.push({ begin: folder }), end: (turn) => calls.push({ end: turn }) },
  });
  const writer = { send: () => {} };
  await runtime.run('claude', 'Mets à jour les notes', { cwd, sessionId: 'session', model: 'opus' }, writer);
  await runtime.run('claude', 'Deuxième demande', { cwd, sessionId: 'session' }, writer);
  assert.deepEqual(calls, [
    { begin: cwd }, 'run', { end: { cwd, request: 'Mets à jour les notes', conclusion: 'J’ai mis à jour les notes.', aborted: false, author: { name: 'Claude opus', email: 'claude@localhost' } } },
    { begin: cwd }, 'run', { end: { cwd, request: 'Deuxième demande', conclusion: '', aborted: true, author: { name: 'Claude', email: 'claude@localhost' } } },
  ]);
});

test('historique du dossier : Cursor et OpenCode aussi, sans instructions de citation', async (t) => {
  const { store, sessions, cwd } = await setup(t, []);
  const calls: unknown[] = [];
  const runtime: Dependencies['runtime'] = {
    run: async (provider, command, _options, writer) => {
      calls.push({ run: provider, command });
      if (provider === 'cursor') return;
      writer.send(message({ kind: 'text', role: 'assistant', provider, content: 'Fait.' }));
      writer.send(message({ kind: 'complete', provider, exitCode: 0 }));
    },
    getRunner: () => async () => {},
  };
  installChatCitationHarness({
    runtime, sessions, store, ensureProxy: () => {},
    folderHistory: { begin: (folder) => calls.push({ begin: folder }), end: (turn) => calls.push({ end: turn }) },
  });
  const writer = { send: () => {} };
  for (const provider of ['opencode', 'cursor'] as const) await runtime.run(provider, 'Demande', { cwd }, writer);
  const end = (aborted: boolean, name: string, email: string, conclusion = 'Fait.') => ({ end: { cwd, request: 'Demande', conclusion, aborted, author: { name, email } } });
  assert.deepEqual(calls, [
    { begin: cwd }, { run: 'opencode', command: 'Demande' }, end(false, 'OpenCode', 'opencode@localhost'),
    { begin: cwd }, { run: 'cursor', command: 'Demande' }, end(true, 'Cursor', 'cursor@localhost', ''),
  ]);
});

test('historique du dossier : conclusion reconstituée depuis les deltas, dernier bloc après les outils', async (t) => {
  const { store, sessions, cwd } = await setup(t, []);
  const ends: unknown[] = [];
  const runtime: Dependencies['runtime'] = {
    run: async (_provider, _command, _options, writer) => {
      const delta = (content: string) => writer.send(message({ kind: 'stream_delta', provider: 'mistral', content }));
      delta('Je crée ');
      delta('le fichier.');
      writer.send(message({ kind: 'tool_use', provider: 'mistral', toolName: 'write_file' }));
      writer.send(message({ kind: 'tool_result', provider: 'mistral', content: 'ok' }));
      delta('Fichier ');
      delta('créé.');
      writer.send(message({ kind: 'complete', provider: 'mistral', exitCode: 0 }));
    },
    getRunner: () => async () => {},
  };
  installChatCitationHarness({
    runtime, sessions, store, ensureProxy: () => {},
    folderHistory: { begin: () => {}, end: (turn) => ends.push(turn) },
  });
  await runtime.run('mistral', 'Demande', { cwd }, { send: () => {} });
  assert.deepEqual(ends, [{ cwd, request: 'Demande', conclusion: 'Fichier créé.', aborted: false, author: { name: 'Mistral', email: 'mistral@localhost' } }]);
});

test('Codex : réponse finale envoyée une seule fois, et l’historique reprend les sources vérifiées en direct', async (t) => {
  const citation = 'Réponse [1].\n<CITATIONS>[{"ref":1,"kind":"case","decision_id":"JURITEXT1","quote":"Passage lu."}]</CITATIONS>';
  const messages = [
    message({ kind: 'text', role: 'user', provider: 'codex', id: 'user', content: withCitationInstructions('Question') }),
    message({ kind: 'tool_use', provider: 'codex', toolId: 'call', toolName: 'mcp__legifrance__consulter_decision', toolInput: { text_id: 'JURITEXT1' } }),
    message({ kind: 'tool_result', provider: 'codex', toolId: 'call', content: 'Passage lu.' }),
    message({ kind: 'text', role: 'assistant', provider: 'codex', id: 'reply', content: citation }),
    message({ kind: 'complete', provider: 'codex', exitCode: 0 }),
  ];
  const { runtime, sessions, sent, cwd } = await setup(t, messages);
  await runtime.run('codex', 'Question', { cwd, sessionId: 'session' }, { send: (data) => sent.push(data as NormalizedMessage) });
  const replies = sent.filter((event) => event.kind === 'text' && event.role === 'assistant');
  assert.equal(replies.length, 1);
  assert.match(replies[0].content ?? '', /« Passage lu\. »/);
  messages.splice(1, 2);
  const history = await sessions.fetchHistory('session');
  assert.equal(history.messages.find((event) => event.role === 'assistant')?.content, replies[0].content);
});

test('Mistral : réponse diffusée en deltas, bloc masqué et sources ajoutées avant complete', async (t) => {
  const messages = [
    message({ kind: 'stream_delta', provider: 'mistral', content: content.slice(0, 19) }),
    message({ kind: 'stream_delta', provider: 'mistral', content: content.slice(19) }),
    message({ kind: 'complete', provider: 'mistral', exitCode: 0 }),
  ];
  const { runtime, sent, cwd } = await setup(t, messages);
  await runtime.run('mistral', 'Question', { cwd, sessionId: 'session' }, { send: (data) => sent.push(data as NormalizedMessage) });
  assert.equal(sent.at(-1)?.kind, 'complete');
  const streamed = sent.filter((event) => event.kind === 'stream_delta').map((event) => event.content).join('');
  assert.doesNotMatch(streamed, /<CITATIONS>|doc_id/);
  assert.match(streamed, /^Réponse \[1\]\.\n\n\n\*\*Sources\*\*\n\n- \[1\] \[piece, p\. 1\]\[1\] — « un préavis de trois mois »/);
});
