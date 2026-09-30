import assert from 'node:assert/strict';
import test from 'node:test';

import { Codex } from '@openai/codex-sdk';
import type { Thread, ThreadOptions } from '@openai/codex-sdk';

import { buildCodexClientOptions, codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import type { ProviderRuntimeContext } from '@/shared/index.js';

for (const resumed of [false, true]) {
  for (const permissionMode of [undefined, 'default', 'unknown', 'acceptEdits', 'bypassPermissions']) {
    test(`Codex ${resumed ? 'resumes' : 'starts'} with supported permissions (${permissionMode ?? 'omitted'})`, async (t) => {
      let capturedOptions: ThreadOptions | undefined;
      let capturedPrompt: unknown;
      const messages: unknown[] = [];
      const thread = {
        id: 'native-thread',
        async runStreamed(prompt: unknown) {
          capturedPrompt = prompt;
          return { events: (async function* () {
            yield { type: 'thread.started', thread_id: 'native-thread' };
          })() };
        },
      } as unknown as Thread;

      const start = t.mock.method(Codex.prototype, 'startThread', (options?: ThreadOptions) => {
        capturedOptions = options;
        return thread;
      });
      const resume = t.mock.method(Codex.prototype, 'resumeThread', (id: string, options?: ThreadOptions) => {
        assert.equal(id, 'native-thread');
        capturedOptions = options;
        return thread;
      });
      const context: ProviderRuntimeContext = {
        resolveProviderSessionId: () => resumed ? 'native-thread' : null,
        resolveResumeModel: async () => 'test-model',
        getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
        normalizeMessage: () => [],
        isProviderInstalled: async () => true,
      };

      await codexRuntime.run('hey there', {
        sessionId: resumed ? 'app-session' : undefined,
        permissionMode,
        cwd: process.cwd(),
      }, { isWebSocketWriter: true, send: (message) => messages.push(message) }, context);

      assert.equal(start.mock.callCount(), resumed ? 0 : 1);
      assert.equal(resume.mock.callCount(), resumed ? 1 : 0);
      assert.equal(capturedPrompt, 'hey there');
      assert.equal(capturedOptions?.sandboxMode, permissionMode === 'bypassPermissions' ? 'danger-full-access' : 'workspace-write');
      assert.equal(capturedOptions?.approvalPolicy, permissionMode === 'acceptEdits' || permissionMode === 'bypassPermissions' ? 'never' : 'on-request');
      assert.ok(messages.some((message: any) => message.kind === 'complete' && message.exitCode === 0));
      assert.ok(!messages.some((message: any) => message.kind === 'error'));
    });
  }
}

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
  test(`Codex ${resumed ? 'reprend' : 'démarre'} avec les skills masqués en --config`, async (t) => {
    const seen: Array<unknown> = [];
    const thread = {
      id: 'native-thread',
      async runStreamed() { return { events: (async function* () { yield { type: 'thread.started', thread_id: 'native-thread' }; })() }; },
    } as unknown as Thread;
    const pick = function (this: any) { seen.push(this.exec.configOverrides); return thread; };
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
    await codexRuntime.run('salut', { sessionId: resumed ? 'app-session' : undefined, cwd: process.cwd(), libraryDisabledSkills: disabled }, writer, context);
    await codexRuntime.run('salut', { sessionId: resumed ? 'app-session' : undefined, cwd: process.cwd() }, writer, context);
    assert.deepEqual(seen, [{ skills: { config: [{ path: disabled[0].path, enabled: false }] } }, undefined]);
  });
}
