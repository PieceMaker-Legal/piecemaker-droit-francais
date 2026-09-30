import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MistralSkillsProvider } from '@/modules/providers/list/mistral/mistral-skills.provider.js';

test('MistralSkillsProvider liste les skills du projet (.agents, .vibe) et de ~/.vibe', { concurrency: false }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mistral-skills-'));
  const originalHomedir = os.homedir;
  (os as any).homedir = () => path.join(tempRoot, 'home');
  try {
    const workspacePath = path.join(tempRoot, 'workspace');
    const write = async (root: string, directory: string, name: string) => {
      await fs.mkdir(path.join(root, directory), { recursive: true });
      await fs.writeFile(path.join(root, directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} desc\n---\n`);
    };
    await write(path.join(workspacePath, '.agents', 'skills'), 'x', 'projet-agents');
    await write(path.join(workspacePath, '.vibe', 'skills'), 'y', 'projet-vibe');
    await write(path.join(tempRoot, 'home', '.vibe', 'skills'), 'z', 'utilisateur');

    const skills = await new MistralSkillsProvider().listSkills({ workspacePath });
    const byName = new Map(skills.map((skill) => [skill.name, skill]));
    assert.equal(byName.get('projet-agents')?.scope, 'project');
    assert.equal(byName.get('projet-agents')?.command, '/projet-agents');
    assert.equal(byName.get('projet-vibe')?.scope, 'project');
    assert.equal(byName.get('utilisateur')?.scope, 'user');
    assert.ok(skills.every((skill) => skill.provider === 'mistral'));
  } finally {
    (os as any).homedir = originalHomedir;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
