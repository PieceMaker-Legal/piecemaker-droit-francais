import { act, fireEvent, render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { expect, it, vi } from 'vitest';

import SidebarAgentButton from '@/modules/sidebar/SidebarAgentButton';
import SidebarCentralAgentButton from '@/modules/sidebar/SidebarCentralAgentButton';
import SidebarTabularReviewButton from '@/modules/sidebar/SidebarTabularReviewButton';
import type { Project } from '@/shared/types';

const mocks = vi.hoisted(() => ({ openSession: vi.fn(), openCentral: vi.fn(), requestWorkspacePanel: vi.fn(), rpc: vi.fn() }));

vi.mock('@/modules/piecemaker-workspace-tabs', () => ({ agentApi: { openSession: mocks.openSession, openCentral: mocks.openCentral }, requestWorkspacePanel: mocks.requestWorkspacePanel }));
vi.mock('@/shared/api', () => ({ api: { plugins: { rpc: mocks.rpc } } }));

const t = ((key: string) => key) as unknown as TFunction;
const project = { projectId: 'dupont', fullPath: '/dossiers/Dupont' } as Project;

it.each([
  { sessions: [] },
  { sessions: [{ id: 'agent-1', __provider: 'claude' as const }] },
])(
  'ouvre la session de l’agent avec le fournisseur actif du dossier', async ({ sessions }) => {
    mocks.openSession.mockResolvedValue({ sessionId: 'agent-1', provider: 'codex' });
    const onSessionSelect = vi.fn();
    render(<SidebarAgentButton project={project} sessions={sessions} onSessionSelect={onSessionSelect} t={t} />);
    fireEvent.click(screen.getByRole('button', { name: 'sessions.piecemakerAgent' }));
    await act(async () => undefined);
    expect(mocks.openSession).toHaveBeenCalledWith('/dossiers/Dupont');
    expect(onSessionSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-1', __provider: 'codex', __projectId: 'dupont' }), 'dupont');
  },
);

it('montre Analyse Tabulaire pour un dossier protégé et ouvre son onglet sur une nouvelle session', async () => {
  mocks.rpc.mockResolvedValue({ ok: true, json: async () => ({ projects: ['/dossiers/Dupont'] }) });
  const onNewSession = vi.fn();
  render(<SidebarTabularReviewButton project={project} onNewSession={onNewSession} t={t} />);
  fireEvent.click(await screen.findByRole('button', { name: 'sessions.tabularReview' }));
  await act(async () => { await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null))); });
  expect(onNewSession).toHaveBeenCalledWith(project);
  expect((window as unknown as Record<string, unknown>).__piecemakerTabularReviewTarget).toBe('/dossiers/Dupont');
  expect(mocks.requestWorkspacePanel).toHaveBeenCalledWith('plugin:piecemaker-tabular-review');
});

it('ouvre l’agent central dans son propre projet, au-dessus des dossiers', async () => {
  mocks.openCentral.mockResolvedValue({ project: '/donnees/PieceMaker Agent', projectId: 'central', sessionId: 'agent-central', provider: 'claude' });
  const onSessionSelect = vi.fn();
  render(<SidebarCentralAgentButton onSessionSelect={onSessionSelect} t={t} />);
  fireEvent.click(screen.getByRole('button', { name: 'sessions.centralAgent' }));
  await act(async () => undefined);
  expect(onSessionSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-central', __provider: 'claude', __projectId: 'central' }), 'central');
});
