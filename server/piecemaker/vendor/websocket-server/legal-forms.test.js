const assert = require('node:assert/strict');
const test = require('node:test');
const { isSocieteCode } = require('./legal-forms.cjs');

test('reconnaît les codes procéduraux de formes juridiques libres', () => {
  assert.equal(isSocieteCode('CLIENT_DEMANDEUR_SARL_01'), true);
  assert.equal(isSocieteCode('ADVERSAIRE_DEFENDEUR_MUTUELLE_01'), true);
  assert.equal(isSocieteCode('AVOCAT_DEMANDEUR_SA_01'), false);
  assert.equal(isSocieteCode('CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01'), false);
});
