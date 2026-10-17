import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchVibeInstallState, requestVibeInstall } from '@/piecemaker/vibe/api';
import { VibeInstallNotice } from '@/piecemaker/vibe/VibeInstallNotice';

vi.mock('@/piecemaker/vibe/api', () => ({ fetchVibeInstallState: vi.fn(), requestVibeInstall: vi.fn() }));

afterEach(() => vi.clearAllMocks());

describe('installation de Mistral Vibe', () => {
  it('reste invisible quand Vibe est installé ou que l’état est inconnu', async () => {
    for (const state of [{ installed: true, installing: false }, null]) {
      vi.mocked(fetchVibeInstallState).mockResolvedValueOnce(state);
      const { unmount } = render(<VibeInstallNotice onInstalled={vi.fn()} />);
      await waitFor(() => expect(fetchVibeInstallState).toHaveBeenCalled());
      expect(screen.queryByTestId('vibe-install-notice')).toBeNull();
      unmount();
    }
  });

  it('installe puis ouvre la connexion', async () => {
    vi.mocked(fetchVibeInstallState).mockResolvedValue({ installed: false, installing: false });
    vi.mocked(requestVibeInstall).mockResolvedValue();
    const onInstalled = vi.fn();
    render(<VibeInstallNotice onInstalled={onInstalled} />);
    fireEvent.click(await screen.findByRole('button', { name: /Installer Vibe/ }));
    await waitFor(() => expect(onInstalled).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('vibe-install-notice')).toBeNull();
  });

  it('affiche l’erreur et permet de réessayer', async () => {
    vi.mocked(fetchVibeInstallState).mockResolvedValue({ installed: false, installing: false });
    vi.mocked(requestVibeInstall).mockRejectedValue(new Error('Python 3.12 ou 3.13 est introuvable'));
    const onInstalled = vi.fn();
    render(<VibeInstallNotice onInstalled={onInstalled} />);
    fireEvent.click(await screen.findByRole('button', { name: /Installer Vibe/ }));
    expect(await screen.findByText(/introuvable/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Installer Vibe/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(onInstalled).not.toHaveBeenCalled();
  });

  it('rejoint une installation déjà en cours sans ouvrir la connexion', async () => {
    vi.mocked(fetchVibeInstallState).mockResolvedValue({ installed: false, installing: true });
    let finish = () => {};
    vi.mocked(requestVibeInstall).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const onInstalled = vi.fn();
    render(<VibeInstallNotice onInstalled={onInstalled} />);
    expect((await screen.findByRole('button', { name: /Installer Vibe/ }) as HTMLButtonElement).disabled).toBe(true);
    finish();
    await waitFor(() => expect(screen.queryByTestId('vibe-install-notice')).toBeNull());
    expect(onInstalled).not.toHaveBeenCalled();
  });
});
