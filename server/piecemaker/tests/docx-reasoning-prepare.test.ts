import assert from 'node:assert/strict';
import test from 'node:test';

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';

import { prepareDocxReasoning } from '../docx-reasoning-prepare.js';
import { captureDocxState, DOCX_REASONING_PART, readDocxReasoning, verifyDocxReasoning } from '../docx-reasoning.js';

import { code, fixture, options } from './docx-reasoning-fixture.js';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraphPrice = 'Le prix convenu est de 12 000 EUR, payable après réception.';
const paragraphPenalty = 'En cas de retard, une pénalité est due au taux journalier de 0,1 %, dans la limite de 10 % du prix convenu.';
const paragraphDelay = 'Le scénario retient 30 jours de retard.';
const links = {
  clauses: [{ tag: 'pm:clause-prix', paragraphes: [paragraphPrice] }],
  valeurs: [{ tag: 'pm:prix', valeur: 'prix', type: 'nombre' as const, texte: '12 000 EUR', clause: 'pm:clause-prix' }],
};
const completeLinks = {
  clauses: [
    { tag: 'pm:clause-prix', paragraphes: [paragraphPrice] },
    { tag: 'pm:clause-pénalité', paragraphes: [paragraphPenalty] },
    { tag: 'pm:clause-retard', paragraphes: [paragraphDelay] },
  ],
  valeurs: [
    { tag: 'pm:prix', valeur: 'prix', type: 'nombre' as const, texte: '12 000 EUR', clause: 'pm:clause-prix' },
    { tag: 'pm:taux', valeur: 'taux', type: 'pourcentage' as const, texte: '0,1 %', clause: 'pm:clause-pénalité' },
    { tag: 'pm:plafond', valeur: 'plafond', type: 'pourcentage' as const, texte: '10 %', clause: 'pm:clause-pénalité' },
    { tag: 'pm:jours', valeur: 'jours', type: 'nombre' as const, texte: '30', clause: 'pm:clause-retard' },
  ],
};

async function mutate(input: Uint8Array, change: (xml: string) => string) {
  const zip = await JSZip.loadAsync(input);
  zip.file('word/document.xml', change(await zip.file('word/document.xml')!.async('string')));
  return zip.generateAsync({ type: 'uint8array' });
}

async function plainFixture() {
  const zip = await JSZip.loadAsync(await fixture());
  zip.remove(DOCX_REASONING_PART);
  const document = await zip.file('word/document.xml')!.async('string');
  const dom = new DOMParser().parseFromString(document, 'application/xml');
  while (dom.getElementsByTagNameNS(WORD, 'sdt').length) {
    const control = dom.getElementsByTagNameNS(WORD, 'sdt')[0];
    const tag = control.getElementsByTagNameNS(WORD, 'tag')[0]?.getAttributeNS(WORD, 'val');
    if (tag?.startsWith('pmr_end_')) {
      control.parentNode!.removeChild(control);
      continue;
    }
    const content = control.getElementsByTagNameNS(WORD, 'sdtContent')[0];
    while (content.firstChild) control.parentNode!.insertBefore(content.firstChild, control);
    control.parentNode!.removeChild(control);
  }
  for (const name of ['bookmarkStart', 'bookmarkEnd']) {
    for (const marker of Array.from(dom.getElementsByTagNameNS(WORD, name))) marker.parentNode!.removeChild(marker);
  }
  zip.file('word/document.xml', new XMLSerializer().serializeToString(dom));
  return zip.generateAsync({ type: 'uint8array' });
}

async function paragraphText(input: Uint8Array, index: number) {
  const zip = await JSZip.loadAsync(input);
  const dom = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
  return Array.from(dom.getElementsByTagNameNS(WORD, 'p'))[index].textContent;
}

test('prépare un DOCX ordinaire, conserve le code et la source canonique', async () => {
  const input = await plainFixture();
  const before = await captureDocxState(input, [], []);
  const output = await prepareDocxReasoning(input, code, completeLinks);

  assert.equal((await readDocxReasoning(output)).code, code);
  assert.equal((await captureDocxState(output, [], [])).body, before.body);
  assert.equal((await captureDocxState(output, completeLinks.valeurs, completeLinks.clauses.map(({ tag }) => tag))).values.prix, 12000);
  const inputBytes = Buffer.from(input);
  const outputBytes = Buffer.from(output);
  const checked = await verifyDocxReasoning(output, options);
  assert.ok(checked.verification?.annotated);
  const checkedAnnotated = checked.verification.annotated as { valeurs: Record<string, { preuve: { piece: string }[] }>; objectifs: { montant_calcule: number }[] };
  assert.equal(checkedAnnotated.valeurs.prix.preuve[0].piece, 'docx#pm:prix');
  assert.equal(checkedAnnotated.objectifs[0].montant_calcule, 360);
  assert.deepEqual(Buffer.from(input), inputBytes);
  assert.deepEqual(Buffer.from(output), outputBytes);
  const changed = await mutate(output, (xml) => xml.replace('12 000 EUR', '15 000 EUR'));
  const changedBytes = Buffer.from(changed);
  const changedResult = await verifyDocxReasoning(changed, options);
  assert.ok(changedResult.verification?.annotated);
  assert.equal((changedResult.verification.annotated as { objectifs: { montant_calcule: number }[] }).objectifs[0].montant_calcule, 450);
  assert.deepEqual(Buffer.from(changed), changedBytes);
});

test('une valeur scindée en runs avec styles conserve le texte et la mise en forme', async () => {
  const input = await mutate(await plainFixture(), (xml) => xml.replace(
    '<w:r><w:t xml:space="preserve">12 000 EUR</w:t></w:r>',
    '<w:r><w:rPr><w:b/></w:rPr><w:t>12 000</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> EUR</w:t></w:r>',
  ));
  const before = await captureDocxState(input, [], []);
  const output = await prepareDocxReasoning(input, code, links);
  const state = await captureDocxState(output, [{ tag: 'pm:prix', valeur: 'prix', type: 'nombre' }], ['pm:clause-prix']);
  const zip = await JSZip.loadAsync(output);
  const document = await zip.file('word/document.xml')!.async('string');

  assert.equal(state.values.prix, 12000);
  assert.equal((await captureDocxState(output, [], [])).body, before.body);
  assert.match(document, /<w:b\s*\/?\s*>/u);
  assert.match(document, /<w:i\s*\/?\s*>/u);
});

test('une virgule après un prix et un pourcentage sont des valeurs ordinaires', async () => {
  const input = await plainFixture();
  const priceLinks = { ...links, clauses: [{ tag: 'pm:clause-prix', paragraphes: [paragraphPrice, paragraphPenalty] }] };
  const output = await prepareDocxReasoning(input, code, {
    ...priceLinks,
    valeurs: [
      ...links.valeurs,
      { tag: 'pm:plafond', valeur: 'plafond', type: 'pourcentage', texte: '10 %', clause: 'pm:clause-prix' },
    ],
  });
  const state = await captureDocxState(output, [
    { tag: 'pm:prix', valeur: 'prix', type: 'nombre' },
    { tag: 'pm:plafond', valeur: 'plafond', type: 'pourcentage' },
  ], ['pm:clause-prix']);

  assert.equal(state.values.prix, 12000);
  assert.equal(state.values.plafond, 0.1);
  assert.equal(await paragraphText(output, 0), 'Scénario arithmétique fictif de Société Exemple SAS');
});

test('les sélections de clause introuvables, ambiguës, non contiguës ou chevauchantes sont refusées', async () => {
  const input = await plainFixture();
  await assert.rejects(prepareDocxReasoning(input, code, {
    ...links, clauses: [{ tag: 'pm:clause-prix', paragraphes: ['Texte absent'] }],
  }), /Clause .* introuvable/u);

  const duplicate = await mutate(input, (xml) => xml.replace(
    '<w:sectPr>',
    `<w:p><w:r><w:t>${paragraphPrice}</w:t></w:r></w:p><w:sectPr>`,
  ));
  await assert.rejects(prepareDocxReasoning(duplicate, code, links), /Clause .* ambiguë/u);

  await assert.rejects(prepareDocxReasoning(input, code, {
    ...links, clauses: [{ tag: 'pm:clause-prix', paragraphes: [paragraphPrice, paragraphDelay] }],
  }), /Clause .* non contiguë/u);
  await assert.rejects(prepareDocxReasoning(input, code, {
    clauses: [
      { tag: 'pm:clause-prix', paragraphes: [paragraphPrice] },
      { tag: 'pm:clause-retard', paragraphes: [paragraphPrice] },
    ], valeurs: [],
  }), /sélections de clauses se chevauchent/u);
});

test('les valeurs absentes ou répétées dans leur clause sont refusées', async () => {
  const input = await plainFixture();
  await assert.rejects(prepareDocxReasoning(input, code, {
    ...links, valeurs: [{ ...links.valeurs[0], texte: '14 000 EUR' }],
  }), /Valeur .* introuvable/u);

  const duplicateText = 'Le prix convenu est de 12 000 EUR et 12 000 EUR, payable après réception.';
  const duplicate = await mutate(input, (xml) => xml.replace('12 000 EUR', '12 000 EUR et 12 000 EUR'));
  const duplicateLinks = { ...links, clauses: [{ tag: 'pm:clause-prix', paragraphes: [duplicateText] }] };
  await assert.rejects(prepareDocxReasoning(duplicate, code, duplicateLinks), /Valeur .* ambiguë/u);
});

test('les tags et variables dupliqués, tags déjà présents et préfixes réservés sont refusés', async () => {
  const input = await plainFixture();
  await assert.rejects(prepareDocxReasoning(input, code, {
    clauses: [links.clauses[0], links.clauses[0]], valeurs: [],
  }), /Tag déclaré plusieurs fois/u);
  await assert.rejects(prepareDocxReasoning(input, code, {
    clauses: links.clauses,
    valeurs: [links.valeurs[0], { ...links.valeurs[0], tag: 'pm:prix-autre' }],
  }), /variable déclaré plusieurs fois/u);
  await assert.rejects(prepareDocxReasoning(input, code, {
    clauses: [{ ...links.clauses[0], tag: 'pmr_reserved' }], valeurs: [],
  }), /préfixe pmr_/u);

  const tagged = await mutate(input, (xml) => xml.replace('<w:body>',
    '<w:body><w:sdt><w:sdtPr><w:tag w:val="pm:prix"/></w:sdtPr><w:sdtContent><w:p/></w:sdtContent></w:sdt>',
  ));
  await assert.rejects(prepareDocxReasoning(tagged, code, links), /Tag déjà présent/u);
});

test('refuse les documents déjà liés et les révisions Word en attente', async () => {
  const plain = await plainFixture();
  const linked = await prepareDocxReasoning(plain, code, links);
  await assert.rejects(prepareDocxReasoning(linked, code, links), /Document déjà lié/u);

  const pending = await mutate(plain, (xml) => xml.replace('<w:p>', '<w:p><w:ins w:id="77"><w:r><w:t>Modification fictive</w:t></w:r></w:ins>'));
  await assert.rejects(prepareDocxReasoning(pending, code, links), /Résoudre les révisions/u);
});

test('refuse les champs Word et les ruptures dans le paragraphe d’une valeur', async () => {
  const input = await plainFixture();
  const field = await mutate(input, (xml) => xml.replace(
    '12 000 EUR',
    '<w:fldSimple w:instr="= 12000"><w:r><w:t>12 000 EUR</w:t></w:r></w:fldSimple>',
  ));
  await assert.rejects(prepareDocxReasoning(field, code, links), /champ Word ni rupture/u);

  const broken = await mutate(input, (xml) => xml.replace(
    '12 000 EUR',
    '12 000<w:br/> EUR',
  ));
  await assert.rejects(prepareDocxReasoning(broken, code, links), /champ Word ni rupture/u);
});

test('une valeur calculée ne peut pas être liée comme une valeur lue dans le DOCX', async () => {
  const calculated = code.replace('prix: { valeur: null }', 'prix: { formule: { somme: [1, 2] }, valeur: null }');
  await assert.rejects(prepareDocxReasoning(await plainFixture(), calculated, links), /Variable absente, calculée ou fixée/u);
});

