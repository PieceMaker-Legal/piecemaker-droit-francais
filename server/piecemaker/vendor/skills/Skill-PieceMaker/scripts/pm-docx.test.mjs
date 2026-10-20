import assert from 'node:assert/strict';
import test from 'node:test';

import { run } from './pm.mjs';

test('docx preparer transmet ses chemins et ouvre le DOCX produit dans le volet Fichiers', async () => {
  const calls = [];
  const panels = [];
  const result = await run([
    'docx', 'preparer', '--fichier', 'source.docx', '--liens', 'liens.json', '--sortie', 'resultat.docx', '--modele', 'modele.js', '--dossier', '/dossier-fictif',
  ], {
    cwd: '/ailleurs',
    deps: {
      docxFn: async (input) => { calls.push(input); return { fichier: 'resultat.docx', canonique: 'docx' }; },
      openPanel: async (request) => { panels.push(request); return { id: 'panel-1' }; },
    },
  });

  assert.deepEqual(calls, [{
    commande: 'preparer', cwd: '/dossier-fictif', fichier: 'source.docx', liens: 'liens.json', sortie: 'resultat.docx', modele: 'modele.js',
  }]);
  assert.deepEqual(panels, [{ project: '/dossier-fictif', tab: 'files', document: '/dossier-fictif/resultat.docx' }]);
  assert.equal(result, '{"fichier":"resultat.docx","canonique":"docx"}\nVisible : Fichiers (resultat.docx).');
});

test('docx verifier, comparer et extraire transmettent les commandes sans ouvrir un volet', async () => {
  const calls = [];
  const panels = [];
  const deps = {
    docxFn: async (input) => { calls.push(input); return { commande: input.commande }; },
    openPanel: async (request) => { panels.push(request); return { id: 'panel-2' }; },
  };

  assert.equal(await run(['docx', 'verifier', '--fichier', 'liaison.docx', '--dossier', '/dossier-fictif'], { cwd: '/ailleurs', deps }), '{"commande":"verifier"}');
  assert.equal(await run(['docx', 'comparer', '--fichier', 'liaison.docx', '--modele', 'copie.js', '--dossier', '/dossier-fictif'], { cwd: '/ailleurs', deps }), '{"commande":"comparer"}');
  assert.equal(await run(['docx', 'extraire', '--fichier', 'liaison.docx', '--sortie', 'extrait.js', '--dossier', '/dossier-fictif'], { cwd: '/ailleurs', deps }), '{"commande":"extraire"}');

  assert.deepEqual(calls, [
    { commande: 'verifier', cwd: '/dossier-fictif', fichier: 'liaison.docx' },
    { commande: 'comparer', cwd: '/dossier-fictif', fichier: 'liaison.docx', modele: 'copie.js' },
    { commande: 'extraire', cwd: '/dossier-fictif', fichier: 'liaison.docx', sortie: 'extrait.js' },
  ]);
  assert.deepEqual(panels, []);
});

test('docx signale les arguments obligatoires et les commandes inconnues', async () => {
  await assert.rejects(run(['docx', 'preparer', '--fichier', 'source.docx'], { cwd: '/dossier-fictif', deps: { docxFn: async () => ({}) } }), (error) => error.exitCode === 2 && /--liens/u.test(error.message));
  await assert.rejects(run(['docx', 'extraire', '--fichier', 'source.docx'], { cwd: '/dossier-fictif', deps: { docxFn: async () => ({}) } }), (error) => error.exitCode === 2 && /--sortie/u.test(error.message));
  await assert.rejects(run(['docx', 'verifier'], { cwd: '/dossier-fictif', deps: { docxFn: async () => ({}) } }), (error) => error.exitCode === 2 && /--fichier/u.test(error.message));
  await assert.rejects(run(['docx', 'mettre-a-jour', '--fichier', 'source.docx'], { cwd: '/dossier-fictif', deps: { docxFn: async () => ({}) } }), (error) => error.exitCode === 2 && /preparer, verifier, comparer ou extraire/u.test(error.message));
});
