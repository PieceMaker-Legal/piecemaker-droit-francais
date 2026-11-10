import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

test('a picked card shows as a chip and joins the sent message with its file and lines', async () => {
  const { inject, cardReference } = await import('./composer.ts');
  const dom = new JSDOM('<form data-slot="prompt-input"><textarea data-slot="prompt-input-textarea"></textarea><button type="submit"></button></form>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const stop = inject();
  try {
    const form = document.querySelector('form');
    const field = document.querySelector('textarea');
    const sent = [];
    let sends = true;
    field.addEventListener('keydown', (event) => { if (event.key === 'Enter' && sends) { event.preventDefault(); sent.push(field.value); } });
    const pick = (detail) => window.dispatchEvent(new dom.window.CustomEvent('piecemaker:catala-card-pick', { detail }));
    const enter = () => field.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const chips = () => [...form.querySelectorAll('.pmc-chip > span')].map((chip) => chip.textContent);
    const first = { titre: 'Vérifier le montant demandé', fichier: '.piecemaker/catala/demo/demo.catala_fr', debut: 12, fin: 15 };
    pick(first);
    pick(first);
    pick({ titre: 'Contrat conclu' });
    assert.equal(form.firstElementChild.className, 'pmc-chips');
    assert.deepEqual(chips(), ['Carte « Vérifier le montant demandé »', 'Carte « Contrat conclu »']);
    assert.equal(cardReference(first), '[Carte « Vérifier le montant demandé »](.piecemaker/catala/demo/demo.catala_fr:12 "lignes 12 à 15")');
    assert.equal(cardReference({ ...first, identifiant: 'montant_dû', valeur: 'Vrai', scenario: 'TestMontant' }), '[Carte « Vérifier le montant demandé »](.piecemaker/catala/demo/demo.catala_fr:12 "lignes 12 à 15") — `montant_dû` = Vrai, scénario TestMontant');
    assert.equal(cardReference({ titre: 'Contrat conclu', valeur: 'Faux' }), 'Carte « Contrat conclu » — valeur Faux');
    form.querySelector('[data-remove="1"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(chips(), ['Carte « Vérifier le montant demandé »']);
    field.value = 'Pourquoi ?';
    sends = false;
    enter();
    assert.equal(field.value, 'Pourquoi ?');
    assert.equal(chips().length, 1);
    sends = true;
    enter();
    assert.deepEqual(sent, [`Pourquoi ?\n\n${cardReference(first)}`]);
    assert.equal(field.value, 'Pourquoi ?');
    assert.equal(chips().length, 1);
    field.value = '';
    await wait(250);
    assert.deepEqual(chips(), []);
    pick(first);
    enter();
    assert.equal(sent[1], cardReference(first));
    assert.deepEqual(chips(), []);
  } finally { stop(); dom.window.close(); }
  assert.equal(document.querySelector('.pmc-chips'), null);
});
