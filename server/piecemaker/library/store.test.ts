import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { createLibraryStore } from './store.js';

const require = createRequire(import.meta.url);
const TOML = require('@iarna/toml') as { parse(value: string): Record<string, unknown> };
import { importLibraryDirectory } from './migrate.js';
import { installLibraryRuntime, stripLibraryInstructions } from './runtime.js';

function fixture(t: { after: (fn: () => void) => void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-library-'));
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'case');
  const other = path.join(root, 'other');
  const skill = path.join(home, '.claude/skills/review');
  for (const directory of [workspace, other, skill]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: review\ndescription: |\n  Lire et comparer.\n  Vérifier les dates.\n---\nInstructions privées.');
  fs.writeFileSync(path.join(skill, 'table-columns.yaml'), 'columns:\n  - name: Date\n');
  const store = createLibraryStore(path.join(home, '.piecemaker'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, home, workspace, other, skill, store };
}

test('imports preserve YAML metadata and assets without publishing instructions', (t) => {
  const { store, skill, workspace } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  const list = store.list(workspace);
  assert.equal(list.length, 1);
  assert.equal(list[0].enabled, false);
  assert.equal(list[0].description, 'Lire et comparer.\nVérifier les dates.\n');
  assert.equal('content' in list[0], false);
  assert.equal(store.instructions(workspace), '');
  assert.equal(Buffer.from(store.document(id).assets['table-columns.yaml'], 'base64').toString(), 'columns:\n  - name: Date\n');
  assert.equal(fs.existsSync(path.join(store.directory, 'active')), false);
});

test('createEntry adds a listable entry with placeholder content and no assets', (t) => {
  const { store, workspace } = fixture(t);
  const created = store.createEntry('skill', ' Nouveau skill ', ' À utiliser pour... ');
  assert.match(created.id, /^[a-f0-9]{64}$/);
  assert.equal(created.kind, 'skill');
  assert.equal(created.name, 'Nouveau skill');
  assert.equal(created.description, 'À utiliser pour...');
  assert.match(created.content, /^---\nname: Nouveau skill\ndescription: À utiliser pour\.\.\.\n---\n/);
  assert.deepEqual(created.assets, {});
  const list = store.list(workspace);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Nouveau skill');
  assert.equal(list[0].enabled, false);
  const agent = store.createEntry('agent', 'Mon agent', '');
  assert.equal(agent.kind, 'agent');
  assert.match(agent.content, /Rôle et instructions de l’agent/);
  assert.throws(() => store.createEntry('skill', '   ', 'x'), /Nom requis/);
});

test('imports reject binary main documents before storing replacement characters', (t) => {
  const { store, skill } = fixture(t);
  fs.writeFileSync(path.join(skill, 'SKILL.md'), Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xc3, 0x28]));
  assert.throws(() => store.importFile(path.join(skill, 'SKILL.md'), 'skill'), /ne peut pas être modifié/);
});

test('activation is persistent, canonical and confined to the selected dossier', (t) => {
  const { store, skill, workspace, other, root, home } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  const alias = path.join(root, 'alias');
  fs.symlinkSync(workspace, alias);
  store.setEnabled(alias, id, true);
  assert.match(store.instructions(workspace), /Instructions privées/);
  assert.match(store.instructions(workspace), /columns:/);
  assert.equal(store.instructions(other), '');
  assert.equal(store.importFile(path.join(skill, 'SKILL.md'), 'skill'), id);
  assert.equal(store.list(workspace)[0].enabled, true);
  const reopened = createLibraryStore(path.join(home, '.piecemaker'));
  assert.equal(reopened.list(workspace)[0].enabled, true);
  reopened.close();
  store.setEnabled(workspace, id, false);
  assert.equal(store.instructions(workspace), '');
  assert.equal(store.list(workspace)[0].enabled, false);
  assert.throws(() => store.setEnabled(workspace, id, 'true'));
  assert.throws(() => store.setEnabled('../case', id, true));
  assert.throws(() => store.setEnabled(workspace, '../missing', true));
});

test('deleting a skill removes every active copy and its catalogue entry', (t) => {
  const { store, skill, workspace, other } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  store.setEnabled(workspace, id, true);
  store.setEnabled(other, id, true);
  store.deleteEntry(id);
  assert.equal(store.list(workspace).length, 0);
  assert.equal(store.instructions(workspace), '');
  for (const selected of [workspace, other]) {
    for (const provider of ['.claude', '.agents', '.cursor', '.opencode', '.grok']) {
      assert.equal(fs.existsSync(path.join(selected, provider, 'skills', 'review')), false);
    }
  }
  assert.throws(() => store.document(id), /introuvable/);
  const agent = store.createEntry('agent', 'Agent conservé', '');
  assert.throws(() => store.deleteEntry(agent.id), /Seuls les skills/);
});

test('confined plugin imports ignore symlinked component roots and documents', (t) => {
  const { root, skill, store } = fixture(t);
  const linkedRoot = path.join(root, 'linked-skills');
  fs.symlinkSync(path.dirname(skill), linkedRoot);
  assert.deepEqual(importLibraryDirectory(store, linkedRoot, 'skill', false), []);
  const pluginSkills = path.join(root, 'plugin-skills');
  const linkedSkill = path.join(pluginSkills, 'linked');
  fs.mkdirSync(linkedSkill, { recursive: true });
  fs.symlinkSync(path.join(skill, 'SKILL.md'), path.join(linkedSkill, 'SKILL.md'));
  assert.deepEqual(importLibraryDirectory(store, pluginSkills, 'skill', false), []);
});

test('library instructions are removed from echoes without rewriting user prose', () => {
  const prose = '/review relire';
  assert.equal(stripLibraryInstructions(`${prose}\n\n<PIECEMAKER_LIBRARY_INSTRUCTIONS>\nsecret\n</PIECEMAKER_LIBRARY_INSTRUCTIONS>`), prose);
  assert.equal(stripLibraryInstructions(prose), prose);
  assert.equal(stripLibraryInstructions('Mention <PIECEMAKER_LIBRARY_INSTRUCTIONS> dans le texte'), 'Mention <PIECEMAKER_LIBRARY_INSTRUCTIONS> dans le texte');
});

test('runtime injects only active dossier instructions and preserves the visible user message', async (t) => {
  const { store, workspace, other, skill } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  const commands: Array<{ provider: string; command: string }> = [];
  const received: unknown[] = [];
  const run: Parameters<typeof installLibraryRuntime>[0]['run'] = async (provider, command, _options, writer) => {
    commands.push({ provider, command });
    writer.send({ kind: 'text', role: 'user', content: command });
  };
  const runtime: Parameters<typeof installLibraryRuntime>[0] = { run, getRunner: (provider) => (command, options, writer) => run(provider, command, options, writer) };
  const sessions = { fetchHistory: async () => ({ messages: [] }) } as unknown as Parameters<typeof installLibraryRuntime>[1];
  installLibraryRuntime(runtime, sessions, store);
  const writer = { send: (value: unknown) => { received.push(value); } };
  await runtime.run('claude', 'Relire', { cwd: workspace }, writer);
  assert.equal(commands[0].command, 'Relire');
  store.setEnabled(workspace, id, true);
  for (const provider of ['claude', 'codex', 'cursor', 'mistral', 'opencode'] as const) {
    await runtime.getRunner(provider)('Relire', { cwd: workspace }, writer);
  }
  assert.deepEqual(commands.slice(1).map(({ provider }) => provider), ['claude', 'codex', 'cursor', 'mistral', 'opencode']);
  assert.ok(commands.slice(1).every(({ command }) => command.includes('Instructions privées')));
  assert.ok(received.slice(1).every((message) => JSON.stringify(message) === JSON.stringify({ kind: 'text', role: 'user', content: 'Relire' })));
  await runtime.run('codex', 'Relire', { cwd: other }, writer);
  assert.equal(commands[6].command, 'Relire');
  store.setEnabled(workspace, id, false);
  await runtime.run('codex', 'Relire', { cwd: workspace }, writer);
  assert.equal(commands[7].command, 'Relire');
});

test('editing updates YAML and active instructions without changing assets or activation', (t) => {
  const { store, skill, workspace, other, home } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  store.setEnabled(workspace, id, true);
  const before = store.document(id);
  const content = '---\nname: Relire\ndescription: Nouvelle description\n---\nNouvelles instructions';
  store.updateDocument(id, content, before.content);
  assert.equal(store.list(workspace)[0].name, 'Relire');
  assert.equal(store.list(workspace)[0].description, 'Nouvelle description');
  assert.equal(store.list(workspace)[0].enabled, true);
  assert.equal(store.list(other)[0].enabled, false);
  assert.deepEqual(store.document(id).assets, before.assets);
  assert.match(store.instructions(workspace), /Nouvelles instructions/);
  assert.equal(store.instructions(other), '');
  assert.throws(() => store.updateDocument(id, 'stale', before.content), /modifié ailleurs/);
  assert.throws(() => store.updateDocument(id, '---\nname: [invalid\n---', content));
  const reopened = createLibraryStore(path.join(home, '.piecemaker'));
  assert.equal(reopened.document(id).content, content);
  reopened.close();
});

test('plugin collections expose an editable tree and activate every imported component', async (t) => {
  const { store, skill, workspace } = fixture(t);
  const skillId = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  store.upsertCollection({
    id: 'legal-tools@marketplace',
    name: 'Legal tools',
    description: 'Outils juridiques',
    source: '/plugins/legal-tools',
    entries: [{ entryId: skillId, rootPath: 'skills/review' }],
    files: [{ path: 'manifest.json', content: Buffer.from('{"name":"legal-tools"}\n') }],
  });
  assert.deepEqual(store.collectionFiles('legal-tools@marketplace').map((file) => file.path), [
    'manifest.json',
    'skills/review/SKILL.md',
    'skills/review/table-columns.yaml',
  ]);
  const file = store.collectionFile('legal-tools@marketplace', 'skills/review/table-columns.yaml');
  assert.equal(file.content, 'columns:\n  - name: Date\n');
  store.updateCollectionFile('legal-tools@marketplace', file.path, 'columns:\n  - name: Échéance\n', file.content);
  assert.equal(store.collectionFile('legal-tools@marketplace', file.path).content, 'columns:\n  - name: Échéance\n');
  const manifest = store.collectionFile('legal-tools@marketplace', 'manifest.json');
  store.updateCollectionFile('legal-tools@marketplace', manifest.path, '{"name":"outils-juridiques"}\n', manifest.content);
  assert.match(store.collectionFile('legal-tools@marketplace', manifest.path).content, /outils-juridiques/);
  assert.throws(() => store.collectionFile('legal-tools@marketplace', '../catalog.sqlite'), /invalide/);
  const skillDocument = store.collectionFile('legal-tools@marketplace', 'skills/review/SKILL.md');
  assert.throws(() => store.updateCollectionFile('legal-tools@marketplace', skillDocument.path, `${skillDocument.content}\0`, skillDocument.content), /ne peut pas être modifié/);
  assert.throws(() => store.updateCollectionFile('legal-tools@marketplace', file.path, 'stale', file.content), /modifié ailleurs/);
  store.setCollectionEnabled(workspace, 'legal-tools@marketplace', true);
  assert.equal(store.listCollections(workspace)[0].enabled, true);
  assert.match(store.instructions(workspace), /Échéance/);
  store.setCollectionEnabled(workspace, 'legal-tools@marketplace', false);
  assert.equal(store.listCollections(workspace)[0].enabled, false);
});

test('plugins without portable components remain browsable and cannot be activated', (t) => {
  const { store, workspace } = fixture(t);
  store.upsertCollection({
    id: 'hooks-only@marketplace',
    name: 'Hooks only',
    description: '',
    source: '/plugins/hooks-only',
    entries: [],
    files: [{ path: 'hooks/pre-tool.sh', content: Buffer.from('exit 0\n') }],
  });
  assert.equal(store.listCollections(workspace)[0].componentCount, 0);
  assert.equal(store.collectionFile('hooks-only@marketplace', 'hooks/pre-tool.sh').content, 'exit 0\n');
  assert.throws(() => store.setCollectionEnabled(workspace, 'hooks-only@marketplace', true), /introuvable/);
});

test('collection files are read from source on first tree access', (t) => {
  const { store, root, workspace } = fixture(t);
  const source = path.join(root, 'plugin-source');
  fs.mkdirSync(path.join(source, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(source, 'manifest.json'), '{"name":"lazy"}\n');
  fs.writeFileSync(path.join(source, 'hooks', 'pre-tool.sh'), 'exit 0\n');
  store.upsertCollection({
    id: 'lazy@marketplace',
    name: 'Lazy plugin',
    description: '',
    source,
    entries: [],
    files: [],
  });
  assert.equal(store.listCollections(workspace)[0].name, 'Lazy plugin');
  assert.deepEqual(store.collectionFiles('lazy@marketplace').map((file) => file.path).sort(), [
    'hooks/pre-tool.sh',
    'manifest.json',
  ]);
  assert.equal(store.collectionFile('lazy@marketplace', 'manifest.json').content, '{"name":"lazy"}\n');
});

test('toggle installs and removes discoverable skills for every provider with their assets', (t) => {
  const { store, skill, workspace, other } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  store.setEnabled(workspace, id, true);
  store.setEnabled(workspace, id, true);
  for (const provider of ['.claude', '.agents', '.cursor', '.opencode', '.grok']) {
    const installed = path.join(workspace, provider, 'skills', 'review');
    assert.equal(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8'), store.document(id).content);
    assert.equal(fs.readFileSync(path.join(installed, 'table-columns.yaml'), 'utf8'), 'columns:\n  - name: Date\n');
    assert.equal(fs.existsSync(path.join(other, provider)), false);
  }
  const previous = store.document(id).content;
  store.updateDocument(id, previous.replace('Instructions privées.', 'Instructions actualisées.'), previous);
  assert.match(fs.readFileSync(path.join(workspace, '.claude/skills', 'review', 'SKILL.md'), 'utf8'), /actualisées/);
  store.setEnabled(workspace, id, false);
  store.setEnabled(workspace, id, false);
  for (const provider of ['.claude', '.agents', '.cursor', '.opencode', '.grok']) assert.deepEqual(fs.readdirSync(path.join(workspace, provider, 'skills')), []);
  assert.ok(store.document(id));
});

test('toggle installs native subagents for both providers and refreshes their definitions', (t) => {
  const { store, skill, workspace } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'agent');
  const claude = path.join(workspace, '.claude/agents', 'review.md');
  const codex = path.join(workspace, '.codex/agents', 'review.toml');
  const opencode = path.join(workspace, '.opencode/agent', 'review.md');
  const grok = path.join(workspace, '.grok/agents', 'review.md');
  store.setEnabled(workspace, id, true);
  assert.equal(fs.readFileSync(claude, 'utf8'), store.document(id).content);
  assert.equal(fs.readFileSync(opencode, 'utf8'), store.document(id).content);
  assert.equal(fs.readFileSync(grok, 'utf8'), store.document(id).content);
  const fields = Object.fromEntries(fs.readFileSync(codex, 'utf8').trim().split('\n').map((line) => {
    const separator = line.indexOf(' = ');
    return [line.slice(0, separator), JSON.parse(line.slice(separator + 3))];
  }));
  assert.equal(fields.name, 'review');
  assert.match(fields.description, /Lire et comparer/);
  assert.match(fields.developer_instructions, /Instructions privées/);
  assert.doesNotMatch(fields.developer_instructions, /name:/);
  const previous = store.document(id).content;
  store.updateDocument(id, previous.replace('Instructions privées.', 'Texte "actualisé".\nSuite.'), previous);
  assert.match(fs.readFileSync(claude, 'utf8'), /actualisé/);
  assert.match(fs.readFileSync(codex, 'utf8'), /actualisé/);
  store.setEnabled(workspace, id, false);
  assert.equal(fs.existsSync(claude), false);
  assert.equal(fs.existsSync(codex), false);
  assert.equal(fs.existsSync(opencode), false);
  assert.equal(fs.existsSync(grok), false);
  assert.ok(store.document(id));
});

test('installation refuses personal collisions before installing either provider', (t) => {
  const { store, skill, workspace } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  const personal = path.join(workspace, '.agents/skills', 'review');
  fs.mkdirSync(personal, { recursive: true });
  fs.writeFileSync(path.join(personal, 'SKILL.md'), 'Personnel');
  assert.throws(() => store.setEnabled(workspace, id, true), /personnel préservé/);
  assert.equal(store.list(workspace)[0].enabled, false);
  assert.equal(fs.existsSync(path.join(workspace, '.claude/skills', 'review')), false);
  assert.equal(fs.readFileSync(path.join(personal, 'SKILL.md'), 'utf8'), 'Personnel');
});

test('installation refuses provider directories redirected outside the dossier', (t) => {
  const { store, skill, workspace, other } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  fs.symlinkSync(other, path.join(workspace, '.claude'));
  assert.throws(() => store.setEnabled(workspace, id, true), /hors du dossier/);
  assert.deepEqual(fs.readdirSync(other), []);
  assert.equal(store.list(workspace)[0].enabled, false);
});

test('uninstallation preserves a locally edited subagent and its activation', (t) => {
  const { store, skill, workspace } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'agent');
  store.setEnabled(workspace, id, true);
  const target = path.join(workspace, '.codex/agents', 'review.toml');
  fs.writeFileSync(target, 'Personal edits');
  assert.throws(() => store.setEnabled(workspace, id, false), /personnel préservé/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'Personal edits');
  assert.equal(store.list(workspace)[0].enabled, true);
  assert.ok(fs.existsSync(path.join(workspace, '.claude/agents', 'review.md')));
});

test('standalone connectors are catalogued once and installed in every provider dossier', (t) => {
  const { store, workspace, other } = fixture(t);
  const id = store.importConnector({
    name: 'registre-public',
    description: 'https://registre-public.com/api/mcp',
    config: { transport: 'http', url: 'https://registre-public.com/api/mcp' },
    source: 'piecemaker:default:registre-public',
  });
  assert.equal(store.importConnector({
    name: 'registre-public',
    description: 'https://registre-public.com/api/mcp',
    config: { transport: 'http', url: 'https://registre-public.com/api/mcp' },
    source: `${path.join(other, '.claude.json')}#registre-public`,
  }), id);
  assert.equal(store.list(workspace).filter((entry) => entry.kind === 'connector' && !entry.collectionId).length, 1);
  store.setEnabled(workspace, id, true);
  const mcpJson = JSON.parse(fs.readFileSync(path.join(workspace, '.mcp.json'), 'utf8'));
  assert.equal(mcpJson.mcpServers['registre-public'].url, 'https://registre-public.com/api/mcp');
  const cursor = JSON.parse(fs.readFileSync(path.join(workspace, '.cursor/mcp.json'), 'utf8'));
  assert.equal(cursor.mcpServers['registre-public'].url, 'https://registre-public.com/api/mcp');
  const opencode = JSON.parse(fs.readFileSync(path.join(workspace, 'opencode.json'), 'utf8'));
  assert.equal(opencode.mcp['registre-public'].url, 'https://registre-public.com/api/mcp');
  assert.equal(opencode.mcp['registre-public'].enabled, true);
  const grok = TOML.parse(fs.readFileSync(path.join(workspace, '.grok/config.toml'), 'utf8')) as { mcp_servers: Record<string, { url: string; enabled: boolean }> };
  assert.equal(grok.mcp_servers['registre-public'].url, 'https://registre-public.com/api/mcp');
  assert.equal(grok.mcp_servers['registre-public'].enabled, true);
  const claudeSettings = JSON.parse(fs.readFileSync(path.join(workspace, '.claude/settings.local.json'), 'utf8'));
  assert.equal(claudeSettings.disabledMcpServers.includes('registre-public'), false);
  store.setEnabled(workspace, id, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(workspace, '.mcp.json'), 'utf8')).mcpServers, {});
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, '.claude/settings.local.json'), 'utf8')).disabledMcpServers.includes('registre-public'), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, '.cursor/mcp.json'), 'utf8')).mcpServers['registre-public'].disabled, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, 'opencode.json'), 'utf8')).mcp['registre-public'].enabled, false);
  assert.equal((TOML.parse(fs.readFileSync(path.join(workspace, '.grok/config.toml'), 'utf8')) as { mcp_servers: Record<string, { enabled: boolean }> }).mcp_servers['registre-public'].enabled, false);
  assert.equal(store.instructions(workspace), '');
});

test('plugin connectors stay attached to their collection', (t) => {
  const { store, workspace } = fixture(t);
  const id = store.importConnector({
    name: 'legifrance',
    description: 'python3',
    config: { transport: 'stdio', command: 'python3', args: ['server.py'] },
    source: '/plugins/legal/.mcp.json#legifrance',
    namespace: 'legifrance@market',
  });
  store.upsertCollection({
    id: 'legifrance@market',
    name: 'Légifrance',
    description: '',
    source: '/plugins/legal',
    entries: [{ entryId: id, rootPath: 'mcp/legifrance.json' }],
    files: [],
  });
  const listed = store.list(workspace);
  assert.equal(listed.find((entry) => entry.id === id)?.collectionId, 'legifrance@market');
  store.setCollectionEnabled(workspace, 'legifrance@market', true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, '.mcp.json'), 'utf8')).mcpServers.legifrance.command, 'python3');
});

test('renaming a skill moves its installed folders', (t) => {
  const { store, skill, workspace } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  store.setEnabled(workspace, id, true);
  const previous = store.document(id).content;
  store.updateDocument(id, previous.replace('name: review', 'name: relecture'), previous);
  for (const provider of ['.claude', '.agents', '.cursor', '.opencode', '.grok']) {
    assert.deepEqual(fs.readdirSync(path.join(workspace, provider, 'skills')), ['relecture']);
  }
  assert.match(fs.readFileSync(path.join(workspace, '.claude/skills/relecture', 'SKILL.md'), 'utf8'), /relecture/);
  assert.equal(store.list(workspace)[0].enabled, true);
});

test('an activated skill is a real copy in the dossier with relative provider links and a manifest', (t) => {
  const { store, skill, workspace, home } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  store.setEnabled(workspace, id, true);
  assert.equal(fs.lstatSync(path.join(workspace, '.agents/skills/review')).isDirectory(), true);
  assert.equal(fs.readlinkSync(path.join(workspace, '.claude/skills/review')), path.join('..', '..', '.agents', 'skills', 'review'));
  const manifest = JSON.parse(fs.readFileSync(path.join(workspace, '.piecemaker/library.json'), 'utf8'));
  assert.deepEqual(manifest.entries.map((entry: { id: string; slug: string }) => [entry.id, entry.slug]), [[id, 'review']]);
  store.close();
  fs.rmSync(path.join(home, '.piecemaker'), { recursive: true, force: true });
  assert.match(fs.readFileSync(path.join(workspace, '.claude/skills/review/SKILL.md'), 'utf8'), /Instructions privées/);
  const rebuilt = createLibraryStore(path.join(home, '.piecemaker'));
  t.after(() => rebuilt.close());
  assert.equal(rebuilt.importFile(path.join(skill, 'SKILL.md'), 'skill'), id);
  assert.equal(rebuilt.list(workspace)[0].enabled, true);
  rebuilt.setEnabled(workspace, id, false);
  assert.equal(fs.existsSync(path.join(workspace, '.agents/skills/review')), false);
});

test('a skill edited by hand in the dossier is never overwritten nor removed', (t) => {
  const { store, skill, workspace } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  store.setEnabled(workspace, id, true);
  const installed = path.join(workspace, '.agents/skills/review/SKILL.md');
  fs.writeFileSync(installed, 'Retouche personnelle');
  assert.throws(() => store.setEnabled(workspace, id, false), /personnel préservé/);
  assert.equal(fs.readFileSync(installed, 'utf8'), 'Retouche personnelle');
  assert.equal(store.list(workspace)[0].enabled, true);
});

test('activations from the former linked layout are migrated and their dead links removed', (t) => {
  const { store, skill, workspace, home } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  store.setEnabled(workspace, id, true);
  store.setEnabled(workspace, id, false);
  fs.rmSync(path.join(workspace, '.piecemaker'), { recursive: true });
  const former = path.join(store.directory, 'active', 'gone', id);
  fs.symlinkSync(former, path.join(workspace, '.claude/skills/review'), 'dir');
  fs.symlinkSync(former, path.join(workspace, '.agents/skills', `piecemaker-${id}`), 'dir');
  store.close();
  const Database = require('better-sqlite3');
  const db = new Database(path.join(home, '.piecemaker/library-backend/catalog.sqlite'));
  db.prepare('INSERT INTO activation VALUES (?, ?)').run(fs.realpathSync(workspace), id);
  db.close();
  const reopened = createLibraryStore(path.join(home, '.piecemaker'));
  t.after(() => reopened.close());
  assert.equal(reopened.list(workspace)[0].enabled, true);
  assert.deepEqual(fs.readdirSync(path.join(workspace, '.agents/skills')), ['review']);
  assert.equal(fs.lstatSync(path.join(workspace, '.agents/skills/review')).isDirectory(), true);
  assert.match(fs.readFileSync(path.join(workspace, '.claude/skills/review/SKILL.md'), 'utf8'), /Instructions privées/);
});

test('default entries join a new dossier once and stay removed afterwards', (t) => {
  const { store, skill, workspace } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  store.setDefaultEntries([id]);
  assert.equal(store.list(workspace)[0].enabled, true);
  assert.ok(fs.existsSync(path.join(workspace, '.agents/skills/review/SKILL.md')));
  store.setEnabled(workspace, id, false);
  assert.equal(store.list(workspace)[0].enabled, false);
  assert.equal(fs.existsSync(path.join(workspace, '.agents/skills/review')), false);
});

test('components delegated to a native Claude plugin skip every Claude location', (t) => {
  const { store, skill, workspace } = fixture(t);
  const skillId = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  const agentId = store.importContent('/plugins/legal/agents/clerk.md', 'agent', '---\nname: clerk\ndescription: Greffe\n---\nRôle.');
  const mcpId = store.importConnector({ name: 'legifrance', description: 'python3', config: { transport: 'stdio', command: 'python3' }, source: '/plugins/legal/.mcp.json#legifrance', namespace: 'legal@market' });
  store.upsertCollection({
    id: 'legal@market', name: 'Legal', description: '', source: '/plugins/legal', files: [],
    entries: [{ entryId: skillId, rootPath: 'skills/review' }, { entryId: agentId, rootPath: 'agents/clerk.md' }, { entryId: mcpId, rootPath: 'mcp/legifrance.json' }],
  });
  store.setCollectionEnabled(workspace, 'legal@market', true, { skipClaude: true });
  assert.equal(fs.existsSync(path.join(workspace, '.claude')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.mcp.json')), false);
  assert.ok(fs.existsSync(path.join(workspace, '.agents/skills/review/SKILL.md')));
  assert.ok(fs.existsSync(path.join(workspace, '.cursor/skills/review/SKILL.md')));
  assert.ok(fs.existsSync(path.join(workspace, '.codex/agents/clerk.toml')));
  assert.ok(fs.existsSync(path.join(workspace, '.cursor/mcp.json')));
  const previous = store.document(skillId).content;
  store.updateDocument(skillId, previous.replace('privées', 'revues'), previous);
  assert.equal(fs.existsSync(path.join(workspace, '.claude')), false);
  store.setCollectionEnabled(workspace, 'legal@market', false);
  assert.equal(fs.existsSync(path.join(workspace, '.agents/skills/review')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.codex/agents/clerk.toml')), false);
});
