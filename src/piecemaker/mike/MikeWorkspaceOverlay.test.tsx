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
});
