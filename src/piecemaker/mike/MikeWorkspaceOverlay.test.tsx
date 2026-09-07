import { act, render, screen } from '@testing-library/react';
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

import { MikeWorkspaceOverlay } from '@/piecemaker/mike/MikeWorkspaceOverlay';
import { setMikePage } from '@/piecemaker/mike/page';
import { publishWorkflowSessionBridge } from '@/piecemaker/mike/sessionBridge';

beforeEach(() => {
  getMikeData.mockReset().mockResolvedValue([]);
  openMikePage.mockReset();
  setMikePage(null);
  publishWorkflowSessionBridge({ projectPath: null, pathname: '/', navigate: () => {} });
});

describe('recouvrement Mike hors de l’arbre CloudCLI', () => {
  it('n’affiche rien tant qu’aucune page n’est choisie', () => {
    render(<MikeWorkspaceOverlay />);
    expect(screen.queryByLabelText('Espace PieceMaker')).toBeNull();
  });

  it('ouvre une page sans dossier sélectionné', async () => {
    render(<MikeWorkspaceOverlay />);
    act(() => setMikePage('/workflows'));
    await screen.findByLabelText('Espace PieceMaker');
    await screen.findByText('Aucun workflow disponible.');
  });

  it('reste ouverte quand le dossier courant change', async () => {
    render(<MikeWorkspaceOverlay />);
    act(() => setMikePage('/workflows'));
    await screen.findByLabelText('Espace PieceMaker');

    act(() => publishWorkflowSessionBridge({ projectPath: '/dossiers/premier', pathname: '/session/abc', navigate: () => {} }));
    expect(screen.getByLabelText('Espace PieceMaker')).not.toBeNull();

    act(() => publishWorkflowSessionBridge({ projectPath: '/dossiers/second', pathname: '/', navigate: () => {} }));
    expect(screen.getByLabelText('Espace PieceMaker')).not.toBeNull();
  });

  it('se referme sur demande explicite', async () => {
    render(<MikeWorkspaceOverlay />);
    act(() => setMikePage('/library'));
    await screen.findByLabelText('Espace PieceMaker');

    act(() => setMikePage(null));
    expect(screen.queryByLabelText('Espace PieceMaker')).toBeNull();
  });

  it('se monte dans la région de l’espace de travail CloudCLI quand elle existe', async () => {
    const shell = document.createElement('div');
    shell.className = 'fixed inset-0 flex bg-background';
    const region = document.createElement('div');
    region.className = 'flex min-w-0 flex-1 flex-col';
    const existingChild = document.createElement('div');
    existingChild.textContent = 'Contenu CloudCLI existant';
    region.appendChild(existingChild);
    shell.appendChild(region);
    document.body.appendChild(shell);

    try {
      render(<MikeWorkspaceOverlay />);
      act(() => setMikePage('/workflows'));
      const viewer = await screen.findByLabelText('Espace PieceMaker');

      expect(region.contains(viewer)).toBe(true);
      expect(existingChild.style.display).toBe('none');

      act(() => setMikePage(null));
      expect(screen.queryByLabelText('Espace PieceMaker')).toBeNull();
      expect(region.contains(existingChild)).toBe(true);
      expect(existingChild.style.display).toBe('');
      expect(region.querySelector('[data-pm-mike-overlay]')).toBeNull();
    } finally {
      document.body.removeChild(shell);
    }
  });
});
