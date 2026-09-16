import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function openProfileEditor(name: string) {
  const card = screen.getByText(name).closest('article');
  expect(card).toBeTruthy();
  fireEvent.click(within(card!).getByRole('button', { name: `Options pour ${name}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Modifier' }));
}

describe('CaseMappingSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ajoute une entree au mapping depuis sa rubrique et la persiste', async () => {
    pmGetCached.mockResolvedValue(initialResponse);
    pmPut.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({ ...initialResponse, ...body, commit: { created: false } }));

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Mapping' }));
    const physiques = screen.getByRole('group', { name: 'Personnes physiques' });
    fireEvent.click(within(physiques).getByRole('button', { name: 'Ajouter' }));
    expect(screen.getByDisplayValue('PERSONNE_PHYSIQUE_02')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Variant principal de la ligne 2'), { target: { value: 'Bob' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le mapping' }));
    });

    await waitFor(() => expect(pmPut).toHaveBeenCalled());
    expect((pmPut.mock.calls[0][1] as { mapping: Record<string, string> }).mapping.Bob).toBe('PERSONNE_PHYSIQUE_02');
  });

  it('supprime un article depuis son menu et le retire du mapping sauvegardé', async () => {
    const response = {
      ...initialResponse,
      mapping: { Alice: 'PERSONNE_PHYSIQUE_01', Bob: 'PERSONNE_PHYSIQUE_02' },
      reverse_mapping: { PERSONNE_PHYSIQUE_01: ['Alice'], PERSONNE_PHYSIQUE_02: ['Bob'] },
    };
    pmGetCached.mockResolvedValue(response);
    pmPut.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({ ...response, ...body, commit: { created: false } }));

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    const aliceCard = screen.getByText('Alice').closest('article');
    expect(aliceCard).toBeTruthy();
    fireEvent.click(within(aliceCard!).getByRole('button', { name: 'Options pour Alice' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Supprimer' }));

    expect(screen.queryByText('Alice')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les profils' }));
    });

    await waitFor(() => expect(pmPut).toHaveBeenCalled());
    expect((pmPut.mock.calls[0][1] as { mapping: Record<string, string> }).mapping).toEqual({ Bob: 'PERSONNE_PHYSIQUE_02' });
  });

  it('persiste le submit du dialogue ciblé et conserve le profil ciblé dans la carte', async () => {
    pmGetCached.mockResolvedValue(initialResponse);
    pmPut.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({ ...initialResponse, ...body, commit: { created: false } }));

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    const aliceCard = screen.getByText('Alice').closest('article');
    expect(aliceCard).toBeTruthy();
    fireEvent.click(within(aliceCard!).getByRole('button', { name: 'Options pour Alice' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Modifier' }));
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'adversaire' } });
    fireEvent.change(screen.getByPlaceholderText('demandeur, défendeur…'), { target: { value: 'appelant' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });

    await waitFor(() => expect(pmPut).toHaveBeenCalled());
    expect((pmPut.mock.calls[0][1] as { informations_dossier: { parties_adverses: Array<{ position: string }> } }).informations_dossier.parties_adverses[0].position).toBe('appelant');
    expect(screen.getByText('Partie adverse · Appelant')).toBeTruthy();
  });

  it('retire l’affectation Client ou Adverse quand la position devient Tiers', async () => {
    pmGetCached.mockResolvedValue(initialResponse);
    pmPut.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({ ...initialResponse, ...body, commit: { created: false } }));

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    openProfileEditor('Alice');
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'tiers' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });

    await waitFor(() => expect(pmPut).toHaveBeenCalled());
    const savedBody = pmPut.mock.calls[0][1] as {
      mapping: Record<string, string>;
      informations_dossier: { parties_clientes: unknown[]; parties_adverses: unknown[] };
    };
    const savedInfo = savedBody.informations_dossier;
    expect(savedInfo.parties_clientes).toHaveLength(0);
    expect(savedInfo.parties_adverses).toHaveLength(0);
    expect(savedBody.mapping).toEqual({ Alice: 'PERSONNE_PHYSIQUE_01' });
    expect(screen.getByText('Tiers')).toBeTruthy();
    const tiers = screen.getByText('Tiers').closest('details');
    expect(tiers).toBeTruthy();
    fireEvent.click(screen.getByText('Tiers'));
    expect(within(tiers!).getByText('Alice')).toBeTruthy();
  });

  it('ne modifie pas le mapping si un profil est enregistré comme Tiers', async () => {
    pmGetCached.mockResolvedValue(initialResponse);
    pmPut.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({ ...initialResponse, ...body, commit: { created: false } }));

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    openProfileEditor('Alice');
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'tiers' } });
    fireEvent.change(screen.getByDisplayValue('Alice'), { target: { value: 'Alice modifiée' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });

    await waitFor(() => expect(pmPut).toHaveBeenCalled());
    const body = pmPut.mock.calls[0][1] as { mapping: Record<string, string> };
    expect(body.mapping).toEqual({ Alice: 'PERSONNE_PHYSIQUE_01' });
    expect(body.mapping['Alice modifiée']).toBeUndefined();
    expect(screen.queryByText('Alice modifiée')).toBeNull();
    expect(screen.getByText('Tiers').closest('details')?.hasAttribute('open')).toBe(false);
  });

  it('traite AVOCAT_DEFENDEUR_PERSONNE_MORALE_01 comme une personne physique dans la popup ciblée', async () => {
    const lawyerPrincipal = 'AVOCAT_DEFENDEUR_PERSONNE_MORALE_01';
    pmGetCached.mockResolvedValue({
      ...initialResponse,
      mapping: { [lawyerPrincipal]: 'PERSONNE_PHYSIQUE_01' },
      reverse_mapping: { PERSONNE_PHYSIQUE_01: [lawyerPrincipal] },
      informations_dossier: normalizeProcedureInfo({ parties_clientes: [{ type: 'personne_physique', nom: lawyerPrincipal, position: 'demandeur' }] }),
    });

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText(lawyerPrincipal)).toBeTruthy());
    openProfileEditor(lawyerPrincipal);

    await waitFor(() => expect(screen.getByText('Nom complet — variant principal')).toBeTruthy());
    expect(screen.queryByText('Dénomination — variant principal')).toBeNull();
    expect(screen.getByDisplayValue(lawyerPrincipal)).toBeTruthy();
  });

  it('affiche tous les variants détectés dans la popup ciblée', async () => {
    pmGetCached.mockResolvedValue({
      ...initialResponse,
      mapping: { Alice: 'PERSONNE_PHYSIQUE_01', 'Alice Dupont': 'PERSONNE_PHYSIQUE_01' },
      reverse_mapping: { PERSONNE_PHYSIQUE_01: ['Alice', 'Alice Dupont'] },
      informations_dossier: info,
    });

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    openProfileEditor('Alice');

    expect(screen.getByText('Variants détectés')).toBeTruthy();
    expect(screen.getByText('Alice Dupont')).toBeTruthy();
  });

  it('permet de choisir, ajouter et supprimer un variant dans la popup', async () => {
    pmGetCached.mockResolvedValue({
      ...initialResponse,
      mapping: { Alice: 'CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_02', 'Alice Dupont': 'CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_02' },
      reverse_mapping: { CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_02: ['Alice', 'Alice Dupont'] },
      informations_dossier: info,
    });

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    openProfileEditor('Alice');
    fireEvent.click(screen.getByRole('button', { name: 'Définir Alice Dupont comme variant principal' }));
    expect(screen.getByDisplayValue('Alice Dupont')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Nouveau variant'), { target: { value: 'Alice Martin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(screen.getByText('Alice Martin')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer le variant Alice' }));
    expect(screen.queryByRole('button', { name: 'Supprimer le variant Alice' })).toBeNull();
  });

  it('change le principal vers un variant existant sans créer une seconde carte', async () => {
    const response = {
      ...initialResponse,
      mapping: { Alice: 'PERSONNE_PHYSIQUE_01', 'Alice Dupont': 'PERSONNE_PHYSIQUE_01' },
      reverse_mapping: { PERSONNE_PHYSIQUE_01: ['Alice', 'Alice Dupont'] },
      informations_dossier: normalizeProcedureInfo({
        parties_clientes: [{
          type: 'personne_physique',
          nom: 'Alice',
          position: 'demandeur',
          mapping_assignments: [{
            field: 'identite',
            code: 'PERSONNE_PHYSIQUE_01',
            original_code: 'PERSONNE_PHYSIQUE_01',
            category: 'personnes_physiques',
            principal: 'Alice',
            variants: ['Alice', 'Alice Dupont'],
          }],
        }],
      }),
    };
    pmGetCached.mockResolvedValue(response);
    pmPut.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({ ...response, ...body, commit: { created: false } }));

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    openProfileEditor('Alice');
    fireEvent.change(screen.getByDisplayValue('Alice'), { target: { value: 'Alice Dupont' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });

    await waitFor(() => expect(pmPut).toHaveBeenCalled());
    const body = pmPut.mock.calls[0][1] as { mapping: Record<string, string> };
    expect(Object.keys(body.mapping).sort()).toEqual(['Alice', 'Alice Dupont']);
    expect(new Set(Object.values(body.mapping)).size).toBe(1);
    expect(screen.getByText('Alice Dupont')).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('conserve un lien glissé après son enregistrement', async () => {
    const relationResponse = {
      name: 'mapping_default.json',
      exists: true,
      mapping: { Alice: 'PERSONNE_PHYSIQUE_01', Bob: 'PERSONNE_PHYSIQUE_02' },
      reverse_mapping: { PERSONNE_PHYSIQUE_01: ['Alice'], PERSONNE_PHYSIQUE_02: ['Bob'] },
      informations_dossier: normalizeProcedureInfo({
        parties_clientes: [{ type: 'personne_physique', nom: 'Alice', position: 'demandeur' }],
        parties_adverses: [{ type: 'personne_physique', nom: 'Bob', position: 'defendeur' }],
      }),
    };
    pmGetCached.mockResolvedValue(relationResponse);
    pmPut.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({ ...relationResponse, ...body, commit: { created: false } }));

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());

    const aliceCard = screen.getByText('Alice').closest('article');
    const bobCard = screen.getByText('Bob').closest('article');
    expect(aliceCard).toBeTruthy();
    expect(bobCard).toBeTruthy();
    const updatedAliceCard = screen.getByText('Alice').closest('article');
    const updatedBobCard = screen.getByText('Bob').closest('article');
    expect(updatedAliceCard).toBeTruthy();
    expect(updatedBobCard).toBeTruthy();
    fireEvent.dragStart(updatedAliceCard!, { dataTransfer: { effectAllowed: '', setData: vi.fn(), getData: vi.fn(() => 'PERSONNE_PHYSIQUE_01') } });
    const bobDropZone = updatedBobCard!.querySelector('[class*="border-dashed"]');
    expect(bobDropZone).toBeTruthy();
    fireEvent.drop(bobDropZone!, { dataTransfer: { getData: vi.fn(() => 'PERSONNE_PHYSIQUE_01') } });
    fireEvent.change(screen.getByLabelText('Lien avec Alice'), { target: { value: 'Dirigeant' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les profils' }));
    });

    await waitFor(() => expect(pmPut).toHaveBeenCalled());
    expect((pmPut.mock.calls[0][1] as { informations_dossier: { relations: Array<{ source: string; target: string; role: string }> } }).informations_dossier.relations).toEqual([
      { id: 'relation:PERSONNE_PHYSIQUE_01\u0000PERSONNE_PHYSIQUE_02\u0000', source: 'CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01', original_source: '', target: 'ADVERSAIRE_DEFENDEUR_PERSONNE_PHYSIQUE_01', role: 'Dirigeant' },
    ]);
    expect(screen.getAllByText('Alice').length).toBe(2);
    expect(screen.getByText('Profil lié')).toBeTruthy();
  });

  it('ré-ancre les liens historiques sur les codes courants au rechargement', async () => {
    pmGetCached.mockResolvedValue({
      name: 'mapping_default.json',
      exists: true,
      mapping: {
        Alice: 'CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01',
        Bob: 'ADVERSAIRE_DEFENDEUR_PERSONNE_PHYSIQUE_01',
      },
      reverse_mapping: {
        CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01: ['Alice'],
        ADVERSAIRE_DEFENDEUR_PERSONNE_PHYSIQUE_01: ['Bob'],
      },
      informations_dossier: normalizeProcedureInfo({
        parties_clientes: [{
          type: 'personne_physique',
          nom: 'Alice',
          mapping_assignments: [{
            field: 'identite',
            code: 'CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01',
            original_code: 'PERSONNE_PHYSIQUE_01',
            category: 'personnes_physiques',
            principal: 'Alice',
            variants: ['Alice'],
          }],
        }],
        parties_adverses: [{
          type: 'personne_physique',
          nom: 'Bob',
          mapping_assignments: [{
            field: 'identite',
            code: 'ADVERSAIRE_DEFENDEUR_PERSONNE_PHYSIQUE_01',
            original_code: 'PERSONNE_PHYSIQUE_02',
            category: 'personnes_physiques',
            principal: 'Bob',
            variants: ['Bob'],
          }],
        }],
        relations: [{ source: 'PERSONNE_PHYSIQUE_01', target: 'PERSONNE_PHYSIQUE_02', role: 'Dirigeant' }],
      }),
    });

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getAllByText('Alice').length).toBeGreaterThan(0));
    expect(screen.getByText('Profil lié')).toBeTruthy();
    expect((screen.getByLabelText('Lien avec Alice') as HTMLSelectElement).value).toBe('Dirigeant');
  });

  it('classe chaque entree du mapping dans sa rubrique et montre sa cle', async () => {
    pmGetCached.mockResolvedValue({
      ...initialResponse,
      mapping: {
        Alice: 'PERSONNE_PHYSIQUE_01',
        Acme: 'PERSONNE_MORALE_01',
        '12 rue des Lilas': 'ADRESSE_01',
        'contact@acme.fr': 'EMAIL_01',
        '0612345678': 'PHONE_01',
        'FR7630006000011234567890189': 'IBAN_01',
        'https://acme.fr': 'URL_01',
        '552100554': 'SIREN_01',
      },
      reverse_mapping: {
        PERSONNE_PHYSIQUE_01: ['Alice'],
        PERSONNE_MORALE_01: ['Acme'],
        ADRESSE_01: ['12 rue des Lilas'],
        EMAIL_01: ['contact@acme.fr'],
        PHONE_01: ['0612345678'],
        IBAN_01: ['FR7630006000011234567890189'],
        URL_01: ['https://acme.fr'],
        SIREN_01: ['552100554'],
      },
    });

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mapping' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Mapping' }));

    const rubrique = (label: string) => screen.getByRole('group', { name: label });
    expect(within(rubrique('Personnes physiques')).getByDisplayValue('PERSONNE_PHYSIQUE_01')).toBeTruthy();
    expect(within(rubrique('Personnes physiques')).getByDisplayValue('Alice')).toBeTruthy();
    expect(within(rubrique('Personnes morales')).getByDisplayValue('Acme')).toBeTruthy();
    expect(within(rubrique('Adresses')).getByDisplayValue('12 rue des Lilas')).toBeTruthy();
    expect(within(rubrique('Adresses e-mail')).getByDisplayValue('contact@acme.fr')).toBeTruthy();
    expect(within(rubrique('Téléphones')).getByDisplayValue('0612345678')).toBeTruthy();
    expect(within(rubrique('IBAN')).getByDisplayValue('FR7630006000011234567890189')).toBeTruthy();
    expect(within(rubrique('URL')).getByDisplayValue('https://acme.fr')).toBeTruthy();
    expect(within(rubrique('SIREN')).getByDisplayValue('552100554')).toBeTruthy();
  });

  it('range les parties clientes a gauche et les parties adverses a droite', async () => {
    pmGetCached.mockResolvedValue({
      ...initialResponse,
      mapping: { Alice: 'PERSONNE_PHYSIQUE_01', Bob: 'PERSONNE_PHYSIQUE_02' },
      reverse_mapping: { PERSONNE_PHYSIQUE_01: ['Alice'], PERSONNE_PHYSIQUE_02: ['Bob'] },
      informations_dossier: normalizeProcedureInfo({
        parties_clientes: [{ type: 'personne_physique', nom: 'Alice', position: 'demandeur' }],
        parties_adverses: [{ type: 'personne_physique', nom: 'Bob', position: 'defendeur' }],
      }),
    });

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());

    const clientes = screen.getByRole('region', { name: 'Parties clientes' });
    const adverses = screen.getByRole('region', { name: 'Parties adverses' });
    expect(within(clientes).getByText('Alice')).toBeTruthy();
    expect(within(clientes).queryByText('Bob')).toBeNull();
    expect(within(adverses).getByText('Bob')).toBeTruthy();
  });

  it('n affiche aucune carte pour un mapping qui ne contient pas de personne', async () => {
    pmGetCached.mockResolvedValue({
      ...initialResponse,
      mapping: { '12 rue des Lilas': 'ADRESSE_01' },
      reverse_mapping: { ADRESSE_01: ['12 rue des Lilas'] },
      informations_dossier: normalizeProcedureInfo(),
    });

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText('Aucune partie désignée')).toBeTruthy());
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.queryByText('12 rue des Lilas')).toBeNull();
  });

  it('regroupe les personnes physiques et morales non affectees dans l accordéon Tiers', async () => {
    pmGetCached.mockResolvedValue({
      ...initialResponse,
      mapping: {
        Alice: 'PERSONNE_PHYSIQUE_01',
        Acme: 'PERSONNE_MORALE_01',
        '12 rue des Lilas': 'ADRESSE_01',
      },
      reverse_mapping: {
        PERSONNE_PHYSIQUE_01: ['Alice'],
        PERSONNE_MORALE_01: ['Acme'],
        ADRESSE_01: ['12 rue des Lilas'],
      },
      informations_dossier: normalizeProcedureInfo({
        parties_clientes: [{ type: 'personne_physique', nom: 'Client', position: 'demandeur' }],
        parties_adverses: [{ type: 'personne_physique', nom: 'Adversaire', position: 'defendeur' }],
      }),
    });

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByText('Tiers')).toBeTruthy());

    const tiers = screen.getByText('Tiers').closest('details');
    expect(tiers).toBeTruthy();
    expect(tiers?.hasAttribute('open')).toBe(false);
    fireEvent.click(screen.getByText('Tiers'));
    expect(within(tiers!).getByText('Alice')).toBeTruthy();
    expect(within(tiers!).getByText('Acme')).toBeTruthy();
    expect(within(tiers!).queryByText('12 rue des Lilas')).toBeNull();
  });

  it('classe chaque rubrique par ordre alphabetique du variant principal', async () => {
    pmGetCached.mockResolvedValue({
      ...initialResponse,
      mapping: { Zoe: 'PERSONNE_PHYSIQUE_03', Alice: 'PERSONNE_PHYSIQUE_01', Marc: 'PERSONNE_PHYSIQUE_02' },
      reverse_mapping: { PERSONNE_PHYSIQUE_01: ['Alice'], PERSONNE_PHYSIQUE_03: ['Zoe'], PERSONNE_PHYSIQUE_02: ['Marc'] },
    });

    render(<CaseMappingSection caseId="case-1" refreshVersion={0} onRepositoryChange={async () => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mapping' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Mapping' }));

    const rubrique = screen.getByRole('group', { name: 'Personnes physiques' });
    const principaux = within(rubrique)
      .getAllByLabelText(/^Variant principal de la ligne/)
      .map((field) => (field as HTMLInputElement).value);
    expect(principaux).toEqual(['Alice', 'Marc', 'Zoe']);
  });
});
