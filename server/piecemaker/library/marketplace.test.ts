import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { once } from 'node:events';

import express from 'express';

import { createLibraryMarketplaceRouter, scanInstalledLibraryCollections } from './marketplace.js';
import { createLibraryRouter } from './routes.js';
import { createLibraryStore } from './store.js';

test('installed Claude plugins import skills, agents and MCP into a collection', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-library-plugin-'));
  const userHome = path.join(root, 'home');
  const store = createLibraryStore(path.join(root, '.piecemaker'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const installPath = path.join(userHome, '.claude', 'plugins', 'cache', 'mcp-legifrance', 'legifrance', '1.0.0');
  fs.mkdirSync(path.join(installPath, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(installPath, 'skills', 'recherche'), { recursive: true });
  fs.writeFileSync(path.join(installPath, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'legifrance', displayName: 'MCP Légifrance', description: 'Sources officielles.' }));
  fs.writeFileSync(path.join(installPath, '.mcp.json'), JSON.stringify({ mcpServers: { legifrance: { command: 'python3', args: ['server.py'] } } }));
  fs.writeFileSync(path.join(installPath, 'skills', 'recherche', 'SKILL.md'), '---\nname: Recherche\ndescription: Chercher.\n---\nInstructions.');
  fs.mkdirSync(path.join(userHome, '.claude', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(userHome, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
    plugins: { 'legifrance@mcp-legifrance': [{ scope: 'user', installPath }] },
  }));

  scanInstalledLibraryCollections(store, userHome);
  const collection = store.listCollections()[0];
  assert.equal(collection.id, 'legifrance@mcp-legifrance');
  assert.equal(collection.componentCount, 2);
  const listed = store.list();
  assert.equal(listed.find((entry) => entry.kind === 'connector')?.collectionId, 'legifrance@mcp-legifrance');
  assert.equal(listed.find((entry) => entry.kind === 'skill')?.collectionId, 'legifrance@mcp-legifrance');
  assert.equal(listed.filter((entry) => !entry.collectionId).length, 0);
});

async function served(router: express.Router, run: (call: (method: string, url: string, body?: unknown) => Promise<any>) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Adresse HTTP indisponible.');
  try {
    await run(async (method, url, body) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${url}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return response.json();
    });
  } finally { server.close(); }
}

test('a Claude plugin is switched natively per dossier and globally without one driving the other', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-library-native-'));
  const userHome = path.join(root, 'home');
  const workspace = path.join(root, 'case');
  const id = 'legifrance@mcp-legifrance';
  const store = createLibraryStore(path.join(root, '.piecemaker'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const installPath = path.join(userHome, '.claude', 'plugins', 'cache', 'mcp-legifrance', 'legifrance', '1.0.0');
  fs.mkdirSync(path.join(installPath, 'skills', 'recherche'), { recursive: true });
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(installPath, '.mcp.json'), JSON.stringify({ mcpServers: { legifrance: { command: 'python3', args: ['server.py'] } } }));
  fs.writeFileSync(path.join(installPath, 'skills', 'recherche', 'SKILL.md'), '---\nname: recherche\ndescription: Chercher.\n---\nInstructions.');
  fs.writeFileSync(path.join(userHome, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { [id]: [{ scope: 'user', installPath }] } }));
  const userSettings = path.join(userHome, '.claude', 'settings.json');
  fs.writeFileSync(userSettings, JSON.stringify({ model: 'opus', enabledPlugins: { [id]: false } }));
  const localSettings = () => JSON.parse(fs.readFileSync(path.join(workspace, '.claude', 'settings.local.json'), 'utf8')).enabledPlugins;
  scanInstalledLibraryCollections(store, userHome);

  await served(createLibraryMarketplaceRouter(store, process.cwd(), userHome), async (call) => {
    const activated = await call('PUT', `/plugins/${encodeURIComponent(id)}/activation`, { workspacePath: workspace, enabled: true });
    assert.equal(activated.enabled, true);
    assert.equal(activated.global, false);
    assert.deepEqual(localSettings(), { [id]: true });
    assert.equal(fs.existsSync(path.join(workspace, '.claude', 'skills')), false);
    assert.equal(fs.existsSync(path.join(workspace, '.mcp.json')), false);
    assert.ok(fs.existsSync(path.join(workspace, '.agents', 'skills', 'recherche', 'SKILL.md')));
    assert.ok(JSON.parse(fs.readFileSync(path.join(workspace, '.cursor', 'mcp.json'), 'utf8')).mcpServers.legifrance);

    const synchronized = await call('POST', '/plugins/sync', { workspacePath: workspace });
    assert.equal(synchronized.plugins[0].enabled, true);
    assert.equal(JSON.parse(fs.readFileSync(userSettings, 'utf8')).enabledPlugins[id], false);

    await call('PUT', `/plugins/${encodeURIComponent(id)}/global`, { enabled: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(userSettings, 'utf8')), { model: 'opus', enabledPlugins: { [id]: true } });
    const excluded = await call('PUT', `/plugins/${encodeURIComponent(id)}/activation`, { workspacePath: workspace, enabled: false });
    assert.equal(excluded.enabled, false);
    assert.equal(excluded.global, true);
    assert.deepEqual(localSettings(), { [id]: false });
    assert.equal(fs.existsSync(path.join(workspace, '.agents', 'skills', 'recherche')), false);

    await call('PUT', `/plugins/${encodeURIComponent(id)}/global`, { enabled: false });
    await call('PUT', `/plugins/${encodeURIComponent(id)}/activation`, { workspacePath: workspace, enabled: false });
    assert.deepEqual(localSettings(), {});
  });
});

test('the catalogue names the providers that load an entry everywhere', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-library-global-'));
  const userHome = path.join(root, 'home');
  const store = createLibraryStore(path.join(root, '.piecemaker'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const skill = path.join(userHome, '.claude', 'skills', 'review', 'SKILL.md');
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, '---\nname: review\ndescription: Relire.\n---\nInstructions.');
  fs.writeFileSync(path.join(userHome, '.claude.json'), JSON.stringify({ mcpServers: { registre: { type: 'http', url: 'https://example.test/mcp' } } }));
  store.importFile(skill, 'skill');
  store.createEntry('skill', 'Local', '');
  store.importConnector({ name: 'registre', description: '', config: { transport: 'http', url: 'https://example.test/mcp' }, source: `${path.join(userHome, '.claude.json')}#registre` });

  await served(createLibraryRouter(store, userHome), async (call) => {
    const { entries } = await call('GET', '/catalog');
    const providers = Object.fromEntries(entries.map((entry: { name: string; globalProviders: string[] }) => [entry.name, entry.globalProviders]));
    assert.deepEqual(providers, { Local: [], registre: ['Claude'], review: ['Claude'] });
    fs.rmSync(path.dirname(skill), { recursive: true });
    const after = await call('GET', '/catalog');
    assert.deepEqual(after.entries.find((entry: { name: string }) => entry.name === 'review').globalProviders, []);
  });
});
