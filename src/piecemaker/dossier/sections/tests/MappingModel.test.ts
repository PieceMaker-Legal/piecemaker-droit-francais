import { describe, expect, it } from 'vitest';

import {
  MappingValidationError,
  applyProcedureParties,
  buildMappingDocument,
  groupMappingByCode,
  principalPartyOptions,
  procedureSummary,
} from '@/piecemaker/dossier/sections/MappingModel';

describe('MappingModel', () => {
  it('regroupe le mapping plat par nom anonymisé', () => {
    expect(groupMappingByCode({
      'M. Gilly': 'PERSONNE_PHYSIQUE_01',
      'Bernard Gilly': 'PERSONNE_PHYSIQUE_01',
      'Société Alpha': 'PERSONNE_MORALE_01',
    }, {
      PERSONNE_PHYSIQUE_01: ['Bernard Gilly', 'M. Gilly'],
      PERSONNE_MORALE_01: ['Société Alpha'],
    })).toEqual([
      { code: 'PERSONNE_PHYSIQUE_01', principal: 'Bernard Gilly', variants: ['M. Gilly'] },
      { code: 'PERSONNE_MORALE_01', principal: 'Société Alpha', variants: [] },
    ]);
  });

  it('conserve le premier reverse mapping comme variant principal', () => {
    const source = {
      mapping: { 'M. Gilly': 'PERSONNE_PHYSIQUE_01', 'Bernard Gilly': 'PERSONNE_PHYSIQUE_01' },
      reverse_mapping: { PERSONNE_PHYSIQUE_01: ['Bernard Gilly', 'M. Gilly'] },
    };
    expect(buildMappingDocument(groupMappingByCode(source.mapping, source.reverse_mapping))).toEqual(source);
  });

  it('refuse un variant affecté à deux codes', () => {
    expect(() => buildMappingDocument([
      { code: 'PERSONNE_PHYSIQUE_01', principal: 'Bernard Gilly', variants: ['M. Gilly'] },
      { code: 'PERSONNE_PHYSIQUE_02', principal: 'Claire Gilly', variants: ['M. Gilly'] },
    ])).toThrow(MappingValidationError);
  });

  it('attribue les rôles et les détails sensibles des parties', () => {
    const source = {
      mapping: {
        'Claire Reynaud': 'PERSONNE_PHYSIQUE_01',
        'Mme Reynaud': 'PERSONNE_PHYSIQUE_01',
        'Société Alpha': 'PERSONNE_MORALE_01',
        '123 456 789': 'SIREN_01',
      },
      reverse_mapping: {
        PERSONNE_PHYSIQUE_01: ['Claire Reynaud', 'Mme Reynaud'],
        PERSONNE_MORALE_01: ['Société Alpha'],
        SIREN_01: ['123 456 789'],
      },
    };
    const assigned = applyProcedureParties(source, {}, {
      parties_clientes: [{ type: 'personne_physique', position: 'demandeur', civilite: 'Mme', nom: 'Claire Reynaud' }],
      parties_adverses: [{ type: 'societe', position: 'defendeur', societe_nom: 'Société Alpha', forme_sociale: 'SAS', siren: '123 456 789' }],
    });
    expect(assigned.mapping['Claire Reynaud']).toBe('CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01');
    expect(assigned.mapping['Mme Reynaud']).toBe('CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01');
    expect(assigned.mapping['Société Alpha']).toBe('ADVERSAIRE_DEFENDEUR_PERSONNE_MORALE_01');
    expect(assigned.mapping['123 456 789']).toBe('SIREN_ADVERSAIRE_DEFENDEUR_01');
  });

  it('rend une identité manuelle rééditable sans la dupliquer', () => {
    const first = applyProcedureParties({ mapping: {}, reverse_mapping: {} }, {}, {
      parties_clientes: [{ type: 'personne_physique', position: 'appelant', nom: 'Alice Martin' }],
      parties_adverses: [],
    });
    const second = applyProcedureParties(first, first.informations_dossier, {
      parties_clientes: [{ type: 'personne_physique', position: 'intime', nom: 'Alice Martin' }],
      parties_adverses: [],
    });
    expect(second.mapping['Alice Martin']).toBe('CLIENT_INTIME_PERSONNE_PHYSIQUE_01');
    expect(Object.keys(second.mapping)).toHaveLength(1);
  });

  it('propose les variants principaux selon la nature de partie', () => {
    const mapping = { 'Claire Reynaud': 'PERSONNE_PHYSIQUE_01', Alpha: 'PERSONNE_MORALE_01', Beta: 'SA_1', Paris: 'ADRESSE_01' };
    const reverse = { PERSONNE_PHYSIQUE_01: ['Claire Reynaud'], PERSONNE_MORALE_01: ['Alpha'], SA_1: ['Beta'], ADRESSE_01: ['Paris'] };
    expect(principalPartyOptions(mapping, reverse, 'personne_physique')).toEqual([{ code: 'PERSONNE_PHYSIQUE_01', principal: 'Claire Reynaud' }]);
    expect(principalPartyOptions(mapping, reverse, 'societe')).toEqual([{ code: 'PERSONNE_MORALE_01', principal: 'Alpha' }, { code: 'SA_1', principal: 'Beta' }]);
  });

  it('résume les parties sans leurs autres données', () => {
    expect(procedureSummary({
      parties_clientes: [{ type: 'personne_physique', civilite: 'Mme', nom: 'Claire Reynaud', adresse: 'Secret' }],
      parties_adverses: [{ type: 'societe', forme_sociale: 'SARL', societe_nom: 'Alpha', siren: '123456789' }],
    })).toEqual({ client: ['Mme Claire Reynaud'], adverse: ['SARL Alpha'] });
  });
});
