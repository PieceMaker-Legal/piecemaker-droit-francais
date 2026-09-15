import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pmGet, pmGetCached, pmPost, invalidatePmGet } = vi.hoisted(() => ({
  pmGet: vi.fn(),
  pmGetCached: vi.fn(),
  pmPost: vi.fn(),
  invalidatePmGet: vi.fn(),
}));

vi.mock('@/piecemaker/dossier/api', () => ({
  PieceMakerApiError: class extends Error {},
  pmGet,
  pmGetCached,
  pmPost,
  invalidatePmGet,
}));

vi.mock('@/piecemaker/dossier/DossierContext', () => ({
  useDossierCases: () => ({ selectedCaseId: 'case-1', mappingVersion: 0, bumpMappingVersion: () => undefined }),
}));

import CaseMappingSetup from '@/piecemaker/dossier/sections/CaseMappingSetup';

const anonymizedOverview = {
  folder: {
    path: 'case-1',
    location: '/cabinet/a',
    mapping: { exists: true, entries: 12 },
    originals: [
      { name: 'a.pdf', path: 'a.pdf', extension: '.pdf', size: 10, modifiedAt: '', converted: true, scanned: true, protected: true, resource: false, status: 'ready' },
      { name: 'b.pdf', path: 'b.pdf', extension: '.pdf', size: 10, modifiedAt: '', converted: false, scanned: false, protected: true, resource: false, status: 'not-converted' },
    ],
  },
};

describe('CaseMappingSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pmGetCached.mockImplementation((path: string) => (path === '/repository/case'
      ? Promise.resolve(anonymizedOverview)
      : Promise.resolve({ components: { gliner: { installed: true } } })));
    pmPost.mockResolvedValue({ job: { id: 'job-1', state: 'queued', percent: 0 } });
  });

  it('propose de rescanner toutes les pièces sur un dossier déjà anonymisé', async () => {
    render(<CaseMappingSetup />);

    fireEvent.click(await screen.findByRole('button', { name: /Relancer/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Rescanner toutes les pièces/ }));

    await waitFor(() => expect(pmPost).toHaveBeenCalledWith('/originals/pipeline', {
      case: 'case-1',
      action: 'anonymize',
      files: [],
      force: true,
      engine: 'markitdown',
    }));
  });

  it('propose de ne scanner que les nouvelles pièces sur un dossier déjà anonymisé', async () => {
    render(<CaseMappingSetup />);

    fireEvent.click(await screen.findByRole('button', { name: /Relancer/ }));
    const scanNewOnly = await screen.findByRole('menuitem', { name: /Scanner les nouvelles pièces/ });
    expect(scanNewOnly.textContent).toContain('1 pièce nouvelle');
    fireEvent.click(scanNewOnly);

    await waitFor(() => expect(pmPost).toHaveBeenCalledWith('/originals/pipeline', {
      case: 'case-1',
      action: 'anonymize',
      files: [],
      force: false,
      engine: 'markitdown',
    }));
  });

  it('ne force pas le retraitement quand aucun mapping n’existe', async () => {
    pmGetCached.mockImplementation((path: string) => (path === '/repository/case'
      ? Promise.resolve({ folder: { path: 'case-1', location: '/cabinet/a', mapping: { exists: false, entries: 0 } } })
      : Promise.resolve({ components: { gliner: { installed: true } } })));

    render(<CaseMappingSetup />);

    fireEvent.click(await screen.findByRole('button', { name: /Anonymiser/ }));

    await waitFor(() => expect(pmPost).toHaveBeenCalledWith('/originals/pipeline', expect.objectContaining({ force: false })));
  });
});
