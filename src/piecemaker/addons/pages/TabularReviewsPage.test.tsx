import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '@/modules/i18n/config';

const { getAddonsData } = vi.hoisted(() => ({ getAddonsData: vi.fn() }));
vi.mock('@/piecemaker/addons/api', () => ({ getAddonsData }));

import { TabularReviewsPage } from '@/piecemaker/addons/pages/TabularReviewsPage';

const LIST_RESPONSE = [
  { id: 'rev-1', title: 'Revue conformité', columns_config: null, document_count: 3, updated_at: '2026-01-04T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z', is_running: false },
];

const DETAIL_RESPONSE = {
  review: { ...LIST_RESPONSE[0], columns_config: [{ index: 0, name: 'Résumé', prompt: 'Résume la pièce.' }] },
  rows: [{ id: 'row-1', label: 'Pièce 1', sort_index: 0 }],
  cells: [
    { id: 'cell-1', row_id: 'row-1', column_index: 0, content: { summary: 'Contrat valide', flag: 'green' }, status: 'done' },
  ],
  documents: [],
};

beforeEach(() => {
  getAddonsData.mockReset().mockImplementation(async (endpoint: string) => {
    if (endpoint === '/tabular-review') return LIST_RESPONSE;
    if (endpoint === '/tabular-review/rev-1') return DETAIL_RESPONSE;
    throw new Error(`Point de terminaison inattendu : ${endpoint}`);
  });
});

describe('page Revues tabulaires', () => {
  it('affiche la liste des revues', async () => {
    render(<TabularReviewsPage />);
    await screen.findByText('Revue conformité');
    expect(screen.getByText('3 documents')).toBeTruthy();
  });

  it('affiche une erreur récupérable', async () => {
    getAddonsData.mockReset().mockRejectedValueOnce(new Error('Revues Addons indisponibles')).mockResolvedValueOnce(LIST_RESPONSE);
    render(<TabularReviewsPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Revues Addons indisponibles');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await screen.findByText('Revue conformité');
  });

  it('ouvre une revue puis revient à la liste', async () => {
    render(<TabularReviewsPage />);
    await screen.findByText('Revue conformité');
    fireEvent.click(screen.getByText('Revue conformité'));

    await screen.findByText('Pièce 1');
    expect(screen.getByText('Résumé')).toBeTruthy();
    expect(screen.getByText('Contrat valide')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Conforme' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Retour aux revues/ }));
    await screen.findByText('Revue conformité');
    expect(screen.queryByText('Pièce 1')).toBeNull();
  });
});
