import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
    render(<MemoryRouter><MikeViewer projectPath="/dossiers/premier" /></MemoryRouter>);
    act(() => setMikePage(path));
    await screen.findByLabelText('Espace PieceMaker');
    if (path === '/organisation') {
      await screen.findByRole('main', { name: expectedText });
    } else {
      await screen.findByText(expectedText);
    }
    expect(openMikePage).not.toHaveBeenCalled();
  });

  it('se referme quand le dossier change', async () => {
    const { rerender } = render(<MemoryRouter><MikeViewer projectPath="/dossiers/premier" /></MemoryRouter>);
    expect(screen.queryByLabelText('Espace PieceMaker')).toBeNull();

    act(() => setMikePage('/workflows'));
    await screen.findByLabelText('Espace PieceMaker');
    await screen.findByText('Aucun workflow disponible.');

    rerender(<MemoryRouter><MikeViewer projectPath="/dossiers/second" /></MemoryRouter>);
    expect(screen.queryByLabelText('Espace PieceMaker')).toBeNull();
    expect(readMikePage()).toBeNull();
  });

  it('libère la session Mike au démontage', () => {
    const { unmount } = render(<MemoryRouter><MikeViewer projectPath="/dossiers/premier" /></MemoryRouter>);
    act(() => setMikePage('/workflows'));
    unmount();
    expect(readMikePage()).toBeNull();
  });

  it('n’affiche que la page choisie quand la navigation change pendant son chargement', async () => {
    const requests: Array<{ endpoint: string; resolve: (value: unknown) => void }> = [];
    getMikeData.mockImplementation((endpoint: string) => new Promise((resolve) => { requests.push({ endpoint, resolve }); }));
    render(<MemoryRouter><MikeViewer /></MemoryRouter>);

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
    render(<MemoryRouter><MikeViewer /></MemoryRouter>);

    act(() => setMikePage('/workflows'));
    expect((await screen.findByRole('alert')).textContent).toContain('Mike indisponible');
    screen.getByRole('button', { name: 'Réessayer' }).click();
    await waitFor(() => expect(getMikeData).toHaveBeenCalledTimes(2));
    await screen.findByText('Aucun workflow disponible.');
  });
});
