import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

const mocks = vi.hoisted(() => ({
  models: vi.fn(),
  pmGet: vi.fn(),
  pmPut: vi.fn(),
  pmPost: vi.fn(),
}));

vi.mock('@/shared/api', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), api: { providers: { models: mocks.models } } }));
vi.mock('@/piecemaker/dossier/api', () => ({ pmGet: mocks.pmGet, pmPut: mocks.pmPut, pmPost: mocks.pmPost }));

import { ProviderSwitchSection } from '@/modules/piecemaker-quota';

const renderSection = (sessionId: string | null, onPick = vi.fn(), onDone = vi.fn()) => {
  render(
    <MemoryRouter>
      <ProviderSwitchSection provider="claude" sessionId={sessionId} projectPath="/dossiers/Dupont" onPickForNewChat={onPick} onDone={onDone} />
    </MemoryRouter>,
  );
  return { onPick, onDone };
};

describe('le changement de fournisseur depuis le chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.models.mockImplementation((provider: string) => json({ success: true, data: { models: { OPTIONS: [{ value: `${provider}-m`, label: `${provider} modèle` }], DEFAULT: `${provider}-m` } } }));
  });

  it('choisit le fournisseur et le modèle d’un nouveau chat sans quitter l’écran', async () => {
    const { onPick, onDone } = renderSection(null);
    fireEvent.click(await screen.findByRole('button', { name: 'codex modèle' }));
    expect(onPick).toHaveBeenCalledWith('codex', 'codex-m');
    expect(onDone).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'claude modèle' })).toBeNull();
  });

  it('change le fournisseur de l’agent dans ses réglages', async () => {
    mocks.pmGet.mockResolvedValue({ sessionId: 'agent-1' });
    mocks.pmPut.mockResolvedValue({});
    renderSection('agent-1');
    fireEvent.click(await screen.findByRole('button', { name: 'mistral modèle' }));
    await waitFor(() => expect(mocks.pmPut).toHaveBeenCalledWith('/orchestrateur/settings', { project: '/dossiers/Dupont', orchestratorProvider: 'mistral', orchestratorModel: 'mistral-m' }));
    expect(screen.queryByRole('button', { name: 'opencode modèle' })).toBeNull();
  });

  it('continue une session ordinaire dans une nouvelle session du fournisseur choisi', async () => {
    mocks.pmGet.mockResolvedValue({ sessionId: 'autre' });
    mocks.pmPost.mockResolvedValue({ sessionId: 'nouvelle' });
    renderSection('session-1');
    fireEvent.click(await screen.findByRole('button', { name: 'codex modèle' }));
    await waitFor(() => expect(mocks.pmPost).toHaveBeenCalledWith('/quota/handoff', expect.objectContaining({ sessionId: 'session-1', provider: 'codex', model: 'codex-m', reason: 'switch' })));
  });
});
