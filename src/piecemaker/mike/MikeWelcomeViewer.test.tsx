import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMikeData, openMikePage } = vi.hoisted(() => ({
  getMikeData: vi.fn(),
  openMikePage: vi.fn(),
}));
vi.mock('@/piecemaker/mike/api', () => ({
  getMikeData,
  openMikePage,
  closeMikeSession: vi.fn().mockResolvedValue(undefined),
  downloadMikeDocument: vi.fn(),
}));
vi.mock('@/piecemaker/mike/Organisation', () => ({ Organisation: () => <div>Configuration autonome</div> }));

import { MikeSidebarNav } from '@/piecemaker/mike/MikeSidebarNav';
import { setMikePage } from '@/piecemaker/mike/page';
import { publishWorkflowSessionBridge } from '@/piecemaker/mike/sessionBridge';

function endpointResponse(endpoint: string) {
  if (endpoint.startsWith('/workflows')) return [];
  if (endpoint.startsWith('/tabular-review')) return [];
  if (endpoint.startsWith('/library/')) return { documents: [], folders: [] };
  return [];
}

beforeEach(() => {
  setMikePage(null);
  publishWorkflowSessionBridge({ projectPath: null, pathname: '/', navigate: vi.fn() });
  openMikePage.mockReset();
  getMikeData.mockReset().mockImplementation(async (endpoint: string) => endpointResponse(endpoint));
});

const EMPTY_LABEL: Record<string, string> = {
  '/workflows': 'Aucun workflow disponible.',
  '/tabular-reviews': 'Aucune revue tabulaire disponible.',
  '/library': 'Aucun document dans ce dossier.',
};

describe('onglets Mike sans dossier sélectionné', () => {
  it.each([
    ['Workflows', '/workflows'],
    ['Tabular review', '/tabular-reviews'],
    ['Library', '/library'],
    ['Organisation', '/organisation'],
  ])('ouvre %s depuis l’accueil et permet d’y revenir', async (title, path) => {
    render(<MemoryRouter><div className="fixed inset-0 flex bg-background">
      <MikeSidebarNav />
      <div className="flex min-w-0 flex-1 flex-col"><div>Accueil</div></div>
    </div></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: title }));
    if (path === '/organisation') {
      expect(await screen.findByText('Configuration autonome')).toBeTruthy();
    } else {
      await screen.findByText(EMPTY_LABEL[path]);
    }
    expect(openMikePage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Revenir à l’accueil' }));
    expect(screen.queryByLabelText('Espace PieceMaker')).toBeNull();
    expect(screen.getByText('Accueil')).toBeTruthy();
  });

  it('s’ouvre quand la zone de travail CloudCLI est montée après l’entrée Mike', async () => {
    render(<MemoryRouter><MikeSidebarNav /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    expect(screen.queryByLabelText('Espace PieceMaker')).toBeNull();

    const shell = document.createElement('div');
    shell.className = 'fixed inset-0 flex bg-background';
    const workspace = document.createElement('div');
    workspace.className = 'flex min-w-0 flex-1 flex-col';
    shell.appendChild(workspace);
    document.body.appendChild(shell);

    await waitFor(() => expect(screen.getByText('Aucun workflow disponible.')).toBeTruthy());
    shell.remove();
  });

  it('relance une page autonome après une erreur', async () => {
    getMikeData.mockRejectedValueOnce(new Error('Mike indisponible')).mockResolvedValueOnce([]);
    render(<MemoryRouter><div className="fixed inset-0 flex bg-background">
      <MikeSidebarNav />
      <div className="flex min-w-0 flex-1 flex-col"><div>Accueil</div></div>
    </div></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Mike indisponible');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(getMikeData).toHaveBeenCalledTimes(2));
    await screen.findByText('Aucun workflow disponible.');
  });
});
