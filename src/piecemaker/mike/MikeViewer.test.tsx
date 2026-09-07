import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openMikePage, closeMikeSession } = vi.hoisted(() => ({
  openMikePage: vi.fn().mockResolvedValue('http://mike.test/workflows'),
  closeMikeSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/piecemaker/mike/api', () => ({ openMikePage, closeMikeSession }));
vi.mock('@/piecemaker/mike/Organisation', () => ({ Organisation: () => <main aria-label="Organisation native">Organisation</main> }));

import { MikeViewer } from '@/piecemaker/mike/MikeViewer';
import { readMikePage, setMikePage } from '@/piecemaker/mike/page';

beforeEach(() => {
  openMikePage.mockReset().mockResolvedValue('http://mike.test/workflows');
  closeMikeSession.mockReset().mockResolvedValue(undefined);
  setMikePage(null);
});

describe('visionneuse Mike montée dans l’arbre React', () => {
  it('occupe la zone de travail puis se referme quand le dossier change', async () => {
    const { rerender } = render(<MemoryRouter><MikeViewer projectPath="/dossiers/premier" /></MemoryRouter>);
    expect(screen.queryByLabelText('Espace PieceMaker')).toBeNull();

    act(() => setMikePage('/workflows'));
    await screen.findByLabelText('Espace PieceMaker');
    await waitFor(() => expect(screen.getByTitle('Espace Mike').getAttribute('src')).toBe('http://mike.test/workflows'));

    rerender(<MemoryRouter><MikeViewer projectPath="/dossiers/second" /></MemoryRouter>);
    expect(screen.queryByLabelText('Espace PieceMaker')).toBeNull();
    expect(readMikePage()).toBeNull();
    await waitFor(() => expect(closeMikeSession).toHaveBeenCalled());
  });

  it('rend l’Organisation sans ouvrir de passerelle et libère la session au démontage', async () => {
    const { unmount } = render(<MemoryRouter><MikeViewer projectPath="/dossiers/premier" /></MemoryRouter>);
    act(() => setMikePage('/organisation'));
    await screen.findByRole('main', { name: 'Organisation native' });
    expect(openMikePage).not.toHaveBeenCalled();
    unmount();
    expect(readMikePage()).toBeNull();
  });

  it('n’affiche que la page choisie quand la navigation change pendant son ouverture', async () => {
    const requests: Array<{ path: string; resolve: (url: string) => void }> = [];
    openMikePage.mockImplementation((path: string) => new Promise<string>((resolve) => { requests.push({ path, resolve }); }));
    render(<MemoryRouter><MikeViewer /></MemoryRouter>);

    act(() => setMikePage('/workflows'));
    await waitFor(() => expect(requests).toHaveLength(1));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Navigation Mike' })).getByRole('button', { name: 'Library' }));
    await waitFor(() => expect(requests).toHaveLength(2));

    act(() => requests[0].resolve('http://mike.test/workflows'));
    expect(screen.queryByTitle('Espace Mike')).toBeNull();
    act(() => requests[1].resolve('http://mike.test/library'));
    await waitFor(() => expect(screen.getByTitle('Espace Mike').getAttribute('src')).toBe('http://mike.test/library'));
  });

  it('retire la visionneuse après un échec et peut relancer l’ouverture', async () => {
    openMikePage.mockRejectedValueOnce(new Error('Mike indisponible')).mockResolvedValueOnce('http://mike.test/workflows');
    render(<MemoryRouter><MikeViewer /></MemoryRouter>);

    act(() => setMikePage('/workflows'));
    expect((await screen.findByRole('alert')).textContent).toContain('Mike indisponible');
    expect(screen.queryByTitle('Espace Mike')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(openMikePage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTitle('Espace Mike').getAttribute('src')).toBe('http://mike.test/workflows'));
  });
});
