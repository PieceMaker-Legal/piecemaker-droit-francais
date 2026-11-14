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

test('binds the extract under the article and the attributes of each input to their own definitions', () => {
  const content = [
    '## Article 1 | LEGIARTI000000000001',
    '« Passage juridique exact. »',
    '',
    '```catala',
    "champ d'application Exemple:",
    '  définition condition égal à vrai',
    '  ## Réception du message',
    '  #[piecemaker.source = "pieces/attestation.md"]',
    '  #[piecemaker.citation = "Jean Dupont a reçu le \\"message\\"."]',
    '  définition réception égal à vrai',
    '  ## Montant demandé',
    '  #[piecemaker.source = "okf:/_premises/montant.md"]',
    '  #[piecemaker.question = "Quel montant Société Exemple SAS a-t-elle demandé ?"]',
    '  définition montant égal à 1',
    '```',
  ].join('\n');
  const files = [{ nom: 'demo.catala_fr', chemin: '/dossier/.piecemaker/catala/demo/demo.catala_fr', contenu: content }];
  const context = (line: number) => sourceContext(`https://catala.local/demo.catala_fr#L${line}`, files).references.map((entry) => [entry.kind, entry.target, entry.quote, entry.question]);
  const article = 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000000000001';
  assert.deepEqual(context(6), [['article', article, 'Passage juridique exact.', undefined]]);
  assert.deepEqual(context(10), [['piece', '../../../pieces/attestation.md', 'Jean Dupont a reçu le "message".', undefined]]);
  assert.deepEqual(context(14), [['premise', 'okf:/_premises/montant.md', '', 'Quel montant Société Exemple SAS a-t-elle demandé ?']]);
  assert.deepEqual(sourceContext('https://catala.local/demo.catala_fr', files, true).references.map((entry) => entry.kind), ['article', 'piece', 'premise']);
});
