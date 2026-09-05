import assert from 'node:assert/strict';

import { test } from 'vitest';

import { groupManagedFiles, type ManagedFile } from '@/piecemaker/dossier/sections/SkillsSection';

test('groupManagedFiles works on a file list', () => {
  const files: ManagedFile[] = [
    {
      path: 'README.md',
      name: 'README',
      kind: 'instructions',
      exists: true,
      readonly: false,
      claudeCode: null,
    },
    {
      path: 'agents/bot/bot.md',
      name: 'bot',
      kind: 'agent',
      exists: true,
      readonly: false,
      claudeCode: null,
    },
    {
      path: 'skills/my-skill/SKILL.md',
      name: 'my-skill',
      kind: 'skill',
      exists: true,
      readonly: false,
      claudeCode: null,
    },
  ];

  const groups = groupManagedFiles(files);

  assert.equal(groups.length, 3);
  assert.equal(groups[0].kind, 'instructions');
  assert.equal(groups[0].files.length, 1);
  assert.equal(groups[0].files[0].name, 'README');

  assert.equal(groups[1].kind, 'agent');
  assert.equal(groups[1].files.length, 1);

  assert.equal(groups[2].kind, 'skill');
  assert.equal(groups[2].files.length, 1);
});

test('CLAUDE.md would be filtered out at the component level by name check', () => {
  const allFiles: ManagedFile[] = [
    {
      path: 'CLAUDE.md',
      name: 'CLAUDE.md',
      kind: 'instructions',
      exists: true,
      readonly: true,
      claudeCode: null,
    },
    {
      path: 'AGENTS.md',
      name: 'AGENTS.md',
      kind: 'instructions',
      exists: true,
      readonly: false,
      claudeCode: null,
    },
  ];

  const visibleFiles = allFiles.filter((file) => file.name !== 'CLAUDE.md');
  const groups = groupManagedFiles(visibleFiles);

  assert.equal(visibleFiles.length, 1);
  assert.equal(visibleFiles[0].name, 'AGENTS.md');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].files[0].name, 'AGENTS.md');
});

test('groupManagedFiles drops empty groups', () => {
  const files: ManagedFile[] = [
    {
      path: 'README.md',
      name: 'README',
      kind: 'instructions',
      exists: true,
      readonly: false,
      claudeCode: null,
    },
  ];

  const groups = groupManagedFiles(files);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 'instructions');
  assert(groups.every((g) => g.files.length > 0));
});
