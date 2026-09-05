import assert from 'node:assert/strict';

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

const { pmGet, pmPost } = vi.hoisted(() => ({
  pmGet: vi.fn(),
  pmPost: vi.fn(),
}));

vi.mock('@/piecemaker/dossier/api', () => ({
  PieceMakerApiError: class extends Error { constructor(message: string) { super(message); } },
  pmGet,
  pmPost,
}));

vi.mock('@/piecemaker/dossier/DossierContext', () => ({
  useDossierCases: () => ({
    projectPath: '/test/workspace',
  }),
}));

import SkillsActivation from '@/piecemaker/dossier/sections/SkillsActivation';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('renders group headings when snapshot loads', async () => {
  pmGet.mockResolvedValue({
    workspacePath: '/test/workspace',
    claude: { mcp: [], plugins: [] },
    codex: { mcp: [] },
    library: { skills: [], agents: [] },
    globalLeftovers: { skills: [], agents: [] },
  });

  render(<SkillsActivation />);

  await waitFor(() => {
    assert(screen.getByText('Serveurs MCP'));
    assert(screen.getByText('Plugins Claude'));
    assert(screen.getByText('Bibliothèque — compétences (skills)'));
    assert(screen.getByText('Bibliothèque — collabs IA (agents)'));
  });
});

test('shows empty state messages when lists are empty', async () => {
  pmGet.mockResolvedValue({
    workspacePath: '/test/workspace',
    claude: { mcp: [], plugins: [] },
    codex: { mcp: [] },
    library: { skills: [], agents: [] },
    globalLeftovers: { skills: [], agents: [] },
  });

  render(<SkillsActivation />);

  await waitFor(() => {
    assert(screen.getByText('Aucun serveur MCP configuré.'));
    assert(screen.getByText('Aucun plugin installé.'));
  });
});

test('displays library skills when present', async () => {
  pmGet.mockResolvedValue({
    workspacePath: '/test/workspace',
    claude: { mcp: [], plugins: [] },
    codex: { mcp: [] },
    library: {
      skills: [
        {
          id: 'test-skill',
          name: 'Test Skill',
          description: 'A test skill',
          origin: 'library',
          source: '~/test',
          installed: { claude: false, codex: false },
        },
      ],
      agents: [],
    },
    globalLeftovers: { skills: [], agents: [] },
  });

  render(<SkillsActivation />);

  await waitFor(() => {
    assert(screen.getByText('Test Skill'));
    assert(screen.getByText('A test skill'));
  });
});

test('clicking a library toggle calls pmPost with correct body', async () => {
  const mockResponse = {
    ok: true,
    item: {
      id: 'test-skill',
      name: 'Test Skill',
      installed: { claude: true, codex: false },
    },
  };
  pmGet.mockResolvedValue({
    workspacePath: '/test/workspace',
    claude: { mcp: [], plugins: [] },
    codex: { mcp: [] },
    library: {
      skills: [
        {
          id: 'test-skill',
          name: 'Test Skill',
          origin: 'library',
          source: '~/',
          installed: { claude: false, codex: false },
        },
      ],
      agents: [],
    },
    globalLeftovers: { skills: [], agents: [] },
  });
  pmPost.mockResolvedValue(mockResponse);

  render(<SkillsActivation />);

  await waitFor(() => {
    assert(screen.getByText('Test Skill'));
  });

  const toggleButton = screen.getByRole('switch', { name: /Installer Test Skill pour Claude/ });
  await act(async () => {
    fireEvent.click(toggleButton);
  });

  await waitFor(() => {
    assert.deepEqual(pmPost.mock.calls[0][1], {
      workspacePath: '/test/workspace',
      assistant: 'claude',
      family: 'skill',
      id: 'test-skill',
      installed: true,
    });
  });
});

test('adopting a leftover asks for confirmation and calls pmPost if confirmed', async () => {
  const confirmMock = vi.spyOn(window, 'confirm');
  confirmMock.mockReturnValue(true);

  pmGet.mockResolvedValue({
    workspacePath: '/test/workspace',
    claude: { mcp: [], plugins: [] },
    codex: { mcp: [] },
    library: { skills: [], agents: [] },
    globalLeftovers: {
      skills: [
        {
          id: 'leftover-skill',
          name: 'Leftover',
          assistant: 'claude',
          family: 'skill',
          source: '~/leftover',
        },
      ],
      agents: [],
    },
  });
  pmPost.mockResolvedValue({ ok: true, id: 'leftover-skill' });

  render(<SkillsActivation />);

  await waitFor(() => {
    assert(screen.getByText('Composants globaux à migrer'));
    assert(screen.getByText('Leftover'));
  });

  const adoptButton = screen.getByRole('button', { name: 'Déplacer vers la bibliothèque' });
  await act(async () => {
    fireEvent.click(adoptButton);
  });

  await waitFor(() => {
    assert.equal(confirmMock.mock.calls.length, 1);
    assert(pmPost.mock.calls.some((call) => call[0] === '/activation/library/adopt'));
  });
});

test('adopting a leftover does NOT call pmPost if confirm returns false', async () => {
  const confirmMock = vi.spyOn(window, 'confirm');
  confirmMock.mockReturnValue(false);

  pmGet.mockResolvedValue({
    workspacePath: '/test/workspace',
    claude: { mcp: [], plugins: [] },
    codex: { mcp: [] },
    library: { skills: [], agents: [] },
    globalLeftovers: {
      skills: [
        {
          id: 'leftover-skill',
          name: 'Leftover',
          assistant: 'claude',
          family: 'skill',
          source: '~/leftover',
        },
      ],
      agents: [],
    },
  });

  render(<SkillsActivation />);

  await waitFor(() => {
    assert(screen.getByText('Leftover'));
  });

  const adoptButton = screen.getByRole('button', { name: 'Déplacer vers la bibliothèque' });
  await act(async () => {
    fireEvent.click(adoptButton);
  });

  assert.equal(pmPost.mock.calls.length, 0);
});

test('hides globalLeftovers section when list is empty', async () => {
  pmGet.mockResolvedValue({
    workspacePath: '/test/workspace',
    claude: { mcp: [], plugins: [] },
    codex: { mcp: [] },
    library: { skills: [], agents: [] },
    globalLeftovers: { skills: [], agents: [] },
  });

  render(<SkillsActivation />);

  await waitFor(() => {
    assert(!screen.queryByText('Composants globaux à migrer'));
  });
});

test('displays agents when present', async () => {
  pmGet.mockResolvedValue({
    workspacePath: '/test/workspace',
    claude: { mcp: [], plugins: [] },
    codex: { mcp: [] },
    library: {
      skills: [],
      agents: [
        {
          id: 'test-agent',
          name: 'Test Agent',
          description: 'An agent',
          origin: 'library',
          source: '~/',
          installed: { claude: false, codex: null },
        },
      ],
    },
    globalLeftovers: { skills: [], agents: [] },
  });

  render(<SkillsActivation />);

  await waitFor(() => {
    assert(screen.getByText('Test Agent'));
    assert(screen.getByText('An agent'));
  });
});

test('agent codex column shows dash (agents have no codex)', async () => {
  pmGet.mockResolvedValue({
    workspacePath: '/test/workspace',
    claude: { mcp: [], plugins: [] },
    codex: { mcp: [] },
    library: {
      skills: [],
      agents: [
        {
          id: 'test-agent',
          name: 'Test Agent',
          origin: 'library',
          source: '~/',
          installed: { claude: true, codex: null },
        },
      ],
    },
    globalLeftovers: { skills: [], agents: [] },
  });

  render(<SkillsActivation />);

  await waitFor(() => {
    assert(screen.getByText('Test Agent'));
  });

  const dashes = screen.getAllByText('—');
  assert(dashes.length > 0);
});

test('displays error when loading fails', async () => {
  const apiError = new Error('Network error');
  (apiError as any).message = 'Network error';
  pmGet.mockRejectedValue(apiError);

  render(<SkillsActivation />);

  await waitFor(() => {
    const errorElement = screen.getByText('Network error');
    assert(errorElement);
  });
});
