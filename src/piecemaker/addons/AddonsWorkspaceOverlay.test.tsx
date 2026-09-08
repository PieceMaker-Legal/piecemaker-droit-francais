import { act, render, screen } from '@testing-library/react';
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

import { AddonsWorkspaceOverlay } from '@/piecemaker/addons/AddonsWorkspaceOverlay';
import { setAddonsPage } from '@/piecemaker/addons/page';
import { publishWorkflowSessionBridge } from '@/piecemaker/addons/sessionBridge';

beforeEach(() => {
  getAddonsData.mockReset().mockResolvedValue([]);
  openAddonsPage.mockReset();
  setAddonsPage(null);
  publishWorkflowSessionBridge({ projectPath: null, pathname: '/', navigate: () => {} });
});

describe('recouvrement Addons hors de l’arbre CloudCLI', () => {
  it('n’affiche rien tant qu’aucune page n’est choisie', () => {
    render(<AddonsWorkspaceOverlay />);
    expect(screen.queryByLabelText('Espace PieceMaker')).toBeNull();
  });

  it('ouvre une page sans dossier sélectionné', async () => {
    render(<AddonsWorkspaceOverlay />);
    act(() => setAddonsPage('/workflows'));
    await screen.findByLabelText('Espace PieceMaker');
    await screen.findByText('Aucun workflow disponible.');
  });

  it('reste ouverte quand le dossier courant change', async () => {
    render(<AddonsWorkspaceOverlay />);
    act(() => setAddonsPage('/workflows'));
    await screen.findByLabelText('Espace PieceMaker');

    act(() => publishWorkflowSessionBridge({ projectPath: '/dossiers/premier', pathname: '/session/abc', navigate: () => {} }));
    expect(screen.getByLabelText('Espace PieceMaker')).not.toBeNull();

    act(() => publishWorkflowSessionBridge({ projectPath: '/dossiers/second', pathname: '/', navigate: () => {} }));
    expect(screen.getByLabelText('Espace PieceMaker')).not.toBeNull();
  });

  it('se referme sur demande explicite', async () => {
    render(<AddonsWorkspaceOverlay />);
    act(() => setAddonsPage('/library'));
    await screen.findByLabelText('Espace PieceMaker');

    act(() => setAddonsPage(null));
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
      render(<AddonsWorkspaceOverlay />);
      act(() => setAddonsPage('/workflows'));
      const viewer = await screen.findByLabelText('Espace PieceMaker');

      expect(region.contains(viewer)).toBe(true);
      expect(existingChild.style.display).toBe('none');

      act(() => setAddonsPage(null));
      expect(screen.queryByLabelText('Espace PieceMaker')).toBeNull();
      expect(region.contains(existingChild)).toBe(true);
      expect(existingChild.style.display).toBe('');
      expect(region.querySelector('[data-pm-addons-overlay]')).toBeNull();
    } finally {
      document.body.removeChild(shell);
    }
  });
});
