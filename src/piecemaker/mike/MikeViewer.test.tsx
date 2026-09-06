import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openMikePage, closeMikeSession } = vi.hoisted(() => ({
  openMikePage: vi.fn().mockResolvedValue('http://mike.test/workflows'),
  closeMikeSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/piecemaker/mike/api', () => ({ openMikePage, closeMikeSession }));
vi.mock('@/piecemaker/mike/Organisation', () => ({ Organisation: () => <div>Organisation</div> }));

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
    await screen.findByText('Organisation');
    expect(openMikePage).not.toHaveBeenCalled();
    unmount();
    expect(readMikePage()).toBeNull();
  });
});
