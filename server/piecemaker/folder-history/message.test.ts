import assert from 'node:assert/strict';
import test from 'node:test';

import { excludeBlock, isIgnoredPath, isSensitivePath, withExcludeBlock } from './exclude.js';
import { manualMessage, turnMessage } from './message.js';

test('message de tour : sujet = demande sur une ligne, tronquée à 72 caractères', () => {
  const message = turnMessage(`Rédige les conclusions\npour Jean Dupont ${'x'.repeat(100)}`, 'J’ai mis à jour les notes.');
  assert.equal(message.subject, 'Rédige les conclusions pour Jean Dupont…');
  assert.equal(message.body, 'J’ai mis à jour les notes.');
});

test('message de tour : la troncature ne coupe jamais un nom (hudsucker ne reconnaîtrait pas « Dupo… »)', () => {
  const request = `${'a '.repeat(25)}contre Jean-Baptiste Dupont-Fictif`;
  const { subject } = turnMessage(request, '');
  assert.ok(subject.length <= 72);
  assert.match(subject, /contre Jean-Baptiste…$/);
});

test('message de tour : bloc <CITATIONS> et liens de citation retirés du corps', () => {
  const conclusion = 'Le préavis est de trois mois [1].\n<CITATIONS>[{"ref":1}]</CITATIONS>\n\n[1]: #piecemaker-citation=abc';
  assert.equal(turnMessage('Question', conclusion).body, 'Le préavis est de trois mois [1].');
});

test('message de tour : demande vide → sujet par défaut, corps tronqué à 4 000 caractères', () => {
  const message = turnMessage('  ', 'y'.repeat(5000));
  assert.equal(message.subject, 'Tour IA');
  assert.equal(message.body?.length, 4000);
});

test('message hors IA : liste des fichiers, plafonnée à 200 lignes', () => {
  assert.deepEqual(manualMessage('A\tpieces/contrat-fictif.pdf\nM\tnotes.md\n'), {
    subject: 'Modifications hors IA',
    body: 'A\tpieces/contrat-fictif.pdf\nM\tnotes.md',
  });
  const many = Array.from({ length: 250 }, (_, index) => `A\tfichier-${index}.md`).join('\n');
  const body = manualMessage(many).body ?? '';
  assert.equal(body.split('\n').length, 201);
  assert.match(body, /… et 50 autres fichiers$/);
});

test('exclusions : bloc remplacé sans doublon, contenu existant conservé', () => {
  const once = withExcludeBlock('# exclusions locales\n*.bak');
  assert.ok(once.startsWith('# exclusions locales\n*.bak\n'));
  assert.equal(withExcludeBlock(once), once);
  assert.equal(once.split(excludeBlock()).length, 2);
});

test('exclusions : chemins ignorés et sensibles', () => {
  for (const ignored of ['.git/index', '.piecemaker/state.json', 'sous/node_modules/a.js', '~$acte.docx', 'mapping_default.json', 'scan_sensitive_map.json', '.env', 'Pieces/.DS_Store', 'brouillon.tmp']) {
    assert.ok(isIgnoredPath(ignored), ignored);
  }
  for (const kept of ['notes.md', 'pieces/contrat-fictif.pdf', 'Conclusions.docx']) assert.ok(!isIgnoredPath(kept), kept);
  assert.ok(isSensitivePath('.piecemaker/protection.json'));
  assert.ok(isSensitivePath('sous/mapping_default.json'));
  assert.ok(!isSensitivePath('notes.md'));
});
