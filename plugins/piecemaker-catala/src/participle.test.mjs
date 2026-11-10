import assert from 'node:assert/strict';
import test from 'node:test';
import { infinitive, participle } from '../../../server/piecemaker/vendor/skills/Skill-PieceMaker/scripts/catala-participe.mjs';

test('finds a past participle and ignores nouns that end like one', () => {
  for (const title of ['Contrat conclu', 'Préavis exécuté', 'Indemnité due', 'Clause prise en compte', 'Conditions réunies', 'Mandat confié au dirigeant']) assert.ok(participle(title), title);
  for (const title of ['Date engagement', 'Indemnité de départ', 'Société', 'Assemblée générale', 'Durées', 'Le régime est-il applicable ?']) assert.equal(participle(title), false, title);
});

test('finds a leading infinitive and ignores nouns that end like one', () => {
  for (const title of ['Vérifier le montant demandé', 'Établir la faute', 'Résoudre le contrat', 'Recevoir la demande', 'S’assurer du préavis']) assert.ok(infinitive(title), title);
  for (const title of ['Montant demandé', 'Salaire versé', 'Contrat à résoudre', 'Dossier complet', 'Pouvoir du dirigeant']) assert.equal(infinitive(title), false, title);
});
