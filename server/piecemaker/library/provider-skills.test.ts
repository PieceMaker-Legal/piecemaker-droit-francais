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

test('provider skill scans ignore plugin and project scopes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-library-skip-'));
  const userSkill = path.join(root, 'user.md');
  const pluginSkill = path.join(root, 'plugin.md');
  const projectSkill = path.join(root, 'project.md');
  const store = createLibraryStore(path.join(root, '.piecemaker'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  for (const [file, name] of [[userSkill, 'User'], [pluginSkill, 'Plugin'], [projectSkill, 'Project']] as const) {
    fs.writeFileSync(file, `---\nname: ${name}\ndescription: ${name}\n---\n${name}.`);
  }
  const reader = {
    async listProviderSkills() {
      return [
        { provider: 'claude' as const, name: 'User', description: 'User', command: '/user', scope: 'user' as const, sourcePath: userSkill },
        { provider: 'claude' as const, name: 'Plugin', description: 'Plugin', command: '/plugin', scope: 'plugin' as const, sourcePath: pluginSkill, pluginId: 'legal@market' },
        { provider: 'claude' as const, name: 'Project', description: 'Project', command: '/project', scope: 'project' as const, sourcePath: projectSkill },
      ];
    },
  };
  await scanAndPersistLibraryProviderSkills(store, '/dossier', reader);
  assert.deepEqual(store.list().map((entry) => entry.name), ['User']);
});

test('provider skill scans import Grok user skills from disk', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-library-grok-'));
  const userHome = path.join(root, 'home');
  const grokSkill = path.join(userHome, '.grok', 'skills', 'relire');
  const store = createLibraryStore(path.join(root, '.piecemaker'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(grokSkill, { recursive: true });
  fs.writeFileSync(path.join(grokSkill, 'SKILL.md'), '---\nname: Relire Grok\ndescription: Grok.\n---\nInstructions Grok.');
  const reader = { async listProviderSkills() { return []; } };
  await scanAndPersistLibraryProviderSkills(store, undefined, reader, userHome);
  assert.deepEqual(store.list().map((entry) => entry.name), ['Relire Grok']);
});
