import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import test from 'node:test';

import { installSessionProxyRuntime, projectOfDirectory } from './session-runtime.js';

const PROJECTS = [
  { project_id: 'dossier-parent', project_path: '/cases/parent' },
  { project_id: 'dossier-enfant', project_path: '/cases/parent/enfant' },
];

test('le dossier d’une session est le plus profond qui contient son répertoire', () => {
  assert.equal(projectOfDirectory('/cases/parent/enfant/pieces', PROJECTS), 'dossier-enfant');
  assert.equal(projectOfDirectory('/cases/parent', PROJECTS), 'dossier-parent');
  assert.equal(projectOfDirectory('/cases/parentale', PROJECTS), null);
  assert.equal(projectOfDirectory('', PROJECTS), null);
});

test('chaque lancement de fournisseur se fait dans le dossier de sa session', async () => {
  const store = new AsyncLocalStorage<string | null>();
  const seen: Array<string | null | undefined> = [];
  const runtime: { run: (...args: unknown[]) => Promise<never> } = {
    run: async () => {
      await Promise.resolve();
      seen.push(store.getStore());
      return undefined as never;
    },
  };
  installSessionProxyRuntime(runtime as never, { runInProject: (projectId, run) => store.run(projectId, run) }, () => PROJECTS);
  await runtime.run('claude' as never, 'bonjour', { cwd: '/cases/parent/enfant' } as never, null as never);
  await runtime.run('codex' as never, 'bonjour', { projectPath: '/ailleurs' } as never, null as never);
  assert.deepEqual(seen, ['dossier-enfant', null]);
});

test('le proxy de la session porte le dossier dans l’environnement hérité par les sous-processus', async () => {
  const { createRequire } = await import('node:module');
  const { sessionProxyUrl, sessionScopedEnvironment } = createRequire(import.meta.url)('./service.cjs');
  const sessions = new AsyncLocalStorage<string>();
  const environment = sessionScopedEnvironment({ ...process.env, HTTPS_PROXY: 'http://127.0.0.1:4100' }, sessions);
  const url = sessionProxyUrl('http://127.0.0.1:4100', 'dossier-enfant', 'jeton');
  assert.equal(url, 'http://dossier-enfant:jeton@127.0.0.1:4100');
  const read = () => execFileSync('sh', ['-c', 'printf %s "$HTTPS_PROXY"'], { env: environment }).toString();
  assert.equal(read(), 'http://127.0.0.1:4100');
  await sessions.run(url, async () => {
    await Promise.resolve();
    assert.equal(read(), url);
    assert.equal({ ...environment }.HTTPS_PROXY, url);
  });
  assert.equal(environment.HTTPS_PROXY, 'http://127.0.0.1:4100');
});
