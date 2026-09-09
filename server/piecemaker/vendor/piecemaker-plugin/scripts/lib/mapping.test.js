const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeMappingDocument } = require('./mapping.cjs');

test('les relations de profils nommées sont normalisées avec un identifiant stable', () => {
  const document = normalizeMappingDocument({
    informations_dossier: {
      parties_clientes: [{ type: 'societe', societe_nom: 'Société Alpha' }],
      parties_adverses: [{ type: 'personne_physique', nom: 'Mme Martin' }],
      relations: [
        { source: 'CLIENT_DEMANDEUR_PERSONNE_MORALE_01', target: 'DIRIGEANT_CLIENT_DEMANDEUR_01', role: 'Dirigeant' },
        { id: 'relation-actionnaire', source: 'CLIENT_DEMANDEUR_PERSONNE_MORALE_01', original_source: ' PERSONNE_MORALE_01 ', target: 'ACTIONNAIRE_01', role: 'Actionnaire' },
      ],
    },
  });

  assert.deepEqual(document.informations_dossier.relations, [
    {
      id: 'relation:CLIENT_DEMANDEUR_PERSONNE_MORALE_01\u0000DIRIGEANT_CLIENT_DEMANDEUR_01\u0000Dirigeant',
      source: 'CLIENT_DEMANDEUR_PERSONNE_MORALE_01',
      original_source: '',
      target: 'DIRIGEANT_CLIENT_DEMANDEUR_01',
      role: 'Dirigeant',
    },
    {
      id: 'relation-actionnaire',
      source: 'CLIENT_DEMANDEUR_PERSONNE_MORALE_01',
      original_source: 'PERSONNE_MORALE_01',
      target: 'ACTIONNAIRE_01',
      role: 'Actionnaire',
    },
  ]);
});

test('les relations invalides ou dupliquées ne persistent pas', () => {
  const document = normalizeMappingDocument({
    informations_dossier: {
      relations: [
        { id: 'same-id', source: 'A', target: 'B', role: 'Avocat' },
        { id: 'same-id', source: 'A', target: 'C', role: 'Actionnaire' },
        { id: 'another-id', source: 'A', target: 'B', role: 'Avocat' },
        { source: 'A', target: 'A', role: 'Dirigeant' },
        { source: 'A', target: 'D', role: '' },
        { source: 'A', target: 'E', role: 'Autre' },
      ],
    },
  });

  assert.deepEqual(document.informations_dossier.relations, [
    { id: 'same-id', source: 'A', original_source: '', target: 'B', role: 'Avocat' },
    { id: 'relation:A\u0000E\u0000Autre', source: 'A', original_source: '', target: 'E', role: 'Autre' },
  ]);
});

test('le pays des sociétés est normalisé avec un repli France', () => {
  const document = normalizeMappingDocument({
    informations_dossier: {
      parties_clientes: [
        { type: 'societe', societe_nom: 'Alpha', pays: ' Belgique ' },
        { type: 'societe', societe_nom: 'Beta' },
      ],
      parties_adverses: [{ type: 'personne_physique', nom: 'Alice', pays: 'Canada' }],
    },
  });

  assert.deepEqual(document.informations_dossier.parties_clientes.map((party) => party.pays), ['Belgique', 'France']);
  assert.equal(document.informations_dossier.parties_adverses[0].pays, '');
});
