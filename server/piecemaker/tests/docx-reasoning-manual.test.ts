import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseDocx, repackDocx, setContentControlContent } from '@eigenpal/docx-editor-core/headless';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';

import { captureDocxState, DOCX_REASONING_PART, embedDocxReasoning, readDocxReasoning, verifyDocxReasoning } from '../docx-reasoning.js';
import { bindings, clauses, code, fixture, mutate, options } from './docx-reasoning-fixture.js';

let soffice = '';
try { soffice = execFileSync('which', ['soffice'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}

async function eigenpalSave(input: Uint8Array, edits: Array<[string, string]> = []) {
  let document = await parseDocx(input, { preloadFonts: false });
  for (const [tag, value] of edits) document = setContentControlContent(document, { tag }, value);
  return new Uint8Array(await repackDocx(document));
}

async function libreOfficeSave(input: Uint8Array) {
  const directory = await mkdtemp(path.join(tmpdir(), 'pm-docx-manual-'));
  try {
    const output = path.join(directory, 'saved');
    await mkdir(output);
    const source = path.join(directory, 'fiction.docx');
    await writeFile(source, input);
    execFileSync(soffice, [
      `-env:UserInstallation=file://${path.join(directory, 'profile')}`, '--headless',
      '--convert-to', 'docx:Office Open XML Text', '--outdir', output, source,
    ], { timeout: 45000, stdio: ['ignore', 'pipe', 'pipe'] });
    return new Uint8Array(await readFile(path.join(output, 'fiction.docx')));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function editClauseEndMarker(input: Uint8Array, clause: string, action: 'duplicate' | 'delete' | 'move') {
  const zip = await JSZip.loadAsync(input);
  const xml = await zip.file('word/document.xml')!.async('string');
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const controls = Array.from(dom.getElementsByTagNameNS(word, 'sdt'));
  const expectedTag = `pmr_end_${createHash('sha256').update(clause).digest('hex').slice(0, 24)}`;
  const marker = controls.find((control) => control.getElementsByTagNameNS(word, 'tag')[0]?.getAttributeNS(word, 'val') === expectedTag);
  assert.ok(marker, `end marker for ${clause} should exist`);
  if (action === 'duplicate') marker.parentNode!.insertBefore(marker.cloneNode(true), marker.nextSibling);
  if (action === 'delete') marker.parentNode!.removeChild(marker);
  if (action === 'move') {
    const clauseControl = controls.find((control) => control.getElementsByTagNameNS(word, 'tag')[0]?.getAttributeNS(word, 'val') === clause);
    assert.ok(clauseControl);
    const content = clauseControl.getElementsByTagNameNS(word, 'sdtContent')[0];
    assert.ok(content);
    marker.parentNode!.removeChild(marker);
    const firstText = content.getElementsByTagNameNS(word, 't')[0];
    assert.ok(firstText?.parentNode?.parentNode);
    firstText.parentNode!.parentNode!.insertBefore(marker, firstText.parentNode!.nextSibling);
  }
  zip.file('word/document.xml', new XMLSerializer().serializeToString(dom));
  return zip.generateAsync({ type: 'uint8array' });
}

test('EigenPal → LibreOffice → retouche de clause en runs → EigenPal conserve les ancres de clause', { skip: !soffice }, async () => {
  const input = await fixture();
  const original = Buffer.from(input);
  const firstEigenpalSave = await eigenpalSave(input, [
    ['pm:prix', '18 000 EUR'],
    ['pm:taux', '0,2 %'],
    ['pm:jours', '20'],
  ]);
  const splitValue = await mutate(firstEigenpalSave, (xml) => xml.replace(
    '18 000 EUR',
    '18 000</w:t></w:r><w:r><w:t xml:space="preserve"> EUR',
  ));
  const firstRoundtrip = await libreOfficeSave(splitValue);
  assert.equal((await readDocxReasoning(firstRoundtrip)).code, code);
  const firstResult = await verifyDocxReasoning(firstRoundtrip, options);
  assert.equal(firstResult.status, 'testé');
  assert.equal((firstResult.verification?.annotated?.objectifs as Array<{ montant_calcule: number }>)[0].montant_calcule, 720);

  const editedClause = await mutate(firstRoundtrip, (xml) => xml.replace(
    'une pénalité est due',
    'aucune pénalité n’est</w:t></w:r><w:r><w:t xml:space="preserve"> due',
  ));
  const finalSave = await eigenpalSave(editedClause);
  const model = await readDocxReasoning(finalSave);
  assert.equal(model.code, code);
  const result = await verifyDocxReasoning(finalSave, options);
  assert.equal(result.status, 'à revoir');
  assert.deepEqual(result.changed, [clauses[1]]);
  assert.equal(result.context.length, 1);
  assert.equal(result.context[0].tag, clauses[1]);
  assert.match(result.context[0].text, /aucune pénalité n’est due au taux journalier de 0,2 %, dans la limite de 10 % du prix convenu\./u);
  assert.equal(result.verification, null);
  assert.deepEqual(Buffer.from(input), original);
});

test('une révision en attente dans une note empêche le rattachement et la vérification', async () => {
  const input = await fixture();
  const zip = await JSZip.loadAsync(input);
  const model = await readDocxReasoning(input);
  assert.ok(model.version === 1);
  zip.remove(DOCX_REASONING_PART);
  zip.file('word/footnotes.xml', '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:ins w:id="80" w:author="Avocat fictif" w:date="2026-10-20T10:00:00Z"><w:r><w:t>Ajout fictif en note</w:t></w:r></w:ins></w:p></w:footnote></w:footnotes>');
  const withRevisionBeforeLink = await zip.generateAsync({ type: 'uint8array' });
  await assert.rejects(embedDocxReasoning(withRevisionBeforeLink, { code: model.code, bindings, clauses }), /Résoudre les révisions/u);

  const notes = await JSZip.loadAsync(input);
  notes.file('word/footnotes.xml', '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:ins w:id="81" w:author="Avocat fictif" w:date="2026-10-20T10:00:00Z"><w:r><w:t>Ajout fictif après liaison</w:t></w:r></w:ins></w:p></w:footnote></w:footnotes>');
  const checked = await verifyDocxReasoning(await notes.generateAsync({ type: 'uint8array' }), options);
  assert.equal(checked.status, 'à revoir');
  assert.equal(checked.verification, null);
  assert.ok(checked.changed.includes('révisions en attente'));
});

test('les repères de fin supprimés ou dupliqués échouent explicitement, et leur déplacement relance la revue', { skip: !soffice }, async () => {
  const input = await fixture();
  const values = await eigenpalSave(input, [['pm:prix', '18 000 EUR'], ['pm:taux', '0,2 %'], ['pm:jours', '20']]);
  const afterLibreOffice = await libreOfficeSave(values);
  const stableSave = await eigenpalSave(afterLibreOffice);
  const baseline = await captureDocxState(stableSave, bindings, clauses, true);

  for (const action of ['duplicate', 'delete'] as const) {
    const changed = await editClauseEndMarker(stableSave, clauses[1], action);
    await assert.rejects(verifyDocxReasoning(changed, options), /Repère de fin .* absent ou dupliqué/u);
  }

  const moved = await editClauseEndMarker(stableSave, clauses[1], 'move');
  const movedState = await captureDocxState(moved, bindings, clauses, true);
  assert.equal(movedState.body, baseline.body);
  const result = await verifyDocxReasoning(moved, options);
  assert.equal(result.status, 'à revoir');
  assert.deepEqual(result.changed, [clauses[1]]);
  assert.equal(result.verification, null);
});

test('un champ DATE simple au résultat mis en cache ne fournit pas une date figée', async () => {
  const input = await mutate(await fixture(), (xml) => xml.replace(
    '<w:r><w:t xml:space="preserve">30</w:t></w:r>',
    '<w:fldSimple w:instr=" DATE \\@ &quot;yyyy-MM-dd&quot; "><w:r><w:t>2026-10-20</w:t></w:r></w:fldSimple>',
  ));
  await assert.rejects(
    captureDocxState(input, [{ tag: 'pm:jours', valeur: 'dateScenario', type: 'date' }], []),
    /Date ISO invalide/u,
  );
});
