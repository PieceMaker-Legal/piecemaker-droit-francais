import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openMikePage } = vi.hoisted(() => ({ openMikePage: vi.fn() }));
vi.mock('@/piecemaker/mike/api', () => ({ openMikePage, closeMikeSession: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/piecemaker/mike/Organisation', () => ({ Organisation: () => <div>Configuration autonome</div> }));

import { MikeSidebarNav } from '@/piecemaker/mike/MikeSidebarNav';
import { setMikePage } from '@/piecemaker/mike/page';
import { publishWorkflowSessionBridge } from '@/piecemaker/mike/sessionBridge';

beforeEach(() => {
  setMikePage(null);
  publishWorkflowSessionBridge({ projectPath: null, pathname: '/', navigate: vi.fn() });
  openMikePage.mockReset().mockImplementation(async (path: string) => `http://mike.test${path}`);
});

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
      expect(openMikePage).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(screen.getByTitle('Espace Mike').getAttribute('src')).toBe(`http://mike.test${path}`));
      expect(openMikePage).toHaveBeenCalledWith(path);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Revenir à l’accueil' }));
    expect(screen.queryByLabelText('Espace PieceMaker')).toBeNull();
    expect(screen.getByText('Accueil')).toBeTruthy();
  });

  it('s’ouvre quand la zone de travail CloudCLI est montée après l’entrée Mike', async () => {
    render(<MemoryRouter><MikeSidebarNav /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    expect(screen.queryByTitle('Espace Mike')).toBeNull();

    const shell = document.createElement('div');
    shell.className = 'fixed inset-0 flex bg-background';
    const workspace = document.createElement('div');
    workspace.className = 'flex min-w-0 flex-1 flex-col';
    shell.appendChild(workspace);
    document.body.appendChild(shell);

    await waitFor(() => expect(screen.getByTitle('Espace Mike').getAttribute('src')).toBe('http://mike.test/workflows'));
    shell.remove();
  });

  it('relance une page autonome après une erreur', async () => {
    openMikePage.mockRejectedValueOnce(new Error('Mike indisponible')).mockResolvedValueOnce('http://mike.test/workflows');
    render(<MemoryRouter><div className="fixed inset-0 flex bg-background">
      <MikeSidebarNav />
      <div className="flex min-w-0 flex-1 flex-col"><div>Accueil</div></div>
    </div></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Mike indisponible');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(openMikePage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTitle('Espace Mike').getAttribute('src')).toBe('http://mike.test/workflows'));
  });
});
