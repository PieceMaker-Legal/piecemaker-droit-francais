import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { findContentControls, parseDocx, repackDocx, setContentControlContent } from '@eigenpal/docx-editor-core/headless';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';

import { captureDocxState, DOCX_REASONING_PART, embedDocxReasoning, readDocxReasoning, verifyDocxReasoning } from '../docx-reasoning.js';
import { bindings, clauses, code, control, fixture, mutate, options, paragraph, run, state } from './docx-reasoning-fixture.js';

const amount = (result: Awaited<ReturnType<typeof verifyDocxReasoning>>) => (result.verification?.annotated?.objectifs as Array<{ montant_calcule: number }>)[0].montant_calcule;
let docxVersion = '';
try { docxVersion = execFileSync('docx', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}

test('un fichier DOCX autonome suffit à rejouer le moteur et ses deux hypothèses', async () => {
  const result = await verifyDocxReasoning(await fixture(), options);
  assert.equal(result.status, 'testé');
  assert.equal(amount(result), 360);
  assert.equal(result.verification?.issues.filter((issue) => issue.kind === 'erreur').length, 0);
  assert.equal((result.verification?.annotated?.bilan as { hypotheses: string }).hypotheses, '2/2');
});

test('les chiffres réellement modifiés dans Word remplacent les valeurs du modèle', async () => {
  const input = await mutate(await fixture(), (xml) => xml.replace('10 %', '20 %').replace('>30<', '>200<'));
  const result = await verifyDocxReasoning(input, options);
  assert.equal(amount(result), 2400);
});

test('les contrôles liés protègent leur identité tout en laissant leur contenu modifiable', async () => {
  const input = await mutate(await fixture(), (xml) => xml.replace('<w:lock w:val="sdtLocked"/>', '<w:lock w:val="contentLocked"/><w:temporary/>'));
  const linked = await embedDocxReasoning(input, { code, bindings, clauses });
  const zip = await JSZip.loadAsync(linked);
  const dom = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
  const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const locks = Array.from(dom.getElementsByTagNameNS(namespace, 'lock'));
  assert.equal(locks.length, bindings.length + clauses.length);
  assert.ok(locks.every((lock) => lock.getAttributeNS(namespace, 'val') === 'sdtLocked'));
  assert.equal(dom.getElementsByTagNameNS(namespace, 'temporary').length, 0);
  assert.equal(amount(await verifyDocxReasoning(await mutate(linked, (xml) => xml.replace('>30<', '>60<')), options)), 720);
});

test('plusieurs retouches manuelles gardent le modèle et localisent la clause à revoir', async () => {
  const changed = await mutate(await fixture(), (xml) => xml.replace('>30<', '>60<').replace('une pénalité est due', 'aucune pénalité n’est due'));
  const saved = new Uint8Array(await repackDocx(await parseDocx(changed, { preloadFonts: false })));
  assert.equal((await readDocxReasoning(saved)).code, code);
  const result = await verifyDocxReasoning(saved, options);
  assert.equal(result.status, 'à revoir');
  assert.deepEqual(result.changed, [clauses[1]]);
  assert.match(result.context[0].text, /aucune pénalité/);
  assert.equal(result.verification, null);
  const restored = await mutate(saved, (xml) => xml.replace('aucune pénalité n’est due', 'une pénalité est due'));
  assert.equal(amount(await verifyDocxReasoning(restored, options)), 720);
});

test('un signet de clause cassé ou dupliqué ne permet pas une localisation silencieusement fausse', async () => {
  const input = await fixture();
  for (const change of [
    (xml: string) => xml.replace(/<w:bookmarkEnd[^>]+\/>/, ''),
    (xml: string) => xml.replace(/(<w:bookmarkStart[^>]+\/>)/, '$1$1'),
  ]) await assert.rejects(verifyDocxReasoning(await mutate(input, change), options), /Signet .*dupliqué ou incomplet/);
});

test('la mise en forme seule ne rend pas le modèle obsolète', async () => {
  const input = await mutate(await fixture(), (xml) => xml.replace('<w:r>', '<w:r><w:rPr><w:b/></w:rPr>'));
  assert.equal((await verifyDocxReasoning(input, options)).status, 'testé');
});

test('la négation d’une clause exige une nouvelle appréciation et ne produit aucun résultat', async () => {
  const input = await mutate(await fixture(), (xml) => xml.replace('une pénalité est due', 'aucune pénalité n’est due'));
  const result = await verifyDocxReasoning(input, options);
  assert.equal(result.status, 'à revoir');
  assert.deepEqual(result.changed, [clauses[1]]);
  assert.equal(result.verification, null);
  assert.equal(result.context.length, 1);
});

test('un ajout hors clauses conserve les ancres mais impose une revue de structure', async () => {
  const input = await mutate(await fixture(), (xml) => xml.replace('<w:body>', `<w:body>${paragraph('Introduction ajoutée par l’avocat')}`));
  assert.equal((await state(input)).values.prix, 12000);
  assert.equal((await verifyDocxReasoning(input, options)).status, 'à revoir');
});

test('les ancrages survivent au déplacement des clauses, sans présumer son innocuité', async () => {
  const input = await fixture();
  const moved = await mutate(input, (xml) => {
    const pattern = /<w:sdt><w:sdtPr><w:alias w:val="pm:clause-prix"[\s\S]+?<\/w:p>(?:<w:bookmarkEnd[^>]+\/>)?<\/w:sdtContent><\/w:sdt>/;
    const found = xml.match(pattern)![0];
    return xml.replace(found, '').replace('<w:sectPr>', `${found}<w:sectPr>`);
  });
  assert.equal((await state(moved)).values.prix, 12000);
  assert.equal((await verifyDocxReasoning(moved, options)).status, 'à revoir');
});

test('la disparition ou duplication d’une ancre ne peut pas valider un ancien résultat', async () => {
  for (const change of [
    (xml: string) => xml.replace('w:tag w:val="pm:prix"', 'w:tag w:val="pm:prix-supprimé"'),
    (xml: string) => xml.replace('<w:sectPr>', `${control('pm:prix', run('999'), 999)}<w:sectPr>`),
  ]) await assert.rejects(verifyDocxReasoning(await mutate(await fixture(), change), options), /Ancre pm:prix/);
});

test('les valeurs ambiguës ou non numériques ne sont pas interprétées par un LLM', async () => {
  for (const value of ['à convenir', '12 ou 18', '1,000.50', '-']) {
    const input = await mutate(await fixture(), (xml) => xml.replace('12 000 EUR', value));
    await assert.rejects(verifyDocxReasoning(input, options), /Valeur nombre invalide/);
  }
});

test('les révisions Word non résolues empêchent un résultat présenté comme actuel', async () => {
  const input = await mutate(await fixture(), (xml) => xml.replace('<w:p>', `<w:p><w:ins w:id="55" w:author="Avocat fictif" w:date="2026-10-20T10:00:00Z">${run('Révision en attente')}</w:ins>`));
  const result = await verifyDocxReasoning(input, options);
  assert.equal(result.status, 'à revoir');
  assert.equal(result.verification, null);
});

test('le modèle et ses identifiants survivent à un enregistrement par l’éditeur existant', async () => {
  const input = await fixture();
  const doc = await parseDocx(input, { preloadFonts: false });
  const reopened = new Uint8Array(await repackDocx(doc));
  assert.equal((await readDocxReasoning(reopened)).code, code);
  assert.equal((await verifyDocxReasoning(reopened, options)).status, 'testé');
  assert.equal(amount(await verifyDocxReasoning(reopened, options)), 360);
});

test('un DOCX ordinaire n’est jamais déclaré vérifié sans modèle explicite', async () => {
  const zip = await JSZip.loadAsync(await fixture());
  zip.remove(DOCX_REASONING_PART);
  await assert.rejects(verifyDocxReasoning(await zip.generateAsync({ type: 'uint8array' }), options), /ne contient pas/);
});

test('une liaison ne peut pas remplacer un taux fixé par un texte ni un calcul', async () => {
  for (const field of ['formule: { produit: [1, 2] },', 'selon: [],']) {
    const input = await embedDocxReasoning(await fixture(), { code: code.replace('prix: { valeur: null }', `prix: { ${field} valeur: null }`), bindings, clauses });
    await assert.rejects(verifyDocxReasoning(input, options), /calculée ou fixée par un texte/);
  }
});

test('la qualification contentieux appelle encore la prescription, même depuis Word', async () => {
  const input = await embedDocxReasoning(await fixture(), { code: code.replace("qualification: 'consultation'", "qualification: 'contentieux'"), bindings, clauses });
  const result = await verifyDocxReasoning(input, options);
  assert.ok(result.verification?.issues.some((issue) => issue.text.includes('prescription')));
});

test('docx-cli 0.24 conserve les métadonnées mais ne retrouve pas le champ imbriqué', { skip: !docxVersion.startsWith('docx 0.24.') }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pm-docx-cli-'));
  try {
    const file = path.join(directory, 'contrat-fictif.docx');
    await writeFile(file, await fixture());
    execFileSync('docx', ['track-changes', file, 'on']);
    let failure = '';
    try { execFileSync('docx', ['replace', file, '10 %', '20 %']); }
    catch (error) { failure = String((error as { stdout?: Buffer }).stdout); }
    assert.match(failure, /MATCH_NOT_FOUND/);
    const updated = await readFile(file);
    assert.equal((await readDocxReasoning(updated)).code, code);
    assert.equal((await verifyDocxReasoning(updated, options)).status, 'testé');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('l’API EigenPal 1.9 modifie le champ avec son API de contenu', async () => {
  const doc = await parseDocx(await fixture(), { preloadFonts: false });
  assert.equal(findContentControls(doc).find((entry) => entry.tag === 'pm:plafond')?.text, '10 %');
  const updated = setContentControlContent(doc, { tag: 'pm:plafond' }, '20 %');
  assert.equal(findContentControls(updated).find((entry) => entry.tag === 'pm:plafond')?.text, '20 %');
});

test('les champs dans les tableaux et les accents restent rattachés au bon identifiant', async () => {
  const input = await mutate(await fixture(), (xml) => xml.replace('<w:sectPr>', `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr/><w:p>${control('pm:prix-tableau', run('18 000 EUR'), 505)}</w:p></w:tc></w:tr></w:tbl><w:sectPr>`));
  const linked = await embedDocxReasoning(input, { code, bindings: bindings.map((binding) => binding.valeur === 'prix' ? { ...binding, tag: 'pm:prix-tableau' } : binding), clauses });
  const result = await verifyDocxReasoning(linked, options);
  assert.equal(amount(result), 540);
});

test('une date impossible, un placeholder ou une liaison dupliquée sont refusés', async () => {
  const date = await mutate(await fixture(), (xml) => xml.replace('>30<', '>2026-02-30<'));
  await assert.rejects(captureDocxState(date, [{ tag: 'pm:jours', valeur: 'date', type: 'date' }], clauses), /Date ISO invalide/);
  const placeholder = await mutate(await fixture(), (xml) => xml.replace('<w:id w:val="101"/>', '<w:id w:val="101"/><w:showingPlcHdr/>'));
  await assert.rejects(state(placeholder), /non renseignée/);
  await assert.rejects(captureDocxState(await fixture(), [...bindings, bindings[0]], clauses), /deux fois/);
});

test('une modification de note de bas de page n’est pas silencieusement ignorée', async () => {
  const zip = await JSZip.loadAsync(await fixture());
  zip.file('word/footnotes.xml', '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>Réserve fictive nouvelle</w:t></w:r></w:p></w:footnote></w:footnotes>');
  assert.equal((await verifyDocxReasoning(await zip.generateAsync({ type: 'uint8array' }), options)).status, 'à revoir');
});

test('le vérificateur direct ne modifie pas les octets du DOCX reçu', async () => {
  const input = await fixture();
  const original = Buffer.from(input);
  await verifyDocxReasoning(input, options);
  assert.deepEqual(Buffer.from(input), original);
});

test('Docxtemplater remplit les valeurs mais régénérer le modèle efface une retouche libre', async () => {
  const template = await fixture(true);
  const render = () => new Docxtemplater(new PizZip(template), { paragraphLoop: true, linebreaks: true }).render({ prix: '12 000 EUR', taux: '0,1 %', plafond: '10 %', jours: '30' });
  const rendered = render();
  const input = rendered.getZip().generate({ type: 'uint8array' });
  assert.equal((await captureDocxState(input, bindings, clauses)).values.prix, 12000);
  const edited = await mutate(input, (xml) => xml.replace('payable après réception.', 'payable après réception avec réserves conservées.'));
  assert.ok((await JSZip.loadAsync(edited)).file('word/document.xml'));
  const regenerated = render().getZip().file('word/document.xml')!.asText();
  assert.ok(!regenerated.includes('réserves conservées'));
  const controls = findContentControls(await parseDocx(input, { preloadFonts: false }));
  assert.equal(controls.filter((control) => control.tag?.startsWith('pm:clause')).length, 3);
});
