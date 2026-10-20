import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';

import { prepareDocxReasoning } from '../docx-reasoning-prepare.js';
import { captureDocxState, DOCX_REASONING_PART, readDocxReasoning, verifyDocxReasoning } from '../docx-reasoning.js';
import { modelHash, readReferencedModel, resolveReferencedModel } from '../docx-reasoning-reference.js';

import { code, fixture } from './docx-reasoning-fixture.js';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const links = {
  clauses: [{ tag: 'pm:clause-prix', paragraphes: ['Le prix convenu est de 12 000 EUR, payable après réception.'] }],
  valeurs: [{ tag: 'pm:prix', valeur: 'prix', type: 'nombre' as const, texte: '12 000 EUR', clause: 'pm:clause-prix' }],
};
const options = {
  reliability: new Map<string, boolean>(), nature: () => null, persons: [], dismissed: new Set<string>(), online: false,
  connectors: {
    source: async () => undefined,
    match: (source: string, quote: string) => source.includes(quote) ? quote : null,
    registry: async () => { throw new Error('Registre non relu par le contrôle local.'); },
    bodacc: async () => [],
  },
};

async function plainFixture() {
  const zip = await JSZip.loadAsync(await fixture());
  zip.remove(DOCX_REASONING_PART);
  const dom = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
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

async function withReference(input: Uint8Array, change: (value: Record<string, unknown>) => Record<string, unknown>) {
  const zip = await JSZip.loadAsync(input);
  const dom = new DOMParser().parseFromString(await zip.file(DOCX_REASONING_PART)!.async('string'), 'application/xml');
  const payload = dom.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes', 'lpwstr')[0];
  payload.textContent = JSON.stringify(change(JSON.parse(payload.textContent ?? '') as Record<string, unknown>));
  zip.file(DOCX_REASONING_PART, new XMLSerializer().serializeToString(dom));
  return zip.generateAsync({ type: 'uint8array' });
}

async function withProject(run: (root: string, parent: string) => Promise<void>) {
  const parent = await mkdtemp(path.join(tmpdir(), 'docx-reasoning-reference-'));
  const root = path.join(parent, 'project');
  await mkdir(path.join(root, '.piecemaker'), { recursive: true });
  try { await run(root, parent); }
  finally { await rm(parent, { recursive: true, force: true }); }
}

test('la référence v2 stocke uniquement le chemin et le SHA-256 puis vérifie le modèle externe', async () => {
  await withProject(async (root) => {
    const modelPath = path.join(root, '.piecemaker', 'raisonnement.js');
    await writeFile(modelPath, code);
    const input = await plainFixture();
    const original = Buffer.from(input);
    const reference = { path: '.piecemaker/raisonnement.js', sha256: modelHash(code) };
    const output = await prepareDocxReasoning(input, code, links, reference);
    const model = await readDocxReasoning(output);

    assert.equal(model.version, 2);
    assert.equal(model.code, undefined);
    assert.deepEqual(model.reference, reference);
    assert.deepEqual(Buffer.from(input), original);
    assert.deepEqual(Buffer.from(await readFile(modelPath)), Buffer.from(code));
    assert.equal((await verifyDocxReasoning(output, { ...options, cwd: root })).status, 'testé');
    assert.equal((await captureDocxState(output, [], [])).pending, false);
  });
});

test('la résolution refuse une référence absente ou dont le contenu a changé', async () => {
  await withProject(async (root) => {
    const reference = { path: '.piecemaker/raisonnement.js', sha256: modelHash(code) };
    const document = await prepareDocxReasoning(await plainFixture(), code, links, reference);

    await assert.rejects(resolveReferencedModel(root, reference), /Modèle externe absent/u);
    await writeFile(path.join(root, reference.path), `${code}\n`);
    await assert.rejects(resolveReferencedModel(root, reference), /Modèle externe modifié/u);
    await assert.rejects(verifyDocxReasoning(document, { ...options, cwd: root }), /Modèle externe modifié/u);
  });
});

test('les références hors racine, les symlinks sortants et les chemins env.js sont refusés', async () => {
  await withProject(async (root, parent) => {
    const outside = path.join(parent, 'outside.js');
    await writeFile(outside, code);
    await symlink(outside, path.join(root, 'escape.js'));

    await assert.rejects(readReferencedModel(root, { path: '../outside.js', sha256: modelHash(code) }), /Chemin de modèle relatif/u);
    await assert.rejects(readReferencedModel(root, { path: 'escape.js', sha256: modelHash(code) }), /doit rester dans le dossier/u);
    await assert.rejects(readReferencedModel(root, { path: '.env.js', sha256: modelHash(code) }), /Chemin de modèle relatif/u);
    await assert.rejects(readReferencedModel(root, { path: '.piecemaker/.env.local.js', sha256: modelHash(code) }), /Chemin de modèle relatif/u);
  });
});

test('les métadonnées v2 mixtes, les empreintes fausses et les chemins Windows sont refusés', async () => {
  await withProject(async (root) => {
    const reference = { path: '.piecemaker/raisonnement.js', sha256: modelHash(code) };
    const document = await prepareDocxReasoning(await plainFixture(), code, links, reference);
    const mixed = await withReference(document, (model) => ({ ...model, code }));
    const badHash = await withReference(document, (model) => ({
      ...model,
      reference: { ...(model.reference as Record<string, unknown>), sha256: 'f'.repeat(64) },
    }));
    const malformedHash = await withReference(document, (model) => ({
      ...model,
      reference: { ...(model.reference as Record<string, unknown>), sha256: 'not-a-sha256' },
    }));
    const drivePath = await withReference(document, (model) => ({
      ...model,
      reference: { ...(model.reference as Record<string, unknown>), path: 'C:/outside/raisonnement.js' },
    }));

    await writeFile(path.join(root, reference.path), code);
    await assert.rejects(readDocxReasoning(mixed), /Modèle DOCX invalide/u);
    await assert.rejects(verifyDocxReasoning(badHash, { ...options, cwd: root }), /Modèle externe modifié/u);
    await assert.rejects(readDocxReasoning(malformedHash), /Référence/u);
    await assert.rejects(readDocxReasoning(drivePath), /Chemin/u);
    assert.equal((await readDocxReasoning(document)).version, 2);
  });
});

test('la lecture du modèle ne l’exécute pas et déplacer le DOCX ou le dossier conserve la référence relative', async () => {
  await withProject(async (root, parent) => {
    const modelPath = path.join(root, '.piecemaker', 'raisonnement.js');
    await writeFile(modelPath, code);
    const document = await prepareDocxReasoning(await plainFixture(), code, links, {
      path: '.piecemaker/raisonnement.js', sha256: modelHash(code),
    });
    const documentPath = path.join(root, 'linked.docx');
    await writeFile(documentPath, document);
    await mkdir(path.join(root, 'archive'));
    await rename(documentPath, path.join(root, 'archive', 'linked.docx'));
    assert.equal((await verifyDocxReasoning(await readFile(path.join(root, 'archive', 'linked.docx')), { ...options, cwd: root })).status, 'testé');

    const movedRoot = path.join(parent, 'renamed-project');
    await rename(root, movedRoot);
    assert.equal((await verifyDocxReasoning(await readFile(path.join(movedRoot, 'archive', 'linked.docx')), { ...options, cwd: movedRoot })).status, 'testé');

    const executablePath = path.join(movedRoot, 'read-only.js');
    const marker = '__external_model_read_test__';
    delete (globalThis as Record<string, unknown>)[marker];
    await writeFile(executablePath, `globalThis.${marker} = true;`);
    const read = await readReferencedModel(movedRoot, { path: 'read-only.js', sha256: modelHash(`globalThis.${marker} = true;`) });
    assert.equal(read.code, `globalThis.${marker} = true;`);
    assert.equal((globalThis as Record<string, unknown>)[marker], undefined);
  });
});

test('la vérification refuse un modèle modifié pendant son exécution', async () => {
  await withProject(async (root) => {
    const modelPath = path.join(root, '.piecemaker', 'raisonnement.js');
    await writeFile(modelPath, code);
    const document = await prepareDocxReasoning(await plainFixture(), code, links, {
      path: '.piecemaker/raisonnement.js', sha256: modelHash(code),
    });
    let matches = 0;
    await assert.rejects(verifyDocxReasoning(document, {
      ...options,
      cwd: root,
      connectors: {
        ...options.connectors,
        match: (source: string, quote: string) => {
          matches++;
          if (matches === 1) writeFileSync(modelPath, `${code}\n`);
          return source.includes(quote) ? quote : null;
        },
      },
    }), /Modèle externe modifié/u);
    assert.ok(matches > 0);
  });
});
