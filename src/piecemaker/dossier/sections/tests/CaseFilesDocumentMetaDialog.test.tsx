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
    window.localStorage.clear();
    pmPut.mockResolvedValue({ ok: true });
  });

  it('propose les types fixes dans un menu et conserve la valeur existante', () => {
    render(
      <CaseFilesDocumentMetaDialog
        caseId="case-1"
        document={document}
        entityOptions={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    const select = screen.getByRole('combobox', { name: 'Type de pièce' }) as HTMLSelectElement;
    expect(select.value).toBe('Assignation');
    expect([...select.options].map((option) => option.textContent)).toContain('extrait Kbis');
    expect(screen.queryByText('Type personnalisé')).toBeNull();
  });

  it('enregistre un type personnalisé et propose de le mémoriser', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { unmount } = render(
      <CaseFilesDocumentMetaDialog
        caseId="case-1"
        document={{ ...document, nature: null }}
        entityOptions={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Type de pièce' }), {
      target: { value: '__piecemaker_custom_nature__' },
    });
    fireEvent.change(screen.getByLabelText('Type personnalisé'), { target: { value: 'Sommation de payer' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });

    expect(confirm).toHaveBeenCalledWith('Mémoriser « Sommation de payer » dans le menu des types de pièce ?');
    expect(JSON.parse(window.localStorage.getItem('piecemaker-custom-document-natures') ?? '[]')).toEqual(['Sommation de payer']);
    await waitFor(() => expect(pmPut).toHaveBeenCalledWith('/repository/document-meta', expect.objectContaining({
      nature: 'Sommation de payer',
    })));
    unmount();
    render(
      <CaseFilesDocumentMetaDialog
        caseId="case-1"
        document={{ ...document, nature: null }}
        entityOptions={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const reopenedSelect = screen.getByRole('combobox', { name: 'Type de pièce' }) as HTMLSelectElement;
    expect([...reopenedSelect.options].map((option) => option.textContent)).toContain('Sommation de payer');
    confirm.mockRestore();
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

  it('affiche le nom du mapping quand la chronologie ne fournit que le code', async () => {
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
          documents: [{ ...document, codes: [{ ...document.codes[0], label: null }] }],
          datedDocuments: [{ ...document, codes: [{ ...document.codes[0], label: null }] }],
          undatedDocuments: [],
          graph: { status: 'ready', state: {}, revision: 1 },
          case: { path: 'case-1', name: 'Dossier', location: '/tmp/dossier' },
        });

    render(<CaseFilesChronology caseId="case-1" caseName="Dossier" refreshVersion={0} />);

    await waitFor(() => expect(screen.getByText('Alice Martin')).toBeTruthy());
    expect(screen.queryByText('PERSONNE_PHYSIQUE_01')).toBeNull();
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

  it('affiche les personnes citées dans l’ordre de sélection puis alphabétique', () => {
    render(
      <CaseFilesDocumentMetaDialog
        caseId="case-1"
        document={document}
        entityOptions={[
          { code: 'PERSONNE_PHYSIQUE_03', label: 'Bob Durand' },
          { code: 'PERSONNE_PHYSIQUE_01', label: 'Alice Martin' },
          { code: 'PERSONNE_PHYSIQUE_02', label: 'Aaron Legrand' },
        ]}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    expect(screen.getByText('Personnes citées')).toBeTruthy();
    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'Alice Martin',
      'Aaron Legrand',
      'Bob Durand',
      'Ajouter',
      'Annuler',
      'Enregistrer',
    ]);
    expect(screen.getByRole('button', { name: 'Alice Martin' }).classList.contains('opacity-80')).toBe(false);
    expect(screen.getByRole('button', { name: 'Aaron Legrand' }).classList.contains('opacity-80')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Alice Martin' }));

    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'Aaron Legrand',
      'Alice Martin',
      'Bob Durand',
      'Ajouter',
      'Annuler',
      'Enregistrer',
    ]);
  });

  it('masque les motifs internes correspondant à une sélection vide', () => {
    expect(chronologyReviewReasons([
      'aucune_personne_indexee',
      'aucune_partie_selectionnee',
      'markdown_indisponible',
    ])).toEqual(['markdown indisponible']);
  });
});
