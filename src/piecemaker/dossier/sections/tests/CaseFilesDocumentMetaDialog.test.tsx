import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invalidatePmGet, pmGetCached, pmPost, pmPut } = vi.hoisted(() => ({
  invalidatePmGet: vi.fn(),
  pmGetCached: vi.fn(),
  pmPost: vi.fn(),
  pmPut: vi.fn(),
}));

vi.mock('@/piecemaker/dossier/api', () => ({
  PieceMakerApiError: class extends Error {},
  PIECEMAKER_API_BASE: '/api/piecemaker',
  invalidatePmGet,
  pmGetCached,
  pmPost,
  pmPut,
}));

import CaseFilesChronology from '@/piecemaker/dossier/sections/CaseFilesChronology';
import CaseFilesDocumentMetaDialog from '@/piecemaker/dossier/sections/CaseFilesDocumentMetaDialog';
import type { ChronologyDocument } from '@/piecemaker/dossier/sections/CaseFilesTypes';
import { chronologyReviewReasons } from '@/piecemaker/dossier/sections/CaseFilesUtils';

const document: ChronologyDocument = {
  documentKey: 'a'.repeat(64),
  id: 'Assignation.pdf',
  path: 'Pièces/Assignation.pdf',
  name: 'Assignation.pdf',
  resource: false,
  scanned: true,
  analyzable: true,
  indexed: true,
  edited: false,
  nature: 'Assignation',
  date: null,
  dateIso: '2026-09-10',
  localisation: null,
  fields: [],
  codes: [{ code: 'PERSONNE_PHYSIQUE_01', category: 'personne', label: 'Alice Martin' }],
  detectedCodes: [{ code: 'PERSONNE_PHYSIQUE_01', category: 'personne', label: 'Alice Martin' }],
  entityDecisions: { additions: [], exclusions: [] },
  reviewRequired: false,
  reviewReasons: [],
};

describe('CaseFilesDocumentMetaDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pmPut.mockResolvedValue({ ok: true });
  });

  it('affiche les personnes indexées sans les motifs techniques', async () => {
    pmGetCached.mockImplementation(async (path: string) => path === '/mapping'
      ? {
          mapping: { 'Alice Martin': 'PERSONNE_PHYSIQUE_01' },
          reverse_mapping: { PERSONNE_PHYSIQUE_01: ['Alice Martin'] },
        }
      : {
          generatedAt: '2026-09-10T08:00:00.000Z',
          graphRevision: 1,
          mapping: { exists: true, entries: 1 },
          stats: { documents: 1, indexed: 1, dated: 1, entities: 1, span: null },
          documents: [document],
          datedDocuments: [{ ...document, reviewRequired: true, reviewReasons: ['aucune_personne_indexee', 'aucune_partie_selectionnee'] }],
          undatedDocuments: [],
          graph: { status: 'ready', state: {}, revision: 1 },
          case: { path: 'case-1', name: 'Dossier', location: '/tmp/dossier' },
        });

    render(<CaseFilesChronology caseId="case-1" caseName="Dossier" refreshVersion={0} />);

    await waitFor(() => expect(screen.getByText('Alice Martin')).toBeTruthy());
    expect(screen.queryByText(/aucune_personne_indexee|aucune_partie_selectionnee/)).toBeNull();
    expect(screen.queryByText('À vérifier')).toBeNull();
  });

  it('ajoute et retire des personnes du mapping pour une pièce', async () => {
    render(
      <CaseFilesDocumentMetaDialog
        caseId="case-1"
        document={document}
        entityOptions={[
          { code: 'PERSONNE_PHYSIQUE_01', label: 'Alice Martin' },
          { code: 'PERSONNE_PHYSIQUE_02', label: 'Bob Durand' },
        ]}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Alice Martin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bob Durand' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });

    await waitFor(() => expect(pmPut).toHaveBeenCalledWith('/repository/document-meta', expect.objectContaining({
      entityDecisions: {
        additions: ['PERSONNE_PHYSIQUE_02'],
        exclusions: ['PERSONNE_PHYSIQUE_01'],
      },
    })));
  });

  it('masque les motifs internes correspondant à une sélection vide', () => {
    expect(chronologyReviewReasons([
      'aucune_personne_indexee',
      'aucune_partie_selectionnee',
      'markdown_indisponible',
    ])).toEqual(['markdown indisponible']);
  });
});
