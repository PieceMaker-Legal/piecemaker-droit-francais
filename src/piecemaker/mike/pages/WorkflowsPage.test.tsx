import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMikeData } = vi.hoisted(() => ({ getMikeData: vi.fn() }));
vi.mock('@/piecemaker/mike/api', () => ({ getMikeData }));

const { appendMikeWorkflowDraft } = vi.hoisted(() => ({ appendMikeWorkflowDraft: vi.fn() }));
vi.mock('@/piecemaker/mike/ComposerActions', () => ({ appendMikeWorkflowDraft }));

import { WorkflowsPage } from '@/piecemaker/mike/pages/WorkflowsPage';
import { readMikePage, setMikePage } from '@/piecemaker/mike/page';

const WORKFLOWS = [
  {
    id: 'wf-assistant',
    metadata: {
      title: 'Analyse de contrat',
      description: 'Vérifie les clauses essentielles',
      type: 'assistant',
      practice: 'Droit des contrats',
      language: 'fr',
      jurisdictions: null,
    },
    skill_md: 'Lis le contrat puis résume les clauses.',
    columns_config: null,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'wf-tabular',
    metadata: {
      title: 'Extraction de pièces',
      description: 'Tableau des pièces versées',
      type: 'tabular',
      practice: null,
      language: 'fr',
      jurisdictions: null,
    },
    skill_md: null,
    columns_config: null,
    created_at: '2026-01-02T00:00:00.000Z',
  },
];

beforeEach(() => {
  getMikeData.mockReset().mockResolvedValue(WORKFLOWS);
  appendMikeWorkflowDraft.mockReset();
  setMikePage('/workflows');
});

describe('page Workflows', () => {
  it('filtre par type de workflow', async () => {
    render(<WorkflowsPage projectPath="/dossiers/premier" />);
    await screen.findByText('Extraction de pièces');

    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }));
    expect(screen.queryByText('Extraction de pièces')).toBeNull();
    expect(screen.getAllByText('Analyse de contrat').length).toBeGreaterThan(0);
  });

  it('filtre par recherche insensible aux accents', async () => {
    render(<WorkflowsPage projectPath="/dossiers/premier" />);
    await screen.findByText('Extraction de pièces');

    fireEvent.change(screen.getByPlaceholderText('Rechercher un workflow…'), { target: { value: 'verifie' } });
    await waitFor(() => expect(screen.queryByText('Extraction de pièces')).toBeNull());
    expect(screen.getAllByText('Analyse de contrat').length).toBeGreaterThan(0);
  });

  it('utilise le workflow sélectionné dans la session en cours', async () => {
    render(<WorkflowsPage projectPath="/dossiers/premier" />);
    await screen.findByText('Extraction de pièces');

    fireEvent.click(screen.getByRole('button', { name: 'Utiliser dans la session' }));
    expect(appendMikeWorkflowDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 'wf-assistant' }));
    expect(readMikePage()).toBeNull();
  });
});
