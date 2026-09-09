import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pmGetCached, pmPut, invalidatePmGet } = vi.hoisted(() => ({
  pmGetCached: vi.fn(),
  pmPut: vi.fn(),
  invalidatePmGet: vi.fn(),
}));

vi.mock('@/piecemaker/dossier/api', () => ({
  PieceMakerApiError: class extends Error {},
  pmGetCached,
  pmPut,
  invalidatePmGet,
}));

import CaseMappingSection from '@/piecemaker/dossier/sections/CaseMappingSection';
import { normalizeProcedureInfo } from '@/piecemaker/dossier/sections/MappingModel';

const info = normalizeProcedureInfo({ parties_clientes: [{ type: 'personne_physique', nom: 'Alice', position: 'demandeur' }] });
const initialResponse = {
  name: 'mapping_default.json',
  exists: true,
  mapping: { Alice: 'PERSONNE_PHYSIQUE_01' },
  reverse_mapping: { PERSONNE_PHYSIQUE_01: ['Alice'] },
  informations_dossier: info,
};

describe('CaseMappingSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persiste le submit du dialogue global et réaffiche la réponse sauvegardée', async () => {
    pmGetCached.mockResolvedValue(initialResponse);
    pmPut.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({ ...initialResponse, ...body, commit: { created: false } }));

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter ou modifier des informations' }));
    fireEvent.change(screen.getByPlaceholderText('demandeur, défendeur…'), { target: { value: 'appelant' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les parties' }));
    });

    await waitFor(() => expect(pmPut).toHaveBeenCalled());
    expect((pmPut.mock.calls[0][1] as { informations_dossier: { parties_clientes: Array<{ position: string }> } }).informations_dossier.parties_clientes[0].position).toBe('appelant');
    expect(screen.getByText('Partie cliente · Appelant')).toBeTruthy();
  });

  it('persiste le submit du dialogue ciblé et conserve le profil ciblé dans la carte', async () => {
    pmGetCached.mockResolvedValue(initialResponse);
    pmPut.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({ ...initialResponse, ...body, commit: { created: false } }));

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Alice' }));
    fireEvent.change(screen.getByLabelText('Camp'), { target: { value: 'adversaire' } });
    fireEvent.change(screen.getByPlaceholderText('demandeur, défendeur…'), { target: { value: 'appelant' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });

    await waitFor(() => expect(pmPut).toHaveBeenCalled());
    expect((pmPut.mock.calls[0][1] as { informations_dossier: { parties_adverses: Array<{ position: string }> } }).informations_dossier.parties_adverses[0].position).toBe('appelant');
    expect(screen.getByText('Partie adverse · Appelant')).toBeTruthy();
  });

  it('traite AVOCAT_DEFENDEUR_PERSONNE_MORALE_01 comme une personne physique dans la popup ciblée', async () => {
    const lawyerPrincipal = 'AVOCAT_DEFENDEUR_PERSONNE_MORALE_01';
    pmGetCached.mockResolvedValue({
      ...initialResponse,
      mapping: { [lawyerPrincipal]: 'PERSONNE_PHYSIQUE_01' },
      reverse_mapping: { PERSONNE_PHYSIQUE_01: [lawyerPrincipal] },
      informations_dossier: normalizeProcedureInfo(),
    });

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText(lawyerPrincipal)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: `Modifier ${lawyerPrincipal}` }));

    await waitFor(() => expect(screen.getByText('Nom complet — variant principal')).toBeTruthy());
    expect(screen.queryByText('Dénomination — variant principal')).toBeNull();
    expect(screen.getByDisplayValue(lawyerPrincipal)).toBeTruthy();
  });
});
