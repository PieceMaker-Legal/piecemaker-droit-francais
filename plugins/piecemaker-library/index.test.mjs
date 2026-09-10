import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { mount, normalizeSkill, unmount } from './index.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fixture(t, rpc) {
  const dom = new JSDOM('<main></main>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CustomEvent = dom.window.CustomEvent;
  const container = document.querySelector('main');
  let contextListener;
  const api = {
    context: { project: { path: '/case-a', name: 'A' }, session: null, theme: 'light' },
    rpc,
    onContextChange: (listener) => { contextListener = listener; return () => { contextListener = null; }; },
  };
  t.after(() => { unmount(container); dom.window.close(); });
  mount(container, api);
  return { container, change: (path) => contextListener({ ...api.context, project: { path, name: path } }) };
}

test('metadata list stays private until a document is explicitly opened', async (t) => {
  const calls = [];
  const { container } = fixture(t, async (method, path) => {
    calls.push([method, path]);
    if (path.startsWith('/catalog?')) return { entries: [{ id: 'abc', name: 'Relire', description: 'Vérifier les dates.', kind: 'skill', enabled: false }] };
    if (path.startsWith('/provider-skills?')) return { providers: [{ provider: 'codex', skills: [{ name: 'Analyser', scope: 'project', command: '$analyser', sourcePath: '/case-a/.agents/skills/analyser/SKILL.md' }] }] };
    return { name: 'Relire', content: '# Instructions', assets: {} };
  });
  await settle();
  assert.match(container.textContent, /Vérifier les dates/);
  assert.match(container.textContent, /codex · project · \$analyser/);
  assert.match(container.textContent, /\.agents\/skills\/analyser\/SKILL\.md/);
  assert.equal(container.querySelector('[role=switch]').checked, false);
  assert.equal(calls.length, 2);
  let opened;
  window.addEventListener('piecemaker:library-document', (event) => { opened = event.detail; });
  [...container.querySelectorAll('button')].find((button) => button.textContent === 'Relire').click();
  await settle();
  assert.equal(opened.name, 'Relire');
  assert.equal(opened.content, '# Instructions');
  assert.equal(opened.container, container.querySelector('.pm-library').parentElement);
});

test('a toggle sends the current dossier and no global activation', async (t) => {
  const writes = [];
  const { container } = fixture(t, async (method, path, body) => {
    if (method === 'PUT') { writes.push({ path, body }); return { ok: true }; }
    return { entries: [{ id: 'abc', name: 'Relire', description: '', kind: 'skill', enabled: false }] };
  });
  await settle();
  container.querySelector('[role=switch]').click();
  await settle();
  assert.deepEqual(writes, [{ path: '/catalog/abc/activation', body: { workspacePath: '/case-a', enabled: true } }]);
});

test('a stale dossier response cannot replace the current dossier', async (t) => {
  let resolveFirst;
  const { container, change } = fixture(t, (method, path) => {
    if (path.startsWith('/provider-skills')) return Promise.resolve({ providers: [] });
    if (path.includes('case-a')) return new Promise((resolve) => { resolveFirst = resolve; });
    return Promise.resolve({ entries: [{ id: 'new', name: 'Dossier B', description: '', kind: 'skill', enabled: false }] });
  });
  change('/case-b');
  await settle();
  resolveFirst({ entries: [{ id: 'old', name: 'Dossier A', description: '', kind: 'skill', enabled: true }] });
  await settle();
  assert.match(container.textContent, /Dossier B/);
  assert.doesNotMatch(container.textContent, /Dossier A/);
});

test('provider skills are normalized for every platform and only project scopes retain dossier metadata', () => {
  for (const provider of ['claude', 'codex', 'cursor', 'mistral', 'opencode']) {
    const normalized = normalizeSkill(provider, {
      name: null,
      description: 42,
      command: undefined,
      sourcePath: 7,
      scope: 'invalid',
      projectPath: '/leak',
      projectDisplayName: 'Leak',
    });
    assert.deepEqual(normalized, {
      provider,
      name: '',
      description: '42',
      command: '',
      scope: 'user',
      sourcePath: '7',
    });
  }

  for (const scope of ['project', 'repo']) {
    const normalized = normalizeSkill('claude', { scope, projectPath: '/fallback', projectDisplayName: 'Fallback' }, { path: '/case-a', displayName: 'Dossier A' });
    assert.equal(normalized.scope, scope);
    assert.equal(normalized.projectPath, '/case-a');
    assert.equal(normalized.projectDisplayName, 'Dossier A');
  }

  for (const scope of ['user', 'plugin', 'admin', 'system']) {
    const normalized = normalizeSkill('codex', { scope, projectPath: '/leak', projectDisplayName: 'Leak' });
    assert.equal(normalized.scope, scope);
    assert.equal('projectPath' in normalized, false);
    assert.equal('projectDisplayName' in normalized, false);
  }
});
