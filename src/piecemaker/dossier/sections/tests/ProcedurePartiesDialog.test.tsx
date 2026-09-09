import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { normalizeProcedureInfo } from '@/piecemaker/dossier/sections/MappingModel';
import ProcedurePartiesDialog from '@/piecemaker/dossier/sections/ProcedurePartiesDialog';
import ProcedurePartyProfileDialog from '@/piecemaker/dossier/sections/ProcedurePartyProfileDialog';
import { procedurePositionPatch } from '@/piecemaker/dossier/sections/procedurePartyPosition';

const mapping = { mapping: {}, reverse_mapping: {} };

describe('ProcedurePartiesDialog', () => {
  it('transmet les modifications globales à onSave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const initialInfo = normalizeProcedureInfo({ parties_clientes: [{ type: 'personne_physique', nom: 'Alice' }] });

    render(<ProcedurePartiesDialog open mapping={mapping} initialInfo={initialInfo} saving={false} onOpenChange={() => {}} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Nom complet — variant principal'), { target: { value: 'Alice Martin' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les parties' }));
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      parties_clientes: [expect.objectContaining({ nom: 'Alice Martin' })],
    })));
  });

  it('transmet les modifications ciblées à onSave sans toucher à la fermeture', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const initialParty = normalizeProcedureInfo({ parties_clientes: [{ type: 'personne_physique', nom: 'Alice' }] }).parties_clientes[0];

    render(<ProcedurePartyProfileDialog
      open
      mapping={mapping}
      group={{ code: 'PERSONNE_PHYSIQUE_01', principal: 'Alice', variants: [] }}
      initialParty={initialParty}
      initialSide="client"
      saving={false}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />);
    fireEvent.change(screen.getByLabelText('Nom complet — variant principal'), { target: { value: 'Alice Martin' } });
    fireEvent.change(screen.getByLabelText('Camp'), { target: { value: 'adversaire' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('adversaire', expect.objectContaining({ nom: 'Alice Martin' })));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('garde les exemples de société dans le placeholder et affiche une position personnalisée comme valeur', () => {
    const initialParty = normalizeProcedureInfo({ parties_clientes: [{ type: 'societe', societe_nom: 'Alpha', position: 'autre', position_libelle: 'Créancier poursuivant' }] }).parties_clientes[0];

    render(<ProcedurePartyProfileDialog
      open
      mapping={mapping}
      group={{ code: 'PERSONNE_MORALE_01', principal: 'Alpha', variants: [] }}
      initialParty={initialParty}
      initialSide="client"
      saving={false}
      onOpenChange={() => {}}
      onSave={vi.fn().mockResolvedValue(undefined)}
    />);

    expect((screen.getByPlaceholderText('SAS, GmbH, Ltd…') as HTMLInputElement).value).toBe('');
    expect(screen.getByPlaceholderText('SAS, GmbH, Ltd…').className).toContain('text-foreground');
    expect((screen.getByPlaceholderText('demandeur, défendeur…') as HTMLInputElement).value).toBe('Créancier poursuivant');
  });

  it('convertit la saisie de position standard ou libre vers le modèle', () => {
    expect(procedurePositionPatch('Demandeur')).toEqual({ position: 'demandeur', position_libelle: '' });
    expect(procedurePositionPatch('Créancier poursuivant')).toEqual({ position: 'autre', position_libelle: 'Créancier poursuivant' });
  });

  it('conserve les espaces d’une position libre pendant la saisie et au submit', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const initialParty = normalizeProcedureInfo({ parties_clientes: [{ type: 'personne_physique', nom: 'Alice' }] }).parties_clientes[0];

    render(<ProcedurePartyProfileDialog
      open
      mapping={mapping}
      group={{ code: 'PERSONNE_PHYSIQUE_01', principal: 'Alice', variants: [] }}
      initialParty={initialParty}
      initialSide="client"
      saving={false}
      onOpenChange={() => {}}
      onSave={onSave}
    />);
    const position = screen.getByPlaceholderText('demandeur, défendeur…') as HTMLInputElement;
    fireEvent.change(position, { target: { value: 'Créancier poursuivant' } });
    expect(position.value).toBe('Créancier poursuivant');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('client', expect.objectContaining({ position: 'autre', position_libelle: 'Créancier poursuivant' })));
  });
});
