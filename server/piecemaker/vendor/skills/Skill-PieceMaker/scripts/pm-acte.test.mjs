import assert from 'node:assert/strict';
import test from 'node:test';

import { run } from './pm.mjs';

test('acte exporter transmet la sortie et le modèle puis ouvre le DOCX', async () => {
  const calls = [];
  const panels = [];
  const result = await run(['acte', 'exporter', '--sortie', 'conclusions.docx', '--modele', 'cabinet.docx', '--dossier', '/dossier-fictif'], {
    cwd: '/ailleurs',
    deps: { acteFn: async (input) => { calls.push(input); return { fichier: 'conclusions.docx', sections: 3 }; }, openPanel: async (request) => { panels.push(request); return { id: 'p' }; } },
  });
  assert.deepEqual(calls, [{ commande: 'exporter', cwd: '/dossier-fictif', sortie: 'conclusions.docx', modele: 'cabinet.docx' }]);
  assert.deepEqual(panels, [{ project: '/dossier-fictif', tab: 'files', document: '/dossier-fictif/conclusions.docx' }]);
  assert.match(result, /^\{"fichier":"conclusions.docx","sections":3\}/);
});

test('acte fusionner renvoie le rapport puis le retour du vérificateur', async () => {
  const result = await run(['acte', 'fusionner', '--fichier', 'conclusions.docx', '--dossier', '/dossier-fictif'], {
    cwd: '/ailleurs',
    deps: { acteFn: async () => ({ rapport: { reprises: ['s2'] }, verification: 'Aucune erreur, aucun manque.' }), openPanel: async () => ({ id: 'p' }) },
  });
  assert.match(result, /^\{"rapport":\{"reprises":\["s2"\]\}\}\nAucune erreur, aucun manque\./);
});

test('acte refuse une commande inconnue ou un fichier manquant', async () => {
  await assert.rejects(run(['acte', 'imprimer'], { cwd: '/d', deps: { acteFn: async () => ({}) } }), (error) => error.exitCode === 2 && /exporter, fusionner ou importer/.test(error.message));
  await assert.rejects(run(['acte', 'importer'], { cwd: '/d', deps: { acteFn: async () => ({}) } }), (error) => error.exitCode === 2 && /--fichier/.test(error.message));
});
