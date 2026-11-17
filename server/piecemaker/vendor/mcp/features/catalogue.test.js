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
      for (const reference of skill.references) assert.ok(reference.includes('/references/'), reference);
    }
  }
});

test('every listed reference can be read', async () => {
  const { CATALOGUE, readFeature, readReference } = await load();
  for (const feature of CATALOGUE) {
    for (const skill of readFeature(feature.nom).skills) {
      for (const reference of [...skill.references, `${skill.name}/SKILL.md`]) assert.ok(readReference(feature.nom, reference).length > 0, reference);
    }
  }
});

test('references outside the skill are refused', async () => {
  const { readReference } = await load();
  assert.throws(() => readReference('reasoning', 'piecemaker/../../../herisson.json'));
  assert.throws(() => readReference('reasoning', 'okf/SKILL.md'));
  assert.throws(() => readReference('nothing', 'piecemaker/SKILL.md'));
});

test('every command maps to a pm command and its options, with unique English names', async () => {
  const { CATALOGUE } = await load();
  const { pmArgv } = await import('../../piecemaker-plugin/scripts/lib/herisson.mjs');
  const help = require('node:child_process').execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'skills', 'Skill-PieceMaker', 'scripts', 'pm.mjs'), '--help'], { encoding: 'utf8' });
  const names = new Set();
  for (const feature of CATALOGUE) {
    for (const command of feature.commandes) {
      assert.match(command.nom, /^[a-z]+(_[a-z]+)*$/);
      assert.ok(!names.has(command.nom), command.nom);
      names.add(command.nom);
      const [tool, ...rest] = command.pm;
      const line = help.split('\n').find((entry) => entry.trim().startsWith(`${tool} `) && rest.every((word) => entry.includes(word)) || entry.trim() === tool);
      assert.ok(line, `pm ${command.pm.join(' ')}`);
      for (const [name, spec] of Object.entries(command.parametres ?? feature.parametres ?? {})) {
        assert.match(name, /^[a-z]+(_[a-z]+)*$/);
        if (!spec.startsWith('#')) assert.ok(help.includes(spec), `${command.nom}: ${spec}`);
      }
    }
  }
  assert.deepEqual(pmArgv('index', 'link', { source: 'Pièces/a.md', relation: 'states', target: 'Date de départ', citation: 'Texte fictif.', single: true }), ['okf', 'link', 'Pièces/a.md', 'states', 'Date de départ', '--citation', 'Texte fictif.', '--single']);
  assert.deepEqual(pmArgv('case', 'convert_documents', {}), ['dossier', 'conversion']);
  assert.deepEqual(pmArgv('exhibits', 'stamp_exhibits', { exhibits: ['a.pdf', 'b.pdf'] }), ['bordereau', 'a.pdf', 'b.pdf']);
  assert.deepEqual(pmArgv('deadlines', 'write_board', { path: 'projects/cabinet', data: { a: 1 } }), ['suivi_dossiers', 'ecrire', 'projects/cabinet', '--json', '{"a":1}']);
  assert.throws(() => pmArgv('index', 'link', { source: 'a.md' }), /needs "relation"/);
  assert.throws(() => pmArgv('reasoning', 'verify_reasoning', { file: 'x' }), /unknown parameter/);
  assert.throws(() => pmArgv('reasoning', 'nothing'), /unknown command/);
});
