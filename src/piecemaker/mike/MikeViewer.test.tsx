import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMikeData, openMikePage, closeMikeSession } = vi.hoisted(() => ({
  getMikeData: vi.fn(),
  openMikePage: vi.fn(),
  closeMikeSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/piecemaker/mike/api', () => ({
  getMikeData,
  openMikePage,
  closeMikeSession,
  downloadMikeDocument: vi.fn(),
}));
vi.mock('@/piecemaker/mike/Organisation', () => ({ Organisation: () => <main aria-label="Organisation native">Organisation</main> }));

import { MikeViewer } from '@/piecemaker/mike/MikeViewer';
import { readMikePage, setMikePage } from '@/piecemaker/mike/page';

function endpointResponse(endpoint: string) {
  if (endpoint.startsWith('/workflows')) return [];
  if (endpoint.startsWith('/tabular-review')) return [];
  if (endpoint.startsWith('/library/')) return { documents: [], folders: [] };
  return [];
}

beforeEach(() => {
  getMikeData.mockReset().mockImplementation(async (endpoint: string) => endpointResponse(endpoint));
  openMikePage.mockReset();
  closeMikeSession.mockReset().mockResolvedValue(undefined);
  setMikePage(null);
});

describe('visionneuse Mike montée dans l’arbre React', () => {
  it.each([
    ['/workflows', 'Aucun workflow disponible.'],
    ['/library', 'Aucun document dans ce dossier.'],
    ['/tabular-reviews', 'Aucune revue tabulaire disponible.'],
    ['/organisation', 'Organisation native'],
  ])('rend la page native %s sans ouvrir de passerelle', async (path, expectedText) => {
    render(<MikeViewer projectPath="/dossiers/premier" />);
    act(() => setMikePage(path));
    await screen.findByLabelText('Espace PieceMaker');
    if (path === '/organisation') {
      await screen.findByRole('main', { name: expectedText });
    } else {
      await screen.findByText(expectedText);
    }
    expect(openMikePage).not.toHaveBeenCalled();
  });

  it('reste ouverte quand le dossier change et sans dossier du tout', async () => {
    const { rerender } = render(<MikeViewer projectPath="/dossiers/premier" />);
    expect(screen.queryByLabelText('Espace PieceMaker')).toBeNull();

    act(() => setMikePage('/workflows'));
    await screen.findByLabelText('Espace PieceMaker');
    await screen.findByText('Aucun workflow disponible.');

    rerender(<MikeViewer projectPath="/dossiers/second" />);
    expect(screen.getByLabelText('Espace PieceMaker')).not.toBeNull();
    expect(readMikePage()).toBe('/workflows');

    rerender(<MikeViewer projectPath={null} />);
    expect(screen.getByLabelText('Espace PieceMaker')).not.toBeNull();
    await screen.findByText('Aucun workflow disponible.');
  });

  it('n’affiche que la page choisie quand la navigation change pendant son chargement', async () => {
    const requests: Array<{ endpoint: string; resolve: (value: unknown) => void }> = [];
    getMikeData.mockImplementation((endpoint: string) => new Promise((resolve) => { requests.push({ endpoint, resolve }); }));
    render(<MikeViewer />);

    act(() => setMikePage('/workflows'));
    await waitFor(() => expect(requests).toHaveLength(1));

    act(() => setMikePage('/library'));
    await waitFor(() => expect(requests).toHaveLength(2));

    act(() => requests[0].resolve([]));
    expect(screen.queryByText('Aucun workflow disponible.')).toBeNull();

    act(() => requests[1].resolve({ documents: [], folders: [] }));
    await screen.findByText('Aucun document dans ce dossier.');
  });

  it('retire l’état de chargement après un échec et peut relancer la requête', async () => {
    getMikeData.mockRejectedValueOnce(new Error('Mike indisponible')).mockResolvedValueOnce([]);
    render(<MikeViewer />);

    act(() => setMikePage('/workflows'));
    expect((await screen.findByRole('alert')).textContent).toContain('Mike indisponible');
    screen.getByRole('button', { name: 'Réessayer' }).click();
    await waitFor(() => expect(getMikeData).toHaveBeenCalledTimes(2));
    await screen.findByText('Aucun workflow disponible.');
  });
});
