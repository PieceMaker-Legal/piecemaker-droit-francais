import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import express from 'express';
import JSZip from 'jszip';

import { DOCX_REASONING_PART, readDocxReasoning } from '../docx-reasoning.js';
import { checkDocxReasoning } from '../docx-reasoning-check.js';
import { runDocxReasoningAction } from '../docx-reasoning-files.js';
import { createDocxReasoningLocalRouter } from '../docx-reasoning-local.js';

import { code, fixture } from './docx-reasoning-fixture.js';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const links = {
  clauses: [{ tag: 'pm:clause-prix', paragraphes: ['Le prix convenu est de 12 000 EUR, payable après réception.'] }],
  valeurs: [{ tag: 'pm:prix', valeur: 'prix', type: 'nombre' as const, texte: '12 000 EUR', clause: 'pm:clause-prix' }],
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

async function withProject(run: (root: string) => Promise<void>) {
  const parent = await mkdtemp(path.join(tmpdir(), 'docx-reasoning-files-'));
  const root = path.join(parent, 'project');
  await mkdir(path.join(root, '.piecemaker', 'raisonnements'), { recursive: true });
  try { await run(root); }
  finally { await rm(parent, { recursive: true, force: true }); }
}

async function prepareFiles(root: string, file = 'ordinary.docx') {
  await writeFile(path.join(root, file), await plainFixture());
  await writeFile(path.join(root, '.piecemaker', 'raisonnements', 'penalite.yaml'), code);
  await writeFile(path.join(root, 'liens.json'), JSON.stringify(links));
}

async function withLocalApi(run: (base: string, root: string) => Promise<void>) {
  await withProject(async (root) => {
    await writeFile(path.join(root, 'linked.docx'), await fixture());
    await writeFile(path.join(root, 'ordinary.docx'), await plainFixture());
    await writeFile(path.join(root, '.piecemaker', 'raisonnements', 'penalite.yaml'), code);
    await writeFile(path.join(root, 'liens.json'), JSON.stringify(links));
    const app = express();
    app.use('/api', createDocxReasoningLocalRouter({ getProjectPath: (folder) => folder === root ? root : null }, (request) => request.get('x-test-local') !== 'false'));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Local test server address unavailable.');
      await run(`http://127.0.0.1:${address.port}/api`, root);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
}

async function post(base: string, body: Record<string, unknown>, local = true) {
  const response = await fetch(`${base}/docx-reasoning`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-test-local': String(local) }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

test('prépare vers une nouvelle sortie avec un modèle externe, compare sa référence et extrait son code exact', async () => {
  await withProject(async (root) => {
    await prepareFiles(root);
    const modelPath = path.join(root, '.piecemaker', 'raisonnements', 'penalite.yaml');
    const sourceHash = hash(await readFile(modelPath, 'utf8'));
    const prepared = await runDocxReasoningAction({
      commande: 'preparer', cwd: root, fichier: 'ordinary.docx', liens: 'liens.json', sortie: 'linked.docx',
    });
    assert.deepEqual(prepared, { fichier: 'linked.docx', canonique: 'dossier', modele: '.piecemaker/raisonnements/penalite.yaml', modele_dossier_modifie: false, empreinte_modele: sourceHash });
    const documentModel = await readDocxReasoning(await readFile(path.join(root, 'linked.docx')));
    assert.equal(documentModel.version, 2);
    assert.equal(documentModel.code, undefined);
    assert.deepEqual(documentModel.reference, { path: '.piecemaker/raisonnements/penalite.yaml', sha256: sourceHash });
    assert.equal(hash(await readFile(modelPath, 'utf8')), sourceHash);

    const same = await runDocxReasoningAction({ commande: 'comparer', cwd: root, fichier: 'linked.docx' });
    assert.deepEqual(same, { canonique: 'dossier', etat: 'identique', identique: true, empreinte_docx: sourceHash, empreinte_dossier: sourceHash });
    const verified = await runDocxReasoningAction({ commande: 'verifier', cwd: root, fichier: 'linked.docx' });
    assert.deepEqual(verified, await checkDocxReasoning(await readFile(path.join(root, 'linked.docx')), root));

    const extracted = await runDocxReasoningAction({ commande: 'extraire', cwd: root, fichier: 'linked.docx', sortie: 'extraite.yaml' });
    assert.deepEqual(extracted, { fichier: 'extraite.yaml', canonique: 'dossier', empreinte_modele: sourceHash });
    assert.equal(await readFile(path.join(root, 'extraite.yaml'), 'utf8'), code);

    await writeFile(modelPath, `${code}\n`);
    const divergent = await runDocxReasoningAction({ commande: 'comparer', cwd: root, fichier: 'linked.docx' });
    assert.ok('etat' in divergent);
    assert.equal(divergent.etat, 'divergent');
    assert.equal(divergent.identique, false);
    assert.equal(divergent.empreinte_docx, sourceHash);
    assert.equal(divergent.empreinte_dossier, hash(`${code}\n`));
    assert.deepEqual(await runDocxReasoningAction({ commande: 'verifier', cwd: root, fichier: 'linked.docx' }), {
      status: 'error', message: 'Modèle externe modifié : la version liée au document doit être réexaminée.', sources: 'offline',
    });
    await assert.rejects(runDocxReasoningAction({ commande: 'extraire', cwd: root, fichier: 'linked.docx', sortie: 'modified-extraction.yaml' }), /Modèle externe modifié/u);
    await assert.rejects(readFile(path.join(root, 'modified-extraction.yaml')), { code: 'ENOENT' });
    assert.equal(await readFile(modelPath, 'utf8'), `${code}\n`);
    assert.deepEqual(await runDocxReasoningAction({ commande: 'comparer', cwd: root, fichier: 'linked.docx', modele: 'absent.yaml' }), {
      canonique: 'dossier', etat: 'modele_dossier_absent', identique: false, empreinte_docx: sourceHash,
    });
  });
});

test('une sortie déjà présente ne peut pas être écrasée par la préparation ni l’extraction', async () => {
  await withProject(async (root) => {
    await prepareFiles(root);
    const existingDocx = Buffer.from('existing DOCX bytes');
    await writeFile(path.join(root, 'present.docx'), existingDocx);
    await assert.rejects(runDocxReasoningAction({
      commande: 'preparer', cwd: root, fichier: 'ordinary.docx', liens: 'liens.json', sortie: 'present.docx',
    }), { code: 'EEXIST' });
    assert.deepEqual(await readFile(path.join(root, 'present.docx')), existingDocx);

    await runDocxReasoningAction({ commande: 'preparer', cwd: root, fichier: 'ordinary.docx', liens: 'liens.json', sortie: 'linked.docx' });
    const existingCode = 'existing model';
    await writeFile(path.join(root, 'present.yaml'), existingCode);
    await assert.rejects(runDocxReasoningAction({ commande: 'extraire', cwd: root, fichier: 'linked.docx', sortie: 'present.yaml' }), { code: 'EEXIST' });
    assert.equal(await readFile(path.join(root, 'present.yaml'), 'utf8'), existingCode);
  });
});

test('refuse les chemins hors dossier, les liens symboliques sortants et les chemins .env sans les lire', async () => {
  await withProject(async (root) => {
    await prepareFiles(root);
    await assert.rejects(runDocxReasoningAction({ commande: 'verifier', cwd: root, fichier: '../outside.docx' }), /Chemin refusé/u);
    await assert.rejects(runDocxReasoningAction({ commande: 'verifier', cwd: root, fichier: '.env.docx' }), /Chemin refusé/u);
    await assert.rejects(runDocxReasoningAction({ commande: 'preparer', cwd: root, fichier: 'ordinary.docx', liens: '.env.json', sortie: 'linked.docx' }), /Chemin refusé/u);
    await assert.rejects(runDocxReasoningAction({ commande: 'preparer', cwd: root, fichier: 'ordinary.docx', liens: 'liens.json', sortie: 'linked.docx', modele: '.env.yaml' }), /Chemin refusé/u);
    await assert.rejects(runDocxReasoningAction({ commande: 'preparer', cwd: root, fichier: 'ordinary.docx', liens: 'liens.json', sortie: '.env.docx' }), /Chemin refusé/u);
    await assert.rejects(runDocxReasoningAction({ commande: 'preparer', cwd: root, fichier: 'ordinary.docx', liens: 'liens.json', sortie: 'nested/missing.docx' }), /ENOENT/u);

    const outside = path.join(path.dirname(root), 'outside.docx');
    await writeFile(outside, await fixture());
    await symlink(outside, path.join(root, 'escape.docx'));
    await assert.rejects(runDocxReasoningAction({ commande: 'verifier', cwd: root, fichier: 'escape.docx' }), /Lien symbolique hors du dossier/u);
  });
});

test('la route locale vérifie le statut loopback et l’enregistrement du dossier', async () => {
  await withLocalApi(async (base, root) => {
    const remote = await post(base, { commande: 'verifier', cwd: root, fichier: 'linked.docx' }, false);
    assert.equal(remote.status, 403);
    assert.deepEqual(remote.body, { erreur: 'Réservé aux appels locaux.' });

    const unknown = await post(base, { commande: 'verifier', cwd: path.join(root, 'unknown'), fichier: 'linked.docx' });
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.body, { erreur: 'Dossier non enregistré.' });

    const response = await post(base, { commande: 'verifier', cwd: root, fichier: 'linked.docx' });
    assert.equal(response.status, 200);
    assert.equal(response.body.resultat.status, 'tested');
    assert.equal(response.body.resultat.sources, 'offline');

    const prepared = await post(base, {
      commande: 'preparer', cwd: root, fichier: 'ordinary.docx', liens: 'liens.json', sortie: 'api-linked.docx',
    });
    assert.equal(prepared.status, 200);
    assert.equal(prepared.body.resultat.fichier, 'api-linked.docx');
    assert.equal(prepared.body.resultat.canonique, 'dossier');
    assert.equal(prepared.body.resultat.modele, '.piecemaker/raisonnements/penalite.yaml');
    const apiModel = await readDocxReasoning(await readFile(path.join(root, 'api-linked.docx')));
    assert.equal(apiModel.version, 2);
    assert.equal(apiModel.code, undefined);

    const saved = await readFile(path.join(root, 'api-linked.docx'));
    const conflict = await post(base, {
      commande: 'preparer', cwd: root, fichier: 'ordinary.docx', liens: 'liens.json', sortie: 'api-linked.docx',
    });
    assert.equal(conflict.status, 409);
    assert.deepEqual(await readFile(path.join(root, 'api-linked.docx')), saved);
  });
});

