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
      assert.match(command, /PIECEMAKER_CITATION_INSTRUCTIONS/);
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
  const finalIndex = sent.findIndex((event) => (event.citationEvent as { status?: string })?.status === 'final');
  assert.ok(finalIndex >= 0 && finalIndex < sent.length - 1);
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
  assert.doesNotMatch(history.messages[3].content ?? '', /non retrouvé/);
  assert.match(history.messages[5].content ?? '', /non retrouvé/);
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
  assert.equal(sent.some((event) => (event.citationEvent as { status?: string })?.status === 'final'), false);
});

test('les instructions ajoutées au lancement sont retirées sans modifier le texte utilisateur', () => {
  const original = 'Question <PIECEMAKER_CITATION_INSTRUCTIONS> à conserver';
  assert.equal(withoutCitationInstructions(withCitationInstructions(original)), original);
  assert.equal(withoutCitationInstructions(original), original);
});

test('un runtime arrêté sans événement complete ne publie pas des annotations finales', async (t) => {
  const { runtime, sent, cwd } = await setup(t, [message({ kind: 'text', role: 'assistant', provider: 'codex', content })]);
  await runtime.run('codex', 'Question', { cwd, sessionId: 'session' }, { send: (data) => sent.push(data as NormalizedMessage) });
  assert.equal(sent.some((event) => (event.citationEvent as { status?: string })?.status === 'final'), false);
});
