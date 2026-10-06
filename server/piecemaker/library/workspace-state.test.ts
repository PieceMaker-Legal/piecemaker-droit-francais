import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ProviderSkill } from '@/shared/types.js';

import { importLibraryDirectory } from './migrate.js';
import { scanAndPersistLibraryProjectSkills } from './provider-skills.js';
import { installLibraryRuntime } from './runtime.js';
import { applyWorkspaceSkillVisibility, visibleLibrarySkills } from './skill-visibility.js';
import { createLibraryStore } from './store.js';

function writeSkill(directory: string, name: string, body = 'Instructions.') {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}.\n---\n${body}\n`);
  return path.join(directory, 'SKILL.md');
}

function fixture(t: { after: (fn: () => void) => void }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-library-state-')));
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'dossier');
  fs.mkdirSync(workspace, { recursive: true });
  const store = createLibraryStore(path.join(home, '.piecemaker'), { userHome: home });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, home, workspace, store };
}

const entry = (store: ReturnType<typeof createLibraryStore>, workspace: string, id: string) => store.list(workspace).find((item) => item.id === id)!;

test('un skill de la bibliothèque seule reste désactivé dans un nouveau dossier', (t) => {
  const { root, workspace, store } = fixture(t);
  const id = store.importFile(writeSkill(path.join(root, 'catalogue/relecture'), 'relecture'), 'skill')!;
  assert.equal(entry(store, workspace, id).enabled, false);
  assert.equal(entry(store, workspace, id).origin, 'bibliothèque');
  assert.equal(fs.existsSync(path.join(workspace, '.agents')), false);
  store.setEnabled(workspace, id, true);
  assert.ok(fs.existsSync(path.join(workspace, '.agents/skills/relecture/SKILL.md')));
  assert.ok(fs.lstatSync(path.join(workspace, '.claude/skills/relecture')).isSymbolicLink());
});

test('un skill personnel de Claude est actif par défaut et rejoint les autres providers sans doublon côté Claude', (t) => {
  const { home, workspace, store } = fixture(t);
  const id = store.importFile(writeSkill(path.join(home, '.claude/skills/bordereau'), 'bordereau'), 'skill')!;
  const listed = entry(store, workspace, id);
  assert.equal(listed.enabled, true);
  assert.equal(listed.origin, 'personnel');
  assert.ok(fs.existsSync(path.join(workspace, '.agents/skills/bordereau/SKILL.md')));
  assert.ok(fs.existsSync(path.join(workspace, '.cursor/skills/bordereau')));
  assert.equal(fs.existsSync(path.join(workspace, '.claude/skills/bordereau')), false);

  store.setEnabled(workspace, id, false);
  assert.equal(entry(store, workspace, id).enabled, false);
  assert.equal(fs.existsSync(path.join(workspace, '.agents/skills/bordereau')), false);
  assert.deepEqual(store.disabledEntries(workspace).map((item) => item.id), [id]);
  assert.deepEqual(applyWorkspaceSkillVisibility(store, workspace), { off: ['bordereau'] });
  const settings = path.join(workspace, '.claude/settings.local.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), { skillOverrides: { bordereau: 'off' } });

  store.setEnabled(workspace, id, true);
  assert.deepEqual(applyWorkspaceSkillVisibility(store, workspace), { off: [] });
  assert.equal(fs.existsSync(settings), false);
  assert.ok(fs.existsSync(path.join(workspace, '.agents/skills/bordereau/SKILL.md')));
});

test('le masquage Claude conserve les réglages qui ne viennent pas de la bibliothèque', (t) => {
  const { home, workspace, store } = fixture(t);
  const id = store.importFile(writeSkill(path.join(home, '.claude/skills/bordereau'), 'bordereau'), 'skill')!;
  const settings = path.join(workspace, '.claude/settings.local.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ enabledPlugins: { 'legal@market': true }, skillOverrides: { autre: 'off' } }));
  store.setEnabled(workspace, id, false);
  applyWorkspaceSkillVisibility(store, workspace);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')).skillOverrides, { autre: 'off', bordereau: 'off' });
  store.setEnabled(workspace, id, true);
  applyWorkspaceSkillVisibility(store, workspace);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), { enabledPlugins: { 'legal@market': true }, skillOverrides: { autre: 'off' } });
});

test('un skill personnel de ~/.agents/skills ne rejoint que Claude', (t) => {
  const { home, workspace, store } = fixture(t);
  const id = store.importFile(writeSkill(path.join(home, '.agents/skills/chronologie'), 'chronologie'), 'skill')!;
  assert.equal(entry(store, workspace, id).enabled, true);
  assert.ok(fs.existsSync(path.join(workspace, '.claude/skills/chronologie/SKILL.md')));
  assert.equal(fs.existsSync(path.join(workspace, '.agents/skills/chronologie')), false);
});

test('un skill du dossier est actif par défaut, sans copie supplémentaire', (t) => {
  const { workspace, store } = fixture(t);
  const id = store.importFile(writeSkill(path.join(workspace, '.claude/skills/pieces'), 'pieces'), 'skill')!;
  const listed = entry(store, workspace, id);
  assert.equal(listed.enabled, true);
  assert.equal(listed.origin, 'dossier');
  assert.equal(fs.existsSync(path.join(workspace, '.agents')), false);
});

test('aucune copie de couverture n’est écrite dans le répertoire personnel', (t) => {
  const { home, store } = fixture(t);
  store.importFile(writeSkill(path.join(home, '.claude/skills/bordereau'), 'bordereau'), 'skill');
  store.list(home);
  assert.equal(fs.existsSync(path.join(home, '.agents')), false);
});

test('le popup et le runtime masquent les skills désactivés dans le dossier', async (t) => {
  const { home, workspace, store } = fixture(t);
  const file = writeSkill(path.join(home, '.claude/skills/bordereau'), 'bordereau');
  const id = store.importFile(file, 'skill')!;
  store.setEnabled(workspace, id, false);
  const skill = (sourcePath: string, name: string): ProviderSkill => ({ provider: 'claude', name, description: '', command: `/${name}`, scope: 'user', sourcePath });
  const other = skill('/ailleurs/SKILL.md', 'autre');
  assert.deepEqual(visibleLibrarySkills([skill(file, 'bordereau'), other], store, workspace), [other]);
  assert.equal(visibleLibrarySkills([skill(file, 'bordereau')], store, undefined).length, 1);

  const received: unknown[] = [];
  const run = async (_provider: string, _command: string, options: Record<string, unknown>, _writer?: unknown) => { received.push([options.libraryDisabledSkills, options.libraryCodexOptions]); };
  const runtime = { run, getRunner: (provider: string) => (command: string, options: Record<string, unknown>) => run(provider, command, options) };
  installLibraryRuntime(runtime as never, { fetchHistory: async () => ({ messages: [] }) } as never, store);
  await runtime.run('codex', 'Relire', { cwd: workspace }, { send() {} } as never);
  const disabled = [{ name: 'bordereau', path: fs.realpathSync(file) }];
  assert.deepEqual(received, [[disabled, { config: { skills: { config: [{ path: disabled[0].path, enabled: false }] } } }]]);
});

test('une erreur de bibliothèque ne bloque pas l’envoi du message', async (t) => {
  const { store } = fixture(t);
  const commands: string[] = [];
  const run = async (_provider: string, command: string, _options?: unknown, _writer?: unknown) => { commands.push(command); };
  const runtime = { run, getRunner: (provider: string) => (command: string) => run(provider, command) };
  installLibraryRuntime(runtime as never, { fetchHistory: async () => ({ messages: [] }) } as never, store);
  const warn = t.mock.method(console, 'warn', () => {});
  await runtime.run('claude', 'Relire', { cwd: '/dossier/introuvable' }, { send() {} } as never);
  assert.deepEqual(commands, ['Relire']);
  assert.equal(warn.mock.calls.length, 1);
});

test('un skill supprimé n’est pas réimporté et un fichier invalide ne bloque pas le reste du dossier', (t) => {
  const { root, store } = fixture(t);
  const directory = path.join(root, 'personnels');
  writeSkill(path.join(directory, 'bon'), 'bon');
  writeSkill(path.join(directory, 'jetable'), 'jetable');
  fs.mkdirSync(path.join(directory, 'casse'));
  fs.writeFileSync(path.join(directory, 'casse/SKILL.md'), Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xc3, 0x28]));
  const errors: Array<{ source: string; message: string }> = [];
  const imported = importLibraryDirectory(store, directory, 'skill', false, errors);
  assert.deepEqual(imported.map((item) => path.basename(item.source)).sort(), ['bon', 'jetable']);
  assert.deepEqual(errors.map((error) => path.basename(error.source)), ['casse']);
  store.deleteEntry(imported.find((item) => item.source.endsWith('jetable'))!.id);
  assert.deepEqual(importLibraryDirectory(store, directory, 'skill', false).map((item) => path.basename(item.source)), ['bon']);
  assert.deepEqual(store.list().map((item) => item.name), ['bon']);
});

test('la collecte des projets ignore les copies posées par la bibliothèque', async (t) => {
  const { root, workspace, store } = fixture(t);
  const libraryId = store.importFile(writeSkill(path.join(root, 'catalogue/relecture'), 'relecture'), 'skill')!;
  store.setEnabled(workspace, libraryId, true);
  const own = writeSkill(path.join(workspace, '.claude/skills/pieces'), 'pieces');
  const reader = {
    async listProviderSkills(provider: string) {
      if (provider !== 'claude') return [];
      return [
        { provider: 'claude' as const, name: 'relecture', description: '', command: '/relecture', scope: 'project' as const, sourcePath: path.join(workspace, '.claude/skills/relecture/SKILL.md') },
        { provider: 'claude' as const, name: 'pieces', description: '', command: '/pieces', scope: 'project' as const, sourcePath: own },
      ];
    },
  };
  await scanAndPersistLibraryProjectSkills(store, [workspace], reader);
  assert.deepEqual(store.list(workspace).map((item) => [item.name, item.origin]), [['pieces', 'dossier'], ['relecture', 'bibliothèque']]);
});

test('les noms de dossier suivent la spec Agent Skills', (t) => {
  const { workspace, store } = fixture(t);
  const created = store.createEntry('skill', 'Œuvre  Spéciale: "test"', 'Description: avec deux-points');
  store.setEnabled(workspace, created.id, true);
  assert.ok(fs.existsSync(path.join(workspace, '.agents/skills/oeuvre-speciale-test/SKILL.md')));
  assert.equal(store.document(created.id).name, 'Œuvre Spéciale: "test"');
});
