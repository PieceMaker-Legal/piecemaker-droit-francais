import assert from 'node:assert/strict';
import test from 'node:test';
import { participle } from './participle.ts';

test('finds a past participle and ignores nouns that end like one', () => {
  for (const title of ['Contrat conclu', 'Préavis exécuté', 'Indemnité due', 'Clause prise en compte', 'Conditions réunies', 'Mandat confié au dirigeant']) assert.ok(participle(title), title);
  for (const title of ['Date engagement', 'Indemnité de départ', 'Société', 'Assemblée générale', 'Durées', 'Le régime est-il applicable ?']) assert.equal(participle(title), false, title);
});
