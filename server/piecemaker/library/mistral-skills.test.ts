import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildVibeDisabledSkills, mistralRuntime } from '@/modules/providers/list/mistral/mistral-runtime.provider.js';
import { MistralSkillsProvider } from '@/modules/providers/list/mistral/mistral-skills.provider.js';
import type { ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/index.js';

const skills = (...names: string[]) => names.map((name) => ({ name, path: `/skills/${name}/SKILL.md` }));
const parse = (value: string | undefined) => JSON.parse(value as string) as string[];

test('buildVibeDisabledSkills échappe les métacaractères fnmatch', () => {
  assert.deepEqual(parse(buildVibeDisabledSkills(skills('a*b', 'x?', '[draft]', 'simple'), undefined)), ['a[*]b', 'x[?]', '[[]draft]', 'simple']);
});

test('buildVibeDisabledSkills neutralise le préfixe re:, ignore noms vides et entrées invalides, et dédoublonne sans tenir compte de la casse', () => {
  const list = [...skills('re:x', 'RE:y', 'Relire', 'relire', '  '), { name: 42 }, null, { path: '/x' }];
  assert.deepEqual(parse(buildVibeDisabledSkills(list, undefined)), ['[r]e:x', '[R]E:y', 'Relire']);
});

test('buildVibeDisabledSkills fusionne la variable héritée, qu\'il place en premier', () => {
  assert.deepEqual(parse(buildVibeDisabledSkills(skills('a'), '["b","c*"]')), ['b', 'c*', 'a']);
});

test('buildVibeDisabledSkills laisse une variable héritée invalide intacte', () => {
  for (const inherited of ['pas du json', '{"a":1}', '[1,2]', '"a"']) {
    assert.equal(buildVibeDisabledSkills(skills('a'), inherited), undefined);
  }
});

test('buildVibeDisabledSkills retourne undefined sans rien à masquer', () => {
  assert.equal(buildVibeDisabledSkills(undefined, undefined), undefined);
  assert.equal(buildVibeDisabledSkills([], '["b"]'), undefined);
  assert.equal(buildVibeDisabledSkills('nope', undefined), undefined);
});

async function runVibe(t: test.TestContext, options: Record<string, unknown>, env: Record<string, string | undefined> = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-env-'));
  const saved = new Map<string, string | undefined>();
  for (const key of ['VIBE_HOME', 'VIBE_DISABLED_SKILLS']) saved.set(key, process.env[key]);
  const homedir = os.homedir;
  (os as { homedir: () => string }).homedir = () => home;
  t.after(() => {
    (os as { homedir: () => string }).homedir = homedir;
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(home, { recursive: true, force: true });
  });
  delete process.env.VIBE_HOME;
  delete process.env.VIBE_DISABLED_SKILLS;
  for (const [key, value] of Object.entries(env)) { if (value !== undefined) process.env[key] = value; }

  let captured: NodeJS.ProcessEnv | undefined;
  t.mock.method(childProcess, 'spawn', (_command: string, _args: string[], spawnOptions: { env?: NodeJS.ProcessEnv }) => {
    captured = spawnOptions.env;
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true });
    setImmediate(() => child.emit('close', 0));
    return child;
  });
  const context = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
  } as unknown as ProviderRuntimeContext;
  const writer = { send() {}, userId: null } as unknown as ProviderRuntimeWriter;
  await mistralRuntime.run('Bonjour', { cwd: home, ...options }, writer, context);
  return { env: captured, home };
}

test('spawnVibe transmet VIBE_DISABLED_SKILLS quand la bibliothèque masque des skills', async (t) => {
  const { env } = await runVibe(t, { libraryDisabledSkills: skills('a*b', 'relire') });
  assert.deepEqual(parse(env?.VIBE_DISABLED_SKILLS), ['a[*]b', 'relire']);
});

test('spawnVibe fusionne VIBE_DISABLED_SKILLS hérité', async (t) => {
  const { env } = await runVibe(t, { libraryDisabledSkills: skills('relire') }, { VIBE_DISABLED_SKILLS: '["autre"]' });
  assert.deepEqual(parse(env?.VIBE_DISABLED_SKILLS), ['autre', 'relire']);
});

test('spawnVibe ne définit pas VIBE_DISABLED_SKILLS sans skill à masquer', async (t) => {
  const { env } = await runVibe(t, {});
  assert.equal(env?.VIBE_DISABLED_SKILLS, undefined);
});

test('spawnVibe ne définit pas VIBE_DISABLED_SKILLS si enabled_skills est défini dans la config Vibe', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-vibe-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, 'config.toml'), 'enabled_skills = ["seul"]\n');
  const { env } = await runVibe(t, { libraryDisabledSkills: skills('relire') }, { VIBE_HOME: home });
  assert.equal(env?.VIBE_DISABLED_SKILLS, undefined);
  assert.equal(warn.mock.calls.length, 1);

  await runVibe(t, { libraryDisabledSkills: skills('relire') }, { VIBE_HOME: home });
  assert.equal(warn.mock.calls.length, 1);
});

test('spawnVibe masque quand enabled_skills est vide ou que la config est illisible', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-vibe-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, 'config.toml'), 'enabled_skills = []\n');
  assert.ok((await runVibe(t, { libraryDisabledSkills: skills('relire') }, { VIBE_HOME: home })).env?.VIBE_DISABLED_SKILLS);
  fs.writeFileSync(path.join(home, 'config.toml'), 'ceci = n\'est [pas du toml');
  assert.ok((await runVibe(t, { libraryDisabledSkills: skills('relire') }, { VIBE_HOME: home })).env?.VIBE_DISABLED_SKILLS);
});
test('MistralSkillsProvider liste les skills du projet (.agents, .vibe) et de ~/.vibe et ~/.agents', { concurrency: false }, async () => {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'mistral-skills-'));
  const originalHomedir = os.homedir;
  (os as any).homedir = () => path.join(tempRoot, 'home');
  try {
    const workspacePath = path.join(tempRoot, 'workspace');
    const write = async (root: string, directory: string, name: string) => {
      await fsp.mkdir(path.join(root, directory), { recursive: true });
      await fsp.writeFile(path.join(root, directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} desc\n---\n`);
    };
    await write(path.join(workspacePath, '.agents', 'skills'), 'x', 'projet-agents');
    await write(path.join(workspacePath, '.vibe', 'skills'), 'y', 'projet-vibe');
    await write(path.join(tempRoot, 'home', '.vibe', 'skills'), 'z', 'utilisateur');
    await write(path.join(tempRoot, 'home', '.agents', 'skills'), 'w', 'utilisateur-agents');

    const skills = await new MistralSkillsProvider().listSkills({ workspacePath });
    const byName = new Map(skills.map((skill) => [skill.name, skill]));
    assert.equal(byName.get('projet-agents')?.scope, 'project');
    assert.equal(byName.get('projet-agents')?.command, '/projet-agents');
    assert.equal(byName.get('projet-vibe')?.scope, 'project');
    assert.equal(byName.get('utilisateur')?.scope, 'user');
    assert.equal(byName.get('utilisateur-agents')?.scope, 'user');
    assert.ok(skills.every((skill) => skill.provider === 'mistral'));
  } finally {
    (os as any).homedir = originalHomedir;
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
});
