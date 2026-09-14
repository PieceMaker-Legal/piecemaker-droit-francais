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

  it('relance réellement le pipeline MarkItDown puis GLiNER sur un dossier déjà anonymisé', async () => {
    render(<CaseMappingSetup />);

    const relaunch = await screen.findByRole('button', { name: /Relancer/ });
    fireEvent.click(relaunch);

    await waitFor(() => expect(pmPost).toHaveBeenCalledWith('/originals/pipeline', {
      case: 'case-1',
      action: 'anonymize',
      files: [],
      force: true,
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
