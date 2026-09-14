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
    return { name: 'Relire', content: '# Instructions', assets: {} };
  });
  await settle();
  assert.match(container.textContent, /Vérifier les dates/);
  assert.doesNotMatch(container.textContent, /Skills détectées/);
  assert.doesNotMatch(container.textContent, /Aucune skill détectée/);
  assert.equal(container.querySelector('[role=switch]').checked, false);
  assert.equal(calls.length, 1);
  let opened;
  window.addEventListener('piecemaker:library-document', (event) => { opened = event.detail; });
  [...container.querySelectorAll('button')].find((button) => button.textContent === 'Relire').click();
  await settle();
  assert.equal(opened.name, 'Relire');
  assert.equal(opened.content, '# Instructions');
  assert.equal(opened.container, container.querySelector('.pm-library').parentElement);
});

test('connectors, skills, plugins and agents have separate tabs', async (t) => {
  const writes = [];
  const { container } = fixture(t, async (method, path, body) => {
    if (path.startsWith('/catalog?')) return { entries: [] };
    if (path.startsWith('/plugins?')) return { plugins: [{ id: 'legal@market', name: 'Plugin légal', description: 'Recherche', enabled: false, partial: false }] };
    if (path.endsWith('/files')) return { files: [{ path: 'skills/recherche/SKILL.md', size: 120, editable: true }] };
    if (path.includes('/file?')) return { path: 'skills/recherche/SKILL.md', content: 'Instructions plugin' };
    if (method === 'PUT' && path.endsWith('/file')) { writes.push({ path, body }); return { ok: true }; }
    if (path.startsWith('/plugin/marketplace?')) return { registered: true, plugins: [] };
    if (path.startsWith('/activation?')) return { claude: { mcp: [{ id: 'legifrance@mcp-legifrance', name: 'MCP Légifrance', enabled: true, toggleable: true, family: 'plugin', protocol: 'MCP' }], plugins: [] }, codex: { mcp: [] } };
    return { ok: true };
  });
  await settle();
  const libraryTabs = container.querySelector('[role=tablist][aria-label="Bibliothèque"]');
  assert.deepEqual([...libraryTabs.querySelectorAll('[role=tab]')].map((button) => button.textContent), ['Connecteurs', 'Skills', 'Plugins', 'Agents']);
  [...libraryTabs.querySelectorAll('[role=tab]')].find((button) => button.textContent === 'Connecteurs').click();
  await settle();
  assert.match(container.textContent, /MCP Légifrance/);
  [...libraryTabs.querySelectorAll('[role=tab]')].find((button) => button.textContent === 'Plugins').click();
  await settle();
  assert.match(container.textContent, /Plugin légal/);
  [...container.querySelectorAll('button')].find((button) => button.textContent === 'Voir l’arborescence').click();
  await settle();
  [...container.querySelectorAll('button')].find((button) => button.textContent.includes('SKILL.md')).click();
  await settle();
  let opened;
  window.addEventListener('piecemaker:library-document', (event) => { opened = event.detail; }, { once: true });
  [...container.querySelectorAll('button')].find((button) => button.textContent.includes('SKILL.md')).click();
  await settle();
  assert.equal(opened.editorPath, 'skills/recherche/SKILL.md');
  await opened.save('Instructions adaptées');
  assert.deepEqual(writes, [{ path: '/plugins/legal%40market/file', body: { path: 'skills/recherche/SKILL.md', content: 'Instructions adaptées', previousContent: 'Instructions plugin' } }]);
  [...libraryTabs.querySelectorAll('[role=tab]')].find((button) => button.textContent === 'Connecteurs').click();
  await settle();
  assert.match(container.textContent, /MCP Légifrance/);
});

test('a toggle sends the current dossier and no global activation', async (t) => {
  const writes = [];
  const { container } = fixture(t, async (method, path, body) => {
    if (method === 'PUT') { writes.push({ path, body }); return { ok: true }; }
    return { entries: [{ id: 'abc', name: 'Relire', description: '', kind: 'skill', enabled: false }] };
  });
  await settle();
  assert.equal(container.querySelector('[role=switch]').title, 'Installer dans ce dossier');
  assert.doesNotMatch(container.textContent, /Dans ce dossier/);
  container.querySelector('[role=switch]').click();
  await settle();
  assert.deepEqual(writes, [{ path: '/catalog/abc/activation', body: { workspacePath: '/case-a', enabled: true } }]);
  assert.equal(container.querySelector('[role=switch]').title, 'Retirer de ce dossier');
});

test('each section switches between personal items and its filtered marketplace', async (t) => {
  const calls = [];
  const { container } = fixture(t, async (method, path) => {
    calls.push([method, path]);
    if (path.startsWith('/catalog?')) return { entries: [] };
    if (path.includes('scope=piecemaker&kind=connector')) return { registered: true, plugins: [{ id: 'piecemaker@mcp-legifrance', name: 'MCP Légifrance', description: 'Droit français' }] };
    if (path.startsWith('/plugin/marketplace?')) return { registered: true, plugins: [] };
    if (path.startsWith('/activation?')) return { claude: { mcp: [], plugins: [] }, codex: { mcp: [] } };
    return { plugins: [] };
  });
  await settle();
  let views = container.querySelector('[role=tablist][aria-label="Vue des skills"]');
  assert.deepEqual([...views.querySelectorAll('[role=tab]')].map((button) => button.textContent), ['Mes skills', 'Découvrir']);
  views.querySelector('[role=tab]:last-child').click();
  await settle();
  assert.equal(calls.some(([, path]) => path.includes('kind=skill')), true);
  const libraryTabs = container.querySelector('[role=tablist][aria-label="Bibliothèque"]');
  [...libraryTabs.querySelectorAll('[role=tab]')].find((button) => button.textContent === 'Connecteurs').click();
  await settle();
  views = container.querySelector('[role=tablist][aria-label="Vue des connecteurs"]');
  assert.deepEqual([...views.querySelectorAll('[role=tab]')].map((button) => button.textContent), ['Mes connecteurs', 'Découvrir']);
  views.querySelector('[role=tab]:last-child').click();
  await settle();
  assert.match(container.textContent, /MCP Légifrance/);
  assert.equal(calls.some(([, path]) => path.includes('scope=piecemaker&kind=connector')), true);
});

test('a skill action menu permanently deletes it from the library', async (t) => {
  const calls = [];
  let deleted = false;
  const id = 'a'.repeat(64);
  const { container } = fixture(t, async (method, path) => {
    calls.push([method, path]);
    if (method === 'DELETE' && path === `/catalog/${id}`) { deleted = true; return { ok: true }; }
    if (path.startsWith('/catalog?')) return { entries: deleted ? [] : [{ id, name: 'Relire', description: '', kind: 'skill', enabled: false }] };
    return { ok: true };
  });
  await settle();
  assert.equal([...container.querySelectorAll('button')].some((item) => item.textContent === 'Supprimer'), false);
  container.querySelector('[aria-label="Actions pour Relire"]').click();
  assert.equal([...container.querySelectorAll('button')].some((item) => item.textContent === 'Supprimer'), true);
  [...container.querySelectorAll('button')].find((item) => item.textContent === 'Supprimer').click();
  await settle();
  await settle();
  assert.equal(calls.some(([method, path]) => method === 'DELETE' && path === `/catalog/${id}`), true);
  assert.doesNotMatch(container.textContent, /Relire/);
});

test('a stale dossier response cannot replace the current dossier', async (t) => {
  let resolveFirst;
  const { container, change } = fixture(t, (method, path) => {
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

test('creating a skill from the toolbar button posts to /catalog and refreshes the list', async (t) => {
  const calls = [];
  let created = false;
  const { container } = fixture(t, async (method, path, body) => {
    calls.push([method, path, body]);
    if (path.startsWith('/plugins?')) return { plugins: [] };
    if (method === 'POST' && path === '/catalog') {
      created = true;
      return { id: 'a'.repeat(64), kind: 'skill', name: body.name, description: body.description };
    }
    if (path.startsWith('/catalog?')) return { entries: created ? [{ id: 'a'.repeat(64), name: 'Nouveau', description: 'Desc', kind: 'skill', enabled: false }] : [] };
    return { entries: [] };
  });
  await settle();
  assert.equal(container.querySelector('[aria-label="Nom"]'), null);
  [...container.querySelectorAll('button')].find((button) => button.textContent === 'Nouveau skill').click();
  await settle();
  assert.match(container.textContent, /Nouveau skill/);
  container.querySelector('[aria-label="Nom"]').value = 'Nouveau';
  container.querySelector('[aria-label="Nom"]').dispatchEvent(new window.Event('input'));
  container.querySelector('[aria-label="Description"]').value = 'Desc';
  container.querySelector('[aria-label="Description"]').dispatchEvent(new window.Event('input'));
  [...container.querySelectorAll('button')].find((button) => button.textContent === 'Créer').click();
  await settle();
  await settle();
  assert.equal(calls.some(([method, path, body]) => method === 'POST' && path === '/catalog' && body.kind === 'skill' && body.name === 'Nouveau' && body.description === 'Desc'), true);
  assert.match(container.textContent, /Desc/);
});

test('the create dialog requires a name and can be cancelled', async (t) => {
  const calls = [];
  const { container } = fixture(t, async (method, path) => {
    calls.push([method, path]);
    if (path.startsWith('/plugins?')) return { plugins: [] };
    return { entries: [] };
  });
  await settle();
  [...container.querySelectorAll('button')].find((button) => button.textContent === 'Nouveau skill').click();
  await settle();
  [...container.querySelectorAll('button')].find((button) => button.textContent === 'Créer').click();
  await settle();
  assert.match(container.textContent, /Nom requis/);
  assert.equal(calls.some(([method, path]) => method === 'POST' && path === '/catalog'), false);
  [...container.querySelectorAll('button')].find((button) => button.textContent === 'Annuler').click();
  await settle();
  assert.equal(container.querySelector('[aria-label="Nom"]'), null);
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
