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

test('binds native doc sources and quote to their own definitions within one block', () => {
  const content = [
    '# Article fictif | LEGIARTI000000000009',
    '```catala',
    "champ d'application Exemple:",
    '  #[doc="source: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000000000001\\nquote: « Passage juridique exact. »"]',
    '  définition condition égal à vrai',
    '  #[doc="source: ../../../pieces/attestation.md\\nquote: « Jean Dupont a reçu le message. »"]',
    '  définition réception égal à vrai',
    '  définition sans_annotation égal à faux',
    '```',
  ].join('\n');
  const files = [{ nom: 'demo.catala_fr', chemin: '/dossier/demo.catala_fr', contenu: content }];
  const context = (line: number) => sourceContext(`https://catala.local/demo.catala_fr#L${line}`, files).references;
  assert.deepEqual(context(5).map((entry) => [entry.target, entry.quote]), [['https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000000000001', 'Passage juridique exact.']]);
  assert.deepEqual(context(7).map((entry) => [entry.kind, entry.quote]), [['piece', 'Jean Dupont a reçu le message.']]);
  assert.ok(context(8).every((entry) => !entry.quote));
  assert.equal(sourceContext('https://catala.local/demo.catala_fr', files, true).references.filter((entry) => entry.quote).length, 2);
});
