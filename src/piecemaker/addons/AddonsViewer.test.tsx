import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '@/modules/i18n/config';

const { getAddonsData, openAddonsPage, closeAddonsSession } = vi.hoisted(() => ({
  getAddonsData: vi.fn(),
  openAddonsPage: vi.fn(),
  closeAddonsSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/piecemaker/addons/api', () => ({
  getAddonsData,
  openAddonsPage,
  closeAddonsSession,
  downloadAddonsDocument: vi.fn(),
}));
vi.mock('@/piecemaker/addons/Organisation', () => ({ Organisation: () => <main aria-label="Organisation native">Organisation</main> }));

import { AddonsViewer } from '@/piecemaker/addons/AddonsViewer';
import { readAddonsPage, setAddonsPage } from '@/piecemaker/addons/page';

function endpointResponse(endpoint: string) {
  if (endpoint.startsWith('/workflows')) return [];
  if (endpoint.startsWith('/tabular-review')) return [];
  if (endpoint.startsWith('/library/')) return { documents: [], folders: [] };
  return [];
}

beforeEach(() => {
  getAddonsData.mockReset().mockImplementation(async (endpoint: string) => endpointResponse(endpoint));
  openAddonsPage.mockReset();
  closeAddonsSession.mockReset().mockResolvedValue(undefined);
  setAddonsPage(null);
});

describe('visionneuse Addons montée dans l’arbre React', () => {
  it.each([
    ['/workflows', 'Aucun workflow disponible.'],
    ['/library', 'Aucun document dans ce dossier.'],
    ['/tabular-reviews', 'Aucune revue tabulaire disponible.'],
    ['/organisation', 'Organisation native'],
  ])('rend la page native %s sans ouvrir de passerelle', async (path, expectedText) => {
    render(<AddonsViewer projectPath="/dossiers/premier" />);
    act(() => setAddonsPage(path));
    await screen.findByLabelText('Espace PieceMaker');
    if (path === '/organisation') {
      await screen.findByRole('main', { name: expectedText });
    } else {
      await screen.findByText(expectedText);
    }
    expect(openAddonsPage).not.toHaveBeenCalled();
  });

  it('reste ouverte quand le dossier change et sans dossier du tout', async () => {
    const { rerender } = render(<AddonsViewer projectPath="/dossiers/premier" />);
    expect(screen.queryByLabelText('Espace PieceMaker')).toBeNull();

    act(() => setAddonsPage('/workflows'));
    await screen.findByLabelText('Espace PieceMaker');
    await screen.findByText('Aucun workflow disponible.');

    rerender(<AddonsViewer projectPath="/dossiers/second" />);
    expect(screen.getByLabelText('Espace PieceMaker')).not.toBeNull();
    expect(readAddonsPage()).toBe('/workflows');

    rerender(<AddonsViewer projectPath={null} />);
    expect(screen.getByLabelText('Espace PieceMaker')).not.toBeNull();
    await screen.findByText('Aucun workflow disponible.');
  });

  it('n’affiche que la page choisie quand la navigation change pendant son chargement', async () => {
    const requests: Array<{ endpoint: string; resolve: (value: unknown) => void }> = [];
    getAddonsData.mockImplementation((endpoint: string) => new Promise((resolve) => { requests.push({ endpoint, resolve }); }));
    render(<AddonsViewer />);

    act(() => setAddonsPage('/workflows'));
    await waitFor(() => expect(requests).toHaveLength(1));

    act(() => setAddonsPage('/library'));
    await waitFor(() => expect(requests).toHaveLength(2));

    act(() => requests[0].resolve([]));
    expect(screen.queryByText('Aucun workflow disponible.')).toBeNull();

    act(() => requests[1].resolve({ documents: [], folders: [] }));
    await screen.findByText('Aucun document dans ce dossier.');
  });

  it('retire l’état de chargement après un échec et peut relancer la requête', async () => {
    getAddonsData.mockRejectedValueOnce(new Error('Addons indisponible')).mockResolvedValueOnce([]);
    render(<AddonsViewer />);

    act(() => setAddonsPage('/workflows'));
    expect((await screen.findByRole('alert')).textContent).toContain('Addons indisponible');
    screen.getByRole('button', { name: 'Réessayer' }).click();
    await waitFor(() => expect(getAddonsData).toHaveBeenCalledTimes(2));
    await screen.findByText('Aucun workflow disponible.');
  });
});
