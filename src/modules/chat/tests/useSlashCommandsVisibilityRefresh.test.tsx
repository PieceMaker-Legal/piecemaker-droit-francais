import assert from 'node:assert/strict';

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useSlashCommands } from '@/modules/chat/hooks/useSlashCommands';
import { api } from '@/shared/api';
import type { Project } from '@/shared/types';

vi.mock('@/shared/api', () => ({
  api: {
    commands: { list: vi.fn() },
    providers: { skills: vi.fn() },
  },
}));

const PROJECT: Project = {
  projectId: 'project-1',
  displayName: 'Project One',
  fullPath: '/cases/project-one',
};

const commandResponse = () => new Response(JSON.stringify({ builtIn: [], custom: [] }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const skillsResponse = () => new Response(JSON.stringify({
  success: true,
  data: {
    skills: [{
      name: 'Relire',
      description: 'Relire le dossier',
      command: '/relire',
      scope: 'project',
      sourcePath: '/cases/project-one/.claude/skills/relire/SKILL.md',
    }],
  },
}), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => {
  vi.mocked(api.commands.list).mockReset().mockImplementation(async () => commandResponse());
  vi.mocked(api.providers.skills).mockReset().mockImplementation(async () => skillsResponse());
});

test('reopening the chat refreshes workspace skills without remounting the composer', async () => {
  const view = renderHook(
    ({ isActive }: { isActive: boolean }) => useSlashCommands({
      isActive,
      selectedProject: PROJECT,
      provider: 'claude',
      input: '',
      setInput: vi.fn(),
      textareaRef: { current: null },
      onExecuteCommand: vi.fn(),
    }),
    { initialProps: { isActive: false } },
  );

  assert.equal(vi.mocked(api.providers.skills).mock.calls.length, 0);

  view.rerender({ isActive: true });

  await waitFor(() => assert.equal(view.result.current.slashCommandsCount, 1));
  assert.equal(vi.mocked(api.providers.skills).mock.calls.length, 1);

  view.rerender({ isActive: false });
  view.rerender({ isActive: true });

  await waitFor(() => assert.equal(vi.mocked(api.providers.skills).mock.calls.length, 2));
});
