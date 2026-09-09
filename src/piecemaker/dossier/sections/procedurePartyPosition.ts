import {
  PROCEDURE_POSITIONS,
  type ProcedureParty,
} from '@/piecemaker/dossier/sections/MappingModel';

export function procedurePositionFieldValue(party: ProcedureParty): string {
  return party.position === 'autre' ? party.position_libelle : party.position;
}

export function procedurePositionPatch(value: string): Pick<ProcedureParty, 'position' | 'position_libelle'> {
  const trimmed = value.trim();
  const standard = PROCEDURE_POSITIONS.find((position) => position.value !== 'autre' && (
    position.value === trimmed || position.label.toLocaleLowerCase('fr') === trimmed.toLocaleLowerCase('fr')
  ));
  return standard
    ? { position: standard.value, position_libelle: '' }
    : { position: 'autre', position_libelle: value };
}
