import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createEtapesService, type EtapesDependencies } from '../etapes.js';

const attendre = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const service = (etat: EtapesDependencies['etat']) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-etapes-'));
  const deps = {
    home: root,
    reasoning: { read: async () => ({}) },
    suivi: { projects: () => [{ project_id: '1', project_path: root, custom_project_name: 'Dossier Dupont' }], files: async () => [] },
    taches: { active: () => null },
    etat,
    sessionOf: () => null,
    bibliotheque: { skills: () => [], activer: () => undefined },
  } as unknown as EtapesDependencies;
  return { root, etapes: createEtapesService(deps) };
};

test('le tableau répond sans attendre le calcul de l’état du dossier', async () => {
  let calculs = 0;
  const { etapes } = service(async () => { calculs += 1; await attendre(50); return { pret: false, lignes: [{ nom: 'index', texte: 'absent', ok: false }] }; });
  const premier = await etapes.tableau();
  assert.equal((premier.cartes[0] as { preparation: { texte: string }[] }).preparation[0].texte, 'Vérification en cours…');
  await attendre(100);
  const second = await etapes.tableau();
  assert.equal((second.cartes[0] as { preparation: { texte: string }[] }).preparation[0].texte, 'absent');
  await etapes.tableau();
  assert.equal(calculs, 1);
});

test('la liste des pièces non converties est abrégée', async () => {
  const pieces = Array.from({ length: 30 }, (_, index) => `  - Pièces/piece-${index}.pdf (à convertir)`);
  const { etapes } = service(async () => ({ pret: false, lignes: [{ nom: 'conversion', texte: ['30 pièce(s) non convertie(s)', ...pieces].join('\n'), ok: false }] }));
  const { cartes } = await etapes.tableau(true);
  const texte = (cartes[0] as { preparation: { texte: string }[] }).preparation[0].texte.split('\n');
  assert.equal(texte.length, 12);
  assert.equal(texte.at(-1), '  … et 20 autre(s)');
});

test('un changement dans le dossier fait recalculer son état', async () => {
  let calculs = 0;
  const { root, etapes } = service(async () => { calculs += 1; return { pret: false, lignes: [] }; });
  await etapes.tableau(true);
  etapes.invalider(root);
  await attendre(2_100);
  assert.equal(calculs, 2);
});

test('un dossier exclu n’est plus vérifié', async () => {
  let calculs = 0;
  const { root, etapes } = service(async () => { calculs += 1; return { pret: false, lignes: [] }; });
  fs.mkdirSync(path.join(root, '.piecemaker'));
  fs.writeFileSync(path.join(root, '.piecemaker', 'etapes.json'), JSON.stringify({ nonJuridique: true }));
  const { cartes } = await etapes.tableau(true);
  assert.equal((cartes[0] as { exclu?: boolean }).exclu, true);
  etapes.invalider(root);
  await attendre(2_100);
  assert.equal(calculs, 0);
});
