import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchShellEnvironment } from '@/piecemaker/shell-environment/api';
import { startShellEnvironmentWarning } from '@/piecemaker/shell-environment/bootstrap';
import { AUTH_TOKEN_REFRESHED_EVENT } from '@/shared/authToken';

vi.mock('@/piecemaker/shell-environment/api', () => ({ fetchShellEnvironment: vi.fn() }));

let stop: (() => void) | null = null;
afterEach(() => {
  act(() => stop?.());
  stop = null;
  vi.clearAllMocks();
});

describe("avertissement d'environnement du shell", () => {
  it("s'affiche quand la résolution a échoué et se masque", async () => {
    vi.mocked(fetchShellEnvironment).mockResolvedValue({ status: 'failed', shell: '/bin/zsh', reason: "le shell /bin/zsh n'a pas répondu en 10 s" });
    stop = startShellEnvironmentWarning();
    expect((await screen.findByRole('alert')).textContent).toContain("n'a pas répondu en 10 s");
    fireEvent.click(screen.getByRole('button', { name: "Masquer l'avertissement" }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it("reste invisible quand l'environnement est résolu ou hérité", async () => {
    for (const state of [{ status: 'resolved', shell: '/bin/zsh' }, { status: 'inherited' }] as const) {
      vi.mocked(fetchShellEnvironment).mockResolvedValueOnce(state);
      stop = startShellEnvironmentWarning();
      await waitFor(() => expect(fetchShellEnvironment).toHaveBeenCalled());
      expect(screen.queryByRole('alert')).toBeNull();
      act(() => stop?.());
    }
    stop = null;
  });

  it('réessaie après la connexion quand la session était absente', async () => {
    vi.mocked(fetchShellEnvironment)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: 'failed', shell: '/bin/zsh', reason: 'config cassée' });
    stop = startShellEnvironmentWarning();
    await waitFor(() => expect(fetchShellEnvironment).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => { window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT, { detail: 'jeton' })); });
    expect((await screen.findByRole('alert')).textContent).toContain('config cassée');
  });
});
