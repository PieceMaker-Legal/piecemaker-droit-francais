import assert from 'node:assert/strict';
import test from 'node:test';

import type { LLMProvider } from '@/shared/types.js';

import { listLibraryProviderSkills } from './provider-skills.js';

test('library provider skills include every provider and isolate failures', async () => {
  const calls: Array<{ provider: string; workspacePath: string | undefined }> = [];
  const reader = {
    async listProviderSkills(provider: string, options?: { workspacePath?: string }) {
      calls.push({ provider, workspacePath: options?.workspacePath });
      if (provider === 'cursor') throw new Error('Cursor indisponible');
      return [{ provider: provider as LLMProvider, name: `${provider}-skill`, description: '', command: `/${provider}`, scope: 'user' as const, sourcePath: `/${provider}/SKILL.md` }];
    },
  };

  const result = await listLibraryProviderSkills('/dossier', reader);

  assert.deepEqual(calls.map(({ provider }) => provider), ['claude', 'codex', 'cursor', 'mistral', 'opencode']);
  assert.ok(calls.every(({ workspacePath }) => workspacePath === '/dossier'));
  assert.equal(result.providers.find(({ provider }) => provider === 'cursor')?.error, 'Cursor indisponible');
  assert.deepEqual(result.providers.find(({ provider }) => provider === 'cursor')?.skills, []);
  assert.equal(result.providers.filter(({ skills }) => skills.length === 1).length, 4);
});
