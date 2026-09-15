const test = require('node:test');
const assert = require('node:assert');

const { groupEntityHits } = require('./originals-pipeline.cjs');

const hits = (...texts) => texts.map((text) => ({ text }));
const grouped = (category, ...texts) => groupEntityHits(hits(...texts), category).map((group) => [...group].sort());

test('societes : deux ecritures d une meme personne morale forment un seul groupe', () => {
  const groups = grouped('societes', 'Acme SAS', 'Acme', 'Acme S.A.S.');
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].length, 3);
});

test('societes : deux formes sociales differentes restent deux entites', () => {
  const groups = grouped('societes', 'Acme SA', 'Acme SARL');
  assert.strictEqual(groups.length, 2);
});

test('societes : deux raisons sociales distinctes restent deux entites', () => {
  const groups = grouped('societes', 'Acme SAS', 'Acme Diffusion SAS');
  assert.strictEqual(groups.length, 2);
});

test('personnes_physiques : une civilite produit la variante avec et la variante sans', () => {
  const groups = grouped('personnes_physiques', 'Mr Martin');
  assert.deepStrictEqual(groups, [['Martin', 'Mr Martin']]);
});

test('personnes_physiques : la variante nue rejoint le groupe de la civilite', () => {
  const groups = grouped('personnes_physiques', 'Mme Durand', 'Durand');
  assert.deepStrictEqual(groups, [['Durand', 'Mme Durand']]);
});
