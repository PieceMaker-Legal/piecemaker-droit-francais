import assert from 'node:assert/strict';
import test from 'node:test';

import { Codex } from '@openai/codex-sdk';
import type { Thread, ThreadOptions } from '@openai/codex-sdk';

import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import type { ProviderRuntimeContext } from '@/shared/index.js';

import { installCodexPlanRuntime } from './codex-plan.js';

type Call = { provider: string; command: string; options: Record<string, unknown> };

function wrappedRuntime() {
  const calls: Call[] = [];
  const runtime = {
    run: async (provider: string, command: string, options: Record<string, unknown>) => { calls.push({ provider, command, options }); },
  };
  installCodexPlanRuntime(runtime as never);
  return { calls, run: runtime.run as (provider: string, command: string, options: Record<string, unknown>, writer: unknown) => Promise<void> };
}

test('/plan dans un message Codex passe en mode plan et garde les skills masqués', async () => {
  const { calls, run } = wrappedRuntime();
  const skills = { config: { skills: { config: [{ path: '/home/u/.agents/skills/a/SKILL.md', enabled: false }] } } };
  await run('codex', '/plan trie les pièces', { permissionMode: 'bypassPermissions', libraryCodexOptions: skills }, null);
  assert.equal(calls[0].command, 'trie les pièces');
  assert.equal(calls[0].options.permissionMode, 'plan');
  const config = (calls[0].options.libraryCodexOptions as { config: Record<string, unknown> }).config;
  assert.deepEqual(config.skills, skills.config.skills);
  assert.match(String(config.developer_instructions), /<proposed_plan>/);
});

test('le mode Plan choisi ajoute la consigne sans toucher au message', async () => {
  const { calls, run } = wrappedRuntime();
  await run('codex', 'trie les pièces', { permissionMode: 'plan' }, null);
  assert.equal(calls[0].command, 'trie les pièces');
  assert.match(String((calls[0].options.libraryCodexOptions as { config: Record<string, unknown> }).config.developer_instructions), /<proposed_plan>/);
});

test('sans /plan ni mode Plan, ni Codex ni les autres providers ne changent', async () => {
  const { calls, run } = wrappedRuntime();
  await run('codex', 'trie les pièces', { permissionMode: 'acceptEdits' }, null);
  await run('claude', '/plan trie les pièces', { permissionMode: 'default' }, null);
  assert.deepEqual(calls, [
    { provider: 'codex', command: 'trie les pièces', options: { permissionMode: 'acceptEdits' } },
    { provider: 'claude', command: '/plan trie les pièces', options: { permissionMode: 'default' } },
  ]);
});

test('exception CloudCLI : Codex en mode plan tourne en lecture seule', async (t) => {
  let options: ThreadOptions | undefined;
  const thread = {
    id: 'native-thread',
    async runStreamed() { return { events: (async function* () { yield { type: 'thread.started', thread_id: 'native-thread' }; })() }; },
  } as unknown as Thread;
  t.mock.method(Codex.prototype, 'startThread', (threadOptions: ThreadOptions) => { options = threadOptions; return thread; });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => 'test-model',
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
  };
  await codexRuntime.run('salut', { cwd: process.cwd(), permissionMode: 'plan' }, { isWebSocketWriter: true, send: () => {} }, context);
  assert.equal(options?.sandboxMode, 'read-only');
  assert.equal(options?.approvalPolicy, 'never');
});
