import assert from 'node:assert/strict';
import test from 'node:test';

import { sourceContext } from '../../shared/piecemaker/catala-sources.js';

const quotes = (contenu: string) => sourceContext('https://catala.local/demo.catala_fr', [{ nom: 'demo.catala_fr', chemin: '/dossier/demo.catala_fr', contenu }], true).references.map((entry) => [entry.label, entry.quote]);

test('reads the quotation under the occurrence of the link that carries it', () => {
  const contenu = '## [Pièce n° 3 | Contrat](../../../pieces/contrat.md)\n\nLe contrat fixe le prix.\nSource : [Pièce 3, contrat](../../../pieces/contrat.md)\nCitation : « Le prix est de 1 000 euros. »\n';
  assert.deepEqual(quotes(contenu), [['Pièce n° 3 | Contrat', 'Le prix est de 1 000 euros.'], ['Pièce 3, contrat', 'Le prix est de 1 000 euros.']]);
});

test('keeps a distinct quotation for each labelled link to the same source', () => {
  const contenu = '[Pièce 3, prix](../../../pieces/contrat.md)\nCitation : « Le prix est de 1 000 euros. »\n\n[Pièce 3, délai](../../../pieces/contrat.md)\nCitation : « Livraison sous 30 jours. »\n';
  assert.deepEqual(quotes(contenu), [['Pièce 3, prix', 'Le prix est de 1 000 euros.'], ['Pièce 3, délai', 'Livraison sous 30 jours.']]);
});

test('binds the extract under the article to the definitions of its section', () => {
  const content = [
    '## Article 1 | LEGIARTI000000000001',
    '« Passage juridique exact. »',
    '',
    '```catala',
    "champ d'application Exemple:",
    '  définition condition égal à vrai',
    '```',
  ].join('\n');
  const files = [{ nom: 'demo.catala_fr', chemin: '/dossier/.piecemaker/catala/demo/demo.catala_fr', contenu: content }];
  const article = 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000000000001';
  assert.deepEqual(sourceContext('https://catala.local/demo.catala_fr#L6', files).references.map((entry) => [entry.kind, entry.target, entry.quote]), [['article', article, 'Passage juridique exact.']]);
  assert.deepEqual(sourceContext('https://catala.local/demo.catala_fr', files, true).references.map((entry) => entry.kind), ['article']);
});
