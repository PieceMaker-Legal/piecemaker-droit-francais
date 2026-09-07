import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMikeData } = vi.hoisted(() => ({ getMikeData: vi.fn() }));
vi.mock('@/piecemaker/mike/api', () => ({ getMikeData }));

import { WorkflowPickerDialog } from '@/piecemaker/mike/pickers/WorkflowPickerDialog';

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
});

describe('WorkflowPickerDialog', () => {
  it('n’affiche que les workflows assistant, filtrés par recherche', async () => {
    render(<WorkflowPickerDialog open onClose={vi.fn()} onSelect={vi.fn()} />);
    await screen.findAllByText('Analyse de contrat');
    expect(screen.queryByText('Extraction de pièces')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Rechercher un workflow…'), { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.queryAllByText('Analyse de contrat')).toHaveLength(0));
  });

  it('sélectionne un workflow puis confirme avec la demande saisie', async () => {
    const onSelect = vi.fn();
    render(<WorkflowPickerDialog open onClose={vi.fn()} onSelect={onSelect} />);
    await screen.findAllByText('Analyse de contrat');

    fireEvent.change(screen.getByLabelText('Précisez votre demande (facultatif)'), { target: { value: '  Vérifie la clause de résiliation  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Utiliser ce workflow' }));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'wf-assistant' }), 'Vérifie la clause de résiliation');
  });

  it('confirme avec une demande nulle quand le champ est vide', async () => {
    const onSelect = vi.fn();
    render(<WorkflowPickerDialog open onClose={vi.fn()} onSelect={onSelect} />);
    await screen.findAllByText('Analyse de contrat');

    fireEvent.click(screen.getByRole('button', { name: 'Utiliser ce workflow' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'wf-assistant' }), null);
  });

  it('affiche une erreur récupérable', async () => {
    getMikeData.mockReset().mockRejectedValueOnce(new Error('Workflows Mike indisponibles')).mockResolvedValueOnce(WORKFLOWS);
    render(<WorkflowPickerDialog open onClose={vi.fn()} onSelect={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Workflows Mike indisponibles');

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await screen.findAllByText('Analyse de contrat');
  });

  it('ne charge rien tant que la boîte de dialogue est fermée', () => {
    render(<WorkflowPickerDialog open={false} onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(getMikeData).not.toHaveBeenCalled();
  });
});
