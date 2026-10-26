import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isReplayedVibeHistoryEntry } from '@/modules/providers/list/mistral/mistral-runtime.provider.js';
import { MistralSessionsProvider } from '@/modules/providers/list/mistral/mistral-sessions.provider.js';
import type { NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage, normalizeSessionName } from '@/shared/utils.js';

import { createCitationStore } from './citation-store.js';
import { installChatCitationHarness } from './chat-harness.js';
import { withCitationInstructions, withoutCitationInstructions, withoutCitationInstructionsInSearch } from './citation-instructions.js';

type Dependencies = Parameters<typeof installChatCitationHarness>[0];
type Provider = 'claude' | 'codex' | 'mistral';

const question = 'Le bail de Jean Dupont\nest-il résilié ?';
const flattenedForWindowsShell = (prompt: string) => prompt.replace(/\s*\r?\n\s*/g, ' ').trim();
const storedPrompts: Record<Provider, string> = {
  claude: withCitationInstructions(question),
  codex: withCitationInstructions(question).replace(/\n/g, '\r\n'),
  mistral: flattenedForWindowsShell(withCitationInstructions(question)),
};
const displayedQuestion: Record<Provider, string> = {
  claude: question,
  codex: question.replace(/\n/g, '\r\n'),
  mistral: flattenedForWindowsShell(question),
};
const providers = Object.keys(storedPrompts) as Provider[];

async function harness(t: test.TestContext, provider: Provider, messages: NormalizedMessage[]) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'pm-citation-instructions-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const runtime: Dependencies['runtime'] = {
    run: async (_provider, _command, _options, writer) => {
      for (const message of messages) writer.send(message);
    },
    getRunner: () => async () => {},
  };
  const sessions: Dependencies['sessions'] = {
    fetchHistory: async () => ({ messages, total: messages.length, hasMore: false, offset: 0, limit: null }),
    getSessionDetailsById: () => ({
      sessionId: 'session', provider, summary: '', createdAt: null, updatedAt: null, lastActivity: null, isArchived: false,
      project: { projectId: 'project', path: cwd, fullPath: cwd, displayName: 'Dossier Exemple', isArchived: false, isStarred: false },
    }),
  };
  installChatCitationHarness({ runtime, sessions, store: createCitationStore(cwd), ensureProxy: () => {} });
  return { runtime, sessions, cwd };
}

const userText = (provider: Provider, content: string, id = 'user') =>
  createNormalizedMessage({ sessionId: 'session', provider, kind: 'text', role: 'user', id, content });

const assertNoBlock = (value: string | undefined) => assert.doesNotMatch(value ?? '', /CITATION_INSTRUCTION|Chaque affirmation/);

test('le bloc est retiré sous ses trois formes stockées, sans toucher au texte de l’avocat', () => {
  for (const provider of providers) assert.equal(withoutCitationInstructions(storedPrompts[provider]), displayedQuestion[provider]);
  assert.equal(withoutCitationInstructions(`${storedPrompts.claude}\n`), question);
  assert.equal(withoutCitationInstructions(flattenedForWindowsShell(withCitationInstructions(''))), '');
  for (const kept of ['Question <CITATION_INSTRUCTION> à conserver', 'Fin</CITATION_INSTRUCTION>', 'Collé<CITATION_INSTRUCTION>x</CITATION_INSTRUCTION>']) {
    assert.equal(withoutCitationInstructions(kept), kept);
  }
});

for (const provider of providers) {
  test(`${provider} : message affiché en direct et rejoué sans le bloc`, async (t) => {
    const { runtime, cwd } = await harness(t, provider, [
      userText(provider, storedPrompts[provider], 'replayed'),
      userText(provider, storedPrompts[provider]),
      createNormalizedMessage({ sessionId: 'session', provider, kind: 'complete', exitCode: 0 }),
    ]);
    const sent: NormalizedMessage[] = [];
    await runtime.run(provider, question, { cwd, sessionId: 'session' }, { send: (data) => sent.push(data as NormalizedMessage) });
    const users = sent.filter((event) => event.kind === 'text' && event.role === 'user');
    assert.deepEqual(users.map((event) => event.content), [displayedQuestion[provider], displayedQuestion[provider]]);
  });

  test(`${provider} : historique rechargé sans le bloc`, async (t) => {
    const { sessions } = await harness(t, provider, [
      userText(provider, storedPrompts[provider]),
      createNormalizedMessage({ sessionId: 'session', provider, kind: 'text', role: 'assistant', content: 'Oui.' }),
    ]);
    const history = await sessions.fetchHistory('session');
    assert.equal(history.messages[0].content, displayedQuestion[provider]);
  });

  test(`${provider} : titre de session sans le bloc`, () => {
    assert.equal(normalizeSessionName(storedPrompts[provider], 'Sans titre'), flattenedForWindowsShell(question));
  });
}

test('mistral : journal Vibe réel relu puis passé au harnais, et écho rejoué ignoré', async (t) => {
  const vibeHome = await mkdtemp(path.join(os.tmpdir(), 'pm-vibe-home-'));
  const previousHome = process.env.VIBE_HOME;
  process.env.VIBE_HOME = vibeHome;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.VIBE_HOME;
    else process.env.VIBE_HOME = previousHome;
    await rm(vibeHome, { recursive: true, force: true });
  });
  const vibeSessionId = 'abcdef12-0000-4000-8000-000000000001';
  const folder = path.join(vibeHome, 'logs', 'session', `session_20261017_${vibeSessionId.slice(0, 8)}`);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'meta.json'), JSON.stringify({ session_id: vibeSessionId, start_time: '2026-10-17T10:00:00Z' }));
  await writeFile(path.join(folder, 'messages.jsonl'), [
    { role: 'user', message_id: 'u1', content: storedPrompts.mistral },
    { role: 'assistant', message_id: 'a1', content: 'Oui, le bail de Société Exemple SAS est résilié.' },
  ].map((record) => JSON.stringify(record)).join('\n'));

  const vibe = new MistralSessionsProvider();
  const raw = await vibe.fetchHistory('session', { providerSessionId: vibeSessionId });
  assert.equal(raw.messages.find((event) => event.role === 'user')?.content, storedPrompts.mistral);
  const { sessions } = await harness(t, 'mistral', raw.messages);
  const history = await sessions.fetchHistory('session');
  const user = history.messages.find((event) => event.role === 'user');
  assert.equal(user?.content, displayedQuestion.mistral);
  for (const event of history.messages) assertNoBlock(event.content);

  const echo = { id: 'u1', sessionId: vibeSessionId, turnId: null, type: 'message', role: 'user', content: [{ type: 'text', text: storedPrompts.mistral }] };
  assert.equal(isReplayedVibeHistoryEntry(echo), true);
  assert.deepEqual(vibe.normalizeMessage({ ...echo, turnId: 't1' }, 'session'), []);
});

test('recherche : correspondance et extrait calculés sans le bloc', () => {
  const seen: string[] = [];
  const search = withoutCitationInstructionsInSearch({
    matchesQuery: (text) => { seen.push(text); return /affirmation/.test(text); },
    buildSnippet: (text) => text,
  });
  for (const provider of providers) {
    assert.equal(search.matchesQuery(storedPrompts[provider]), false);
    assertNoBlock(search.buildSnippet(storedPrompts[provider]));
  }
  for (const text of seen) assertNoBlock(text);
});
