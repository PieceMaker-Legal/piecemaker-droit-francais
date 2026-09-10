import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createLibraryStore } from './store.js';
import { migratePersonalLibrary } from './migrate.js';
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

test('migration withdraws verified global installations and retains a recovery manifest', (t) => {
  const { root, home, skill, store, workspace } = fixture(t);
  const imported = migratePersonalLibrary(store, home, root, true);
  assert.equal(imported.length, 1);
  assert.equal(fs.existsSync(skill), false);
  assert.equal(store.list(workspace)[0].enabled, false);
  assert.equal(store.instructions(workspace), '');
  const archive = fs.readdirSync(store.directory).find((name) => name.startsWith('migration-'));
  assert.ok(archive);
  assert.ok(fs.existsSync(path.join(store.directory, archive, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(store.directory, archive, '.claude/skills/review/SKILL.md')));
});

test('associated symlinks fail before source withdrawal', (t) => {
  const { root, home, skill, store } = fixture(t);
  fs.symlinkSync(path.join(skill, 'SKILL.md'), path.join(skill, 'linked.md'));
  assert.throws(() => migratePersonalLibrary(store, home, root, true), /lié non importé/);
  assert.ok(fs.existsSync(path.join(skill, 'SKILL.md')));
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

test('toggle installs and removes discoverable Claude and Codex skills with their assets', (t) => {
  const { store, skill, workspace, other } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  store.setEnabled(workspace, id, true);
  store.setEnabled(workspace, id, true);
  for (const provider of ['.claude', '.agents']) {
    const installed = path.join(workspace, provider, 'skills', `piecemaker-${id}`);
    assert.equal(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8'), store.document(id).content);
    assert.equal(fs.readFileSync(path.join(installed, 'table-columns.yaml'), 'utf8'), 'columns:\n  - name: Date\n');
    assert.equal(fs.existsSync(path.join(other, provider)), false);
  }
  const previous = store.document(id).content;
  store.updateDocument(id, previous.replace('Instructions privées.', 'Instructions actualisées.'), previous);
  assert.match(fs.readFileSync(path.join(workspace, '.claude/skills', `piecemaker-${id}`, 'SKILL.md'), 'utf8'), /actualisées/);
  store.setEnabled(workspace, id, false);
  store.setEnabled(workspace, id, false);
  for (const provider of ['.claude', '.agents']) assert.deepEqual(fs.readdirSync(path.join(workspace, provider, 'skills')), []);
  assert.ok(store.document(id));
});

test('toggle installs native subagents for both providers and refreshes their definitions', (t) => {
  const { store, skill, workspace } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'agent');
  const claude = path.join(workspace, '.claude/agents', `piecemaker-${id}.md`);
  const codex = path.join(workspace, '.codex/agents', `piecemaker-${id}.toml`);
  store.setEnabled(workspace, id, true);
  assert.equal(fs.readFileSync(claude, 'utf8'), store.document(id).content);
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
  assert.ok(store.document(id));
});

test('installation refuses personal collisions before installing either provider', (t) => {
  const { store, skill, workspace } = fixture(t);
  const id = store.importFile(path.join(skill, 'SKILL.md'), 'skill');
  const personal = path.join(workspace, '.agents/skills', `piecemaker-${id}`);
  fs.mkdirSync(personal, { recursive: true });
  fs.writeFileSync(path.join(personal, 'SKILL.md'), 'Personnel');
  assert.throws(() => store.setEnabled(workspace, id, true), /personnel préservé/);
  assert.equal(store.list(workspace)[0].enabled, false);
  assert.equal(fs.existsSync(path.join(workspace, '.claude/skills', `piecemaker-${id}`)), false);
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
  const target = path.join(workspace, '.codex/agents', `piecemaker-${id}.toml`);
  fs.writeFileSync(target, 'Personal edits');
  assert.throws(() => store.setEnabled(workspace, id, false), /personnel préservé/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'Personal edits');
  assert.equal(store.list(workspace)[0].enabled, true);
  assert.ok(fs.existsSync(path.join(workspace, '.claude/agents', `piecemaker-${id}.md`)));
});
