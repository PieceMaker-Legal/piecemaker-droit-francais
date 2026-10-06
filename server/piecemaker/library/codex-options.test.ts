import assert from 'node:assert/strict';
import test from 'node:test';

import { Codex } from '@openai/codex-sdk';
import type { Thread } from '@openai/codex-sdk';

import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import type { ProviderRuntimeContext } from '@/shared/index.js';

import { buildCodexClientOptions } from './codex-options.js';

test('buildCodexClientOptions masque les skills de la bibliothèque par chemin', () => {
  assert.equal(buildCodexClientOptions(undefined), undefined);
  assert.equal(buildCodexClientOptions([]), undefined);
  assert.equal(buildCodexClientOptions([{ path: 'relatif/SKILL.md' }, { path: '' }, { name: 'x' }, null, 'x']), undefined);
  assert.deepEqual(buildCodexClientOptions([
    { name: 'a', path: '/home/u/.agents/skills/a/SKILL.md' },
    { name: 'a', path: '/home/u/.agents/skills/a/SKILL.md' },
    { name: 'b', path: '/home/u/.agents/skills/b b/SKILL.md' },
  ]), { config: { skills: { config: [
    { path: '/home/u/.agents/skills/a/SKILL.md', enabled: false },
    { path: '/home/u/.agents/skills/b b/SKILL.md', enabled: false },
  ] } } });
});

for (const resumed of [false, true]) {
  test(`exception CloudCLI : Codex ${resumed ? 'reprend' : 'démarre'} avec les skills désactivés du dossier en --config`, async (t) => {
    const seen: Array<unknown> = [];
    const thread = {
      id: 'native-thread',
      async runStreamed() { return { events: (async function* () { yield { type: 'thread.started', thread_id: 'native-thread' }; })() }; },
    } as unknown as Thread;
    const pick = function (this: { exec: { configOverrides: unknown } }) { seen.push(this.exec.configOverrides); return thread; };
    t.mock.method(Codex.prototype, 'startThread', pick);
    t.mock.method(Codex.prototype, 'resumeThread', pick);
    const context: ProviderRuntimeContext = {
      resolveProviderSessionId: () => resumed ? 'native-thread' : null,
      resolveResumeModel: async () => 'test-model',
      getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
      normalizeMessage: () => [],
      isProviderInstalled: async () => true,
    };
    const writer = { isWebSocketWriter: true, send: () => {} };
    const disabled = [{ name: 'beta', path: '/home/u/.agents/skills/beta/SKILL.md' }];
    await codexRuntime.run('salut', { sessionId: resumed ? 'app-session' : undefined, cwd: process.cwd(), libraryCodexOptions: buildCodexClientOptions(disabled) }, writer, context);
    await codexRuntime.run('salut', { sessionId: resumed ? 'app-session' : undefined, cwd: process.cwd() }, writer, context);
    assert.deepEqual(seen, [{ skills: { config: [{ path: disabled[0].path, enabled: false }] } }, undefined]);
  });
}
