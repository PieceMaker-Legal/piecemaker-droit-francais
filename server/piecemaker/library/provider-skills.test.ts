import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { LLMProvider } from '@/shared/types.js';

import { listLibraryProviderSkills, scanAndPersistLibraryProviderSkills } from './provider-skills.js';
import { createLibraryStore } from './store.js';

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

test('provider skill scans persist the catalogue without duplicating or replacing edits', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-library-scan-'));
  const source = path.join(root, 'SKILL.md');
  const store = createLibraryStore(path.join(root, '.piecemaker'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(source, '---\nname: Relire\ndescription: Initiale\n---\nInstructions initiales.');
  const reader = {
    async listProviderSkills(provider: string) {
      if (provider !== 'claude') return [];
      return [{ provider: 'claude' as const, name: 'Relire', description: 'Initiale', command: '/relire', scope: 'user' as const, sourcePath: source }];
    },
  };

  const listed = await listLibraryProviderSkills(undefined, reader);
  assert.equal(listed.providers[0].skills[0].sourcePath, source);
  assert.equal(store.list().length, 0);
  await scanAndPersistLibraryProviderSkills(store, undefined, reader);
  const first = store.list();
  assert.equal(first.length, 1);
  const id = first[0].id;
  const original = store.document(id).content;
  store.updateDocument(id, original.replace('Instructions initiales.', 'Instructions adaptées.'), original);
  await scanAndPersistLibraryProviderSkills(store, undefined, reader);
  assert.equal(store.list().length, 1);
  assert.match(store.document(id).content, /Instructions adaptées/);

  fs.writeFileSync(source, '---\nname: Relire\ndescription: Source changée\n---\nInstructions externes.');
  await scanAndPersistLibraryProviderSkills(store, undefined, reader);
  assert.equal(store.list().length, 1);
  assert.match(store.document(id).content, /Instructions adaptées/);
});
