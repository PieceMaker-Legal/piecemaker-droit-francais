import type { ProcedureParty } from '@/piecemaker/dossier/sections/MappingModel';

function isFrenchCountry(country: string): boolean {
  return ['france', 'français', 'francaise', 'française'].includes(country.trim().toLocaleLowerCase('fr'));
}

export function validateProcedureParty(party: ProcedureParty): string | null {
  const identity = party.type === 'societe' ? party.societe_nom.trim() : party.nom.trim();
  if (!identity) return 'Chaque partie ajoutée doit avoir un nom ou une dénomination.';
  if (party.position === 'autre' && !party.position_libelle.trim()) return 'Précisez la position procédurale personnalisée.';
  if (party.type === 'societe' && isFrenchCountry(party.pays) && party.siren && party.siren.replace(/\D/g, '').length !== 9) return 'Le SIREN doit contenir exactement 9 chiffres.';
  return null;
}
