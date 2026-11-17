import assert from 'node:assert/strict';

import { it, vi } from 'vitest';

import { cardReference, startChatPickComposer } from '@/modules/piecemaker-chat-picks/chatPickComposer';
import { setActiveProjectId } from '@/piecemaker/chat/fileRef';

const posted = vi.hoisted(() => [] as { url: string; body: Record<string, unknown> }[]);
vi.mock('@/shared/api', () => ({ authenticatedFetch: (url: string, options: { body: string }) => { posted.push({ url, body: JSON.parse(options.body) }); return Promise.resolve(new Response('{}')); } }));

const wait = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay));

it('affiche l’élément ciblé en puce et le joint au message envoyé avec son fichier et ses lignes', async () => {
  document.body.innerHTML = '<form data-slot="prompt-input"><textarea data-slot="prompt-input-textarea"></textarea><button type="submit"></button></form>';
  const stop = startChatPickComposer();
  try {
    const form = document.querySelector('form')!;
    const field = document.querySelector('textarea')!;
    const sent: string[] = [];
    let sends = true;
    field.addEventListener('keydown', (event) => { if (event.key === 'Enter' && sends) { event.preventDefault(); sent.push(field.value); } });
    const pick = (detail: object, type = 'piecemaker:catala-card-pick') => window.dispatchEvent(new window.CustomEvent(type, { detail }));
    const enter = () => field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const chips = () => [...form.querySelectorAll('.pmc-pick > span')].map((chip) => chip.textContent);
    const first = { titre: 'Vérifier le montant demandé', fichier: '.piecemaker/catala/demo/demo.catala_fr', debut: 12, fin: 15 };
    pick(first);
    pick(first);
    pick({ titre: 'Contrat conclu' });
    assert.equal(form.firstElementChild!.className, 'pmc-picks');
    assert.deepEqual(chips(), ['Carte « Vérifier le montant demandé »', 'Carte « Contrat conclu »']);
    assert.equal(cardReference(first), '[Carte « Vérifier le montant demandé »](.piecemaker/catala/demo/demo.catala_fr:12 "lignes 12 à 15")');
    assert.equal(cardReference({ ...first, identifiant: 'montant_dû', valeur: 'Vrai', scenario: 'TestMontant' }), '[Carte « Vérifier le montant demandé »](.piecemaker/catala/demo/demo.catala_fr:12 "lignes 12 à 15") — `montant_dû` = Vrai, scénario TestMontant');
    assert.equal(cardReference({ titre: 'Contrat conclu', valeur: 'Faux' }), 'Carte « Contrat conclu » — valeur Faux');
    form.querySelector('[data-remove="1"]')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
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
  } finally { stop(); }
  assert.equal(document.querySelector('.pmc-picks'), null);
});

it('nomme l’élément ciblé par sa nature et joint sa note', () => {
  document.body.innerHTML = '<form data-slot="prompt-input"><textarea data-slot="prompt-input-textarea"></textarea></form>';
  const stop = startChatPickComposer();
  try {
    const relation = { titre: 'modifie', nature: 'Relation', fichier: '/Users/exemple/.piecemaker/ontologie.json', debut: 3, fin: 16, note: 'modification par pm okf ontologie proposer' };
    window.dispatchEvent(new window.CustomEvent('piecemaker:chat-pick', { detail: relation }));
    assert.deepEqual([...document.querySelectorAll('.pmc-pick > span')].map((chip) => chip.textContent), ['Relation « modifie »']);
    assert.equal(cardReference({ titre: 'Contrat.pdf', nature: 'Document', fichier: 'Pièces/Contrat.pdf' }), '[Document « Contrat.pdf »](Pièces/Contrat.pdf)');
    assert.equal(cardReference(relation), '[Relation « modifie »](/Users/exemple/.piecemaker/ontologie.json:3 "lignes 3 à 16") — modification par pm okf ontologie proposer');
  } finally { stop(); }
});

it('ouvre un fil de commentaire ancré sur l’élément marqué Commenter et nomme le fil dans le message', () => {
  document.body.innerHTML = '<form data-slot="prompt-input"><textarea data-slot="prompt-input-textarea"></textarea></form>';
  setActiveProjectId('exemple');
  posted.length = 0;
  const stop = startChatPickComposer();
  try {
    const field = document.querySelector('textarea')!;
    const sent: string[] = [];
    field.addEventListener('keydown', (event) => { event.preventDefault(); sent.push(field.value); });
    const card = { titre: 'Délai de préavis', fichier: '.piecemaker/catala/preavis/preavis.catala_fr', debut: 3, fin: 5 };
    window.dispatchEvent(new window.CustomEvent('piecemaker:catala-card-pick', { detail: card }));
    document.querySelector<HTMLElement>('[data-comment="0"]')!.click();
    assert.equal(document.querySelector('[data-comment="0"]')!.getAttribute('aria-pressed'), 'true');
    field.value = 'Vérifier ce délai';
    field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(posted.length, 1);
    const { url, body } = posted[0];
    assert.equal(url, '/api/piecemaker/feature-comments?projectId=exemple');
    assert.deepEqual(body, { feature: 'catala', id: body.id, text: 'Vérifier ce délai', anchor: { tab: 'plugin:piecemaker-catala', title: card.titre, file: card.fichier, start: 3, end: 5 } });
    assert.match(String(body.id), /^[a-z0-9-]{8}$/);
    assert.equal(sent[0], `Vérifier ce délai\n\n${cardReference(card)} — commentaire ${body.id} : FeatureComments read catala`);
    assert.equal(document.querySelector('[data-comment="0"]')!.getAttribute('aria-pressed'), 'false');
  } finally { stop(); }
});
