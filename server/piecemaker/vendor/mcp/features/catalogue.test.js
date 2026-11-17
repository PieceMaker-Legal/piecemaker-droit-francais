const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const load = () => import('./catalogue.mjs');
const pmSource = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'Skill-PieceMaker', 'scripts', 'pm.mjs'), 'utf8');
const tabTargets = JSON.parse(/const TAB_TARGETS = (\[[^\]]*\])/.exec(pmSource)[1].replace(/'/g, '"'));

test('every feature has a unique English name, a known tab and existing skills', async () => {
  const { CATALOGUE, readFeature } = await load();
  const names = CATALOGUE.map((feature) => feature.nom);
  assert.equal(new Set(names).size, names.length);
  for (const feature of CATALOGUE) {
    assert.match(feature.nom, /^[a-z][a-z_]*$/);
    assert.ok(feature.volet === null || tabTargets.includes(feature.volet), `${feature.nom}: tab ${feature.volet}`);
    const read = readFeature(feature.nom);
    assert.ok(read.skills.length > 0);
    for (const skill of read.skills) {
      assert.ok(skill.instructions.length > 0);
      for (const reference of skill.references) assert.ok(skill.instructions.length && reference.includes('/references/'));
    }
  }
});

test('every listed reference can be read', async () => {
  const { CATALOGUE, readFeature, readReference } = await load();
  for (const feature of CATALOGUE) {
    for (const skill of readFeature(feature.nom).skills) {
      for (const reference of skill.references) assert.ok(readReference(feature.nom, reference).length > 0, reference);
    }
  }
});

test('references outside the skill are refused', async () => {
  const { readReference } = await load();
  assert.throws(() => readReference('reasoning', 'piecemaker/../../../herisson.json'));
  assert.throws(() => readReference('reasoning', 'okf/SKILL.md'));
  assert.throws(() => readReference('nothing', 'piecemaker/SKILL.md'));
});
