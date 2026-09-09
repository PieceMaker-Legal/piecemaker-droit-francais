import { describe, expect, it } from 'vitest';

import {
  MappingValidationError,
  applyProcedureParties,
  buildMappingDocument,
  findProcedurePartyForProfile,
  groupMappingByCode,
  lawyerRelationshipPseudonym,
  normalizeProcedureInfo,
  principalPartyOptions,
  profileRelationshipId,
  procedureSummary,
  sortMappingGroupsByProcedureParty,
  updateProcedurePartyForProfile,
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
      parties_adverses: [{ type: 'societe', position: 'defendeur', societe_nom: 'Société Alpha', forme_sociale: 'SAS', pays: 'France', siren: '123 456 789' }],
    });
    expect(assigned.mapping['Claire Reynaud']).toBe('CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01');
    expect(assigned.mapping['Mme Reynaud']).toBe('CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01');
    expect(assigned.mapping['Société Alpha']).toBe('ADVERSAIRE_DEFENDEUR_SAS_01');
    expect(assigned.mapping['123 456 789']).toBe('SIREN_ADVERSAIRE_DEFENDEUR_01');
    expect(assigned.informations_dossier.parties_adverses[0].pays).toBe('France');
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

  it('conserve le pays des sociétés et utilise une forme juridique libre dans le pseudonyme', () => {
    const assigned = applyProcedureParties({ mapping: { Alpha: 'PERSONNE_MORALE_01' }, reverse_mapping: { PERSONNE_MORALE_01: ['Alpha'] } }, {}, {
      parties_clientes: [{ type: 'societe', position: 'demandeur', societe_nom: 'Alpha', forme_sociale: 'Mutuelle', pays: ' Belgique ' }],
      parties_adverses: [],
    });
    expect(assigned.mapping.Alpha).toBe('CLIENT_DEMANDEUR_MUTUELLE_01');
    expect(assigned.informations_dossier.parties_clientes[0].pays).toBe('Belgique');
    expect(principalPartyOptions(assigned.mapping, assigned.reverse_mapping, 'societe')).toEqual([
      { code: 'CLIENT_DEMANDEUR_MUTUELLE_01', principal: 'Alpha' },
    ]);
  });

  it('garde le code historique et le pays par défaut des sociétés anciennes', () => {
    const assigned = applyProcedureParties({ mapping: { Alpha: 'PERSONNE_MORALE_01' }, reverse_mapping: { PERSONNE_MORALE_01: ['Alpha'] } }, {}, {
      parties_clientes: [{ type: 'societe', position: 'demandeur', societe_nom: 'Alpha' }],
      parties_adverses: [],
    });
    expect(assigned.mapping.Alpha).toBe('CLIENT_DEMANDEUR_PERSONNE_MORALE_01');
    expect(assigned.informations_dossier.parties_clientes[0].pays).toBe('France');
    expect(normalizeProcedureInfo({ parties_clientes: [{ type: 'personne_physique', pays: 'Belgique' }] }).parties_clientes[0].pays).toBe('');
  });

  it('recoder un avocat selon la position et la forme de la société représentée', () => {
    const source = {
      mapping: { Alpha: 'PERSONNE_MORALE_01', Alice: 'PERSONNE_PHYSIQUE_01' },
      reverse_mapping: { PERSONNE_MORALE_01: ['Alpha'], PERSONNE_PHYSIQUE_01: ['Alice'] },
    };
    const relationship = { id: 'relation-avocat', source: 'PERSONNE_PHYSIQUE_01', target: 'PERSONNE_MORALE_01', role: 'Avocat' };
    const info = normalizeProcedureInfo({
      parties_clientes: [{ type: 'societe', position: 'demandeur', societe_nom: 'Alpha', forme_sociale: 'SA' }],
    });
    expect(lawyerRelationshipPseudonym(relationship, source, info.parties_clientes)).toBe('AVOCAT_DEMANDEUR_SA_01');
    const first = applyProcedureParties(source, {}, {
      parties_clientes: [{ type: 'societe', position: 'demandeur', societe_nom: 'Alpha', forme_sociale: 'SA' }],
      parties_adverses: [],
      relations: [relationship],
    });
    expect(first.mapping.Alpha).toBe('CLIENT_DEMANDEUR_SA_01');
    expect(first.mapping.Alice).toBe('AVOCAT_DEMANDEUR_SA_01');
    expect(first.informations_dossier.relations).toEqual([
      { id: 'relation-avocat', source: 'AVOCAT_DEMANDEUR_SA_01', original_source: 'PERSONNE_PHYSIQUE_01', target: 'CLIENT_DEMANDEUR_SA_01', role: 'Avocat' },
    ]);

    const second = applyProcedureParties(first, first.informations_dossier, {
      parties_clientes: [{ type: 'societe', position: 'appelant', societe_nom: 'Alpha', forme_sociale: 'SARL' }],
      parties_adverses: [],
      relations: first.informations_dossier.relations,
    });
    expect(second.mapping.Alpha).toBe('CLIENT_APPELANT_SARL_01');
    expect(second.mapping.Alice).toBe('AVOCAT_APPELANT_SARL_01');
    expect(second.informations_dossier.relations).toEqual([
      { id: 'relation-avocat', source: 'AVOCAT_APPELANT_SARL_01', original_source: 'PERSONNE_PHYSIQUE_01', target: 'CLIENT_APPELANT_SARL_01', role: 'Avocat' },
    ]);

    const reclassified = applyProcedureParties(second, second.informations_dossier, {
      parties_clientes: [{ type: 'societe', position: 'appelant', societe_nom: 'Alpha', forme_sociale: 'SARL' }],
      parties_adverses: [],
      relations: [{ ...second.informations_dossier.relations[0], role: 'Actionnaire' }],
    });
    expect(reclassified.mapping.Alice).toBe('PERSONNE_PHYSIQUE_01');
    expect(reclassified.informations_dossier.relations).toEqual([
      { id: 'relation-avocat', source: 'PERSONNE_PHYSIQUE_01', original_source: '', target: 'CLIENT_APPELANT_SARL_01', role: 'Actionnaire' },
    ]);

    const deleted = applyProcedureParties(first, first.informations_dossier, {
      parties_clientes: [{ type: 'societe', position: 'demandeur', societe_nom: 'Alpha', forme_sociale: 'SA' }],
      parties_adverses: [],
      relations: [],
    });
    expect(deleted.mapping.Alice).toBe('PERSONNE_PHYSIQUE_01');
    expect(deleted.informations_dossier.relations).toEqual([]);

    const collision = applyProcedureParties({
      mapping: { ...first.mapping, Bob: 'PERSONNE_PHYSIQUE_01' },
      reverse_mapping: { ...first.reverse_mapping, PERSONNE_PHYSIQUE_01: ['Bob'] },
    }, first.informations_dossier, {
      parties_clientes: [{ type: 'societe', position: 'demandeur', societe_nom: 'Alpha', forme_sociale: 'SA' }],
      parties_adverses: [],
      relations: first.informations_dossier.relations,
    });
    expect(collision.mapping.Bob).toBe('PERSONNE_PHYSIQUE_01');
    expect(collision.mapping.Alice).toBe('AVOCAT_DEMANDEUR_SA_01');
    expect(collision.informations_dossier.relations).toEqual([
      { id: 'relation-avocat', source: 'AVOCAT_DEMANDEUR_SA_01', original_source: 'PERSONNE_PHYSIQUE_02', target: 'CLIENT_DEMANDEUR_SA_01', role: 'Avocat' },
    ]);
  });

  it('résume les parties sans leurs autres données', () => {
    expect(procedureSummary({
      parties_clientes: [{ type: 'personne_physique', civilite: 'Mme', nom: 'Claire Reynaud', adresse: 'Secret' }],
      parties_adverses: [{ type: 'societe', forme_sociale: 'SARL', societe_nom: 'Alpha', siren: '123456789' }],
    })).toEqual({ client: ['Mme Claire Reynaud'], adverse: ['SARL Alpha'] });
  });

  it('place les profils assignés avant les profils non assignés puis les trie en français', () => {
    const groups = [
      { code: 'A', principal: 'zèbre', variants: [] },
      { code: 'B', principal: 'Émile', variants: [] },
      { code: 'C', principal: 'alice', variants: [] },
      { code: 'D', principal: 'Ànna', variants: [] },
    ];
    const info = normalizeProcedureInfo({ parties_clientes: [{ type: 'personne_physique', nom: 'Émile' }] });
    expect(sortMappingGroupsByProcedureParty(groups, info).map((group) => group.principal)).toEqual(['Émile', 'alice', 'Ànna', 'zèbre']);
  });

  it('transforme uniquement le profil ciblé lors d’un changement de camp et de position', () => {
    const info = normalizeProcedureInfo({
      parties_clientes: [{ type: 'personne_physique', nom: 'Alice', position: 'demandeur' }],
      parties_adverses: [{ type: 'societe', societe_nom: 'Alpha', position: 'defendeur', forme_sociale: 'SAS' }],
      relations: [{ id: 'relation-alpha', source: 'A', target: 'B', role: 'Dirigeant' }],
    });
    const next = updateProcedurePartyForProfile(info, { code: 'A', principal: 'Alice', variants: [] }, 'adversaire', {
      ...info.parties_clientes[0],
      position: 'autre',
      position_libelle: 'Créancier poursuivant',
    });
    expect(findProcedurePartyForProfile(next, { code: 'A', principal: 'Alice', variants: [] })).toMatchObject({ side: 'adversaire', party: { position: 'autre', position_libelle: 'Créancier poursuivant' } });
    expect(next.parties_clientes).toEqual([]);
    expect(next.parties_adverses.map((party) => party.societe_nom || party.nom)).toEqual(['Alpha', 'Alice']);
    expect(next.relations).toEqual(info.relations);
  });

  it('normalise les liens de profils avec un identifiant stable', () => {
    const stableId = profileRelationshipId('PERSONNE_MORALE_01', 'PERSONNE_PHYSIQUE_01', 'Dirigeant');
    expect(normalizeProcedureInfo({
      relations: [
        { source: ' PERSONNE_MORALE_01 ', target: ' PERSONNE_PHYSIQUE_01 ', role: ' Dirigeant ' },
        { id: 'relation-actionnaire', source: 'PERSONNE_MORALE_01', target: 'PERSONNE_PHYSIQUE_02', role: 'Actionnaire' },
        { id: 'relation-actionnaire', source: 'PERSONNE_MORALE_02', target: 'PERSONNE_PHYSIQUE_02', role: 'Avocat' },
        { source: 'PERSONNE_MORALE_01', target: 'PERSONNE_PHYSIQUE_01', role: 'Dirigeant' },
        { source: 'PERSONNE_MORALE_01', target: 'PERSONNE_MORALE_01', role: 'Dirigeant' },
        { source: 'PERSONNE_MORALE_01', target: 'PERSONNE_PHYSIQUE_03', role: ' ' },
      ],
    }).relations).toEqual([
      { id: stableId, source: 'PERSONNE_MORALE_01', original_source: '', target: 'PERSONNE_PHYSIQUE_01', role: 'Dirigeant' },
      { id: 'relation-actionnaire', source: 'PERSONNE_MORALE_01', original_source: '', target: 'PERSONNE_PHYSIQUE_02', role: 'Actionnaire' },
    ]);
  });

  it('conserve les relations nommées lors de l’attribution des parties', () => {
    const assigned = applyProcedureParties({ mapping: { Alice: 'PERSONNE_PHYSIQUE_01' }, reverse_mapping: { PERSONNE_PHYSIQUE_01: ['Alice'] } }, {}, {
      parties_clientes: [{ type: 'personne_physique', position: 'demandeur', nom: 'Alice' }],
      parties_adverses: [],
      relations: [{ id: 'relation-conseil', source: 'PERSONNE_PHYSIQUE_01', target: 'PERSONNE_PHYSIQUE_02', role: 'Avocat' }],
    });
    expect(assigned.informations_dossier.relations).toEqual([
      { id: 'relation-conseil', source: 'CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01', original_source: '', target: 'PERSONNE_PHYSIQUE_02', role: 'Avocat' },
    ]);
    const reassigned = applyProcedureParties(assigned, assigned.informations_dossier, {
      parties_clientes: [{ type: 'personne_physique', position: 'appelant', nom: 'Alice' }],
      parties_adverses: [],
      relations: assigned.informations_dossier.relations,
    });
    expect(reassigned.informations_dossier.relations).toEqual([
      { id: 'relation-conseil', source: 'CLIENT_APPELANT_PERSONNE_PHYSIQUE_01', original_source: '', target: 'PERSONNE_PHYSIQUE_02', role: 'Avocat' },
    ]);
  });
});
