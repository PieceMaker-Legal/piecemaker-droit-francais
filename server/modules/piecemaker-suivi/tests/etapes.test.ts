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
    suivi: { projects: () => [{ project_id: '1', project_path: root, custom_project_name: 'Dossier Dupont' }], files: async () => [] },
    taches: { active: () => null },
    etat,
    sessionOf: () => null,
    bibliotheque: { skills: () => [], activer: () => undefined },
  } as unknown as EtapesDependencies;
  return { root, deps, etapes: createEtapesService(deps) };
};

test('le tableau répond sans attendre le calcul de l’état du dossier', async () => {
  let calculs = 0;
  const { etapes } = service(async () => { calculs += 1; await attendre(50); return { pret: false, lignes: [{ nom: 'index', texte: 'absent', ok: false }] }; });
  const premier = await etapes.tableau();
  assert.deepEqual((premier.cartes[0] as { preparation: unknown[] }).preparation, []);
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

test('une vérification en échec garde le dernier état valide, même après un redémarrage', async () => {
  let echec = false;
  const etat: EtapesDependencies['etat'] = async () => {
    if (echec) throw new Error('Tabular Review indisponible');
    return { pret: false, lignes: [{ nom: 'index', texte: 'absent', ok: false }] };
  };
  const { root, etapes } = service(etat);
  await etapes.tableau(true);
  echec = true;
  etapes.invalider(root);
  await attendre(2_100);
  const apres = await etapes.tableau(true);
  assert.equal((apres.cartes[0] as { preparation: { texte: string }[] }).preparation[0].texte, 'absent');
  const redemarre = createEtapesService({
    home: root,
    suivi: { projects: () => [{ project_id: '1', project_path: root, custom_project_name: 'Dossier Dupont' }], files: async () => [] },
    taches: { active: () => null },
    etat,
    sessionOf: () => null,
    bibliotheque: { skills: () => [], activer: () => undefined },
  } as unknown as EtapesDependencies);
  const { cartes } = await redemarre.tableau(true);
  assert.equal((cartes[0] as { preparation: { texte: string }[] }).preparation[0].texte, 'absent');
});

const ajouterRaisonnement = (root: string, nom = 'demande') => {
  const directory = path.join(root, '.piecemaker', 'catala', nom);
  fs.mkdirSync(path.join(directory, 'resultats'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'clerk.toml'), '[project]\n');
  fs.writeFileSync(path.join(directory, 'tache.json'), JSON.stringify({ tache: 'Demande de paiement' }));
  fs.writeFileSync(path.join(directory, 'resultats', 'verification.json'), JSON.stringify({ checks: [{ name: 'tests', status: 'failed', message: 'Test en échec' }, { name: 'typage', status: 'passed', message: '' }] }));
};

test('la prochaine action du suivi reste disponible en Attente', async () => {
  const { root, deps, etapes } = service(async () => ({ pret: true, lignes: [] }));
  ajouterRaisonnement(root);
  deps.suivi.files = async () => ['suivi.json'];
  deps.suivi.read = async () => ({ echeances: [], code: JSON.stringify({ matter: { nextStep: 'Attendre la réponse' } }) }) as never;
  await etapes.raisonnement({ projectPath: root, raisonnement: 'demande', etape: 'attente' });
  assert.deepEqual((await etapes.tableau(true)).cartes[0].action, { texte: 'Attendre la réponse', fait: false });
  await etapes.raisonnement({ projectPath: root, raisonnement: 'demande', action: { fait: true } });
  assert.equal((await etapes.tableau(true)).cartes[0].etape, 'attente');
});

test('un scan postérieur périme la validation du mapping sans perdre l’étape enregistrée', async () => {
  const { root, etapes } = service(async () => ({ pret: true, lignes: [] }));
  const validated = await etapes.dossier({ projectPath: root, mappingValide: true, etape: 'attente' });
  assert.ok(validated.mappingValide);
  fs.writeFileSync(path.join(root, '.piecemaker', 'anonymization-state.json'), JSON.stringify({ files: { 'piece-fictive.pdf': { scanned: { updatedAt: new Date(Date.now() + 60_000).toISOString() } } } }));
  const current = await etapes.lire(root);
  assert.equal(current.mappingValide, undefined);
  assert.equal(current.etape, 'attente');
});

test('chaque nouveau document évite fichiers existants et chemins réservés par toutes les versions', async () => {
  const { root, etapes } = service(async () => ({ pret: true, lignes: [] }));
  ajouterRaisonnement(root);
  fs.mkdirSync(path.join(root, 'Projets'));
  fs.writeFileSync(path.join(root, 'Projets', 'Projet.docx'), 'octets antérieurs');
  const premier = await etapes.raisonnement({ projectPath: root, raisonnement: 'demande', documents: [{ type: 'Courrier', nom: 'Projet' }, { type: 'Courrier', nom: 'Projet' }] });
  const ancien = premier.documents![0].chemin;
  assert.notEqual(ancien, 'Projets/Projet.docx');
  assert.notEqual(premier.documents![1].chemin, ancien);
  fs.writeFileSync(path.join(root, ancien), 'version finalisée');
  const next = await etapes.reprise({ projectPath: root, raisonnement: 'demande' });
  const nouveau = await etapes.raisonnement({ projectPath: root, raisonnement: next.raisonnement, documents: [{ type: 'Courrier', nom: 'Projet', chemin: ancien }] });
  assert.notEqual(nouveau.documents![0].chemin, ancien);
  fs.writeFileSync(path.join(root, nouveau.documents![0].chemin), 'nouvelle version');
  assert.equal(fs.readFileSync(path.join(root, ancien), 'utf8'), 'version finalisée');
  assert.equal(fs.readFileSync(path.join(root, 'Projets', 'Projet.docx'), 'utf8'), 'octets antérieurs');
});

test('deux reprises concurrentes gardent deux versions distinctes et leur historique', async () => {
  const { root, deps, etapes } = service(async () => ({ pret: true, lignes: [] }));
  ajouterRaisonnement(root);
  const suivi = JSON.stringify({ matter: { nextStep: 'Attendre la réponse' } });
  fs.writeFileSync(path.join(root, '.piecemaker', 'demande-suivi.json'), suivi);
  deps.suivi.files = async () => fs.readdirSync(path.join(root, '.piecemaker')).filter((file) => file.endsWith('-suivi.json'));
  const versions = await Promise.all([etapes.reprise({ projectPath: root, raisonnement: 'demande' }), etapes.reprise({ projectPath: root, raisonnement: 'demande' })]);
  assert.deepEqual(versions.map((entry) => entry.raisonnement).sort(), ['demande-v2', 'demande-v3']);
  for (const nom of ['demande', 'demande-v2', 'demande-v3']) assert.equal(fs.readFileSync(path.join(root, '.piecemaker', `${nom}-suivi.json`), 'utf8'), suivi);
  const etat = await etapes.lire(root);
  assert.equal(etat.raisonnements?.['demande-v3'].precedent, 'demande-v2');
  assert.equal(fs.readFileSync(path.join(root, '.piecemaker', 'catala', 'demande-v3', 'clerk.toml'), 'utf8'), '[project]\n');
  assert.equal(fs.existsSync(path.join(root, '.piecemaker', 'catala', 'demande-v3', 'resultats')), false);
});

test('une préparation incomplète ne bloque pas l’étape choisie', async () => {
  const { root, etapes } = service(async () => ({ pret: false, lignes: [{ nom: 'index', texte: 'Index', ok: false }] }));
  ajouterRaisonnement(root);
  await etapes.raisonnement({ projectPath: root, raisonnement: 'demande', etape: 'attente' });
  const carte = (await etapes.tableau(true)).cartes[0];
  assert.equal(carte.etape, 'attente');
  assert.deepEqual(carte.raisonnement, { nom: 'demande', titre: 'Demande de paiement', qualification: null, acte: null, objectifs: ['Demande de paiement'], verifie: true, erreurs: 1, manques: 0, alertes: [{ kind: 'erreur', texte: 'Test en échec' }] });
  await etapes.raisonnement({ projectPath: root, raisonnement: 'demande', etape: 'preparation' });
  assert.equal(((await etapes.tableau(true)).cartes[0].preparation as unknown[]).length, 1);
});

test('un dossier sans programme Catala peut être déplacé partout et exclu sans en créer', async () => {
  let pret = true;
  const { root, etapes } = service(async () => ({ pret, lignes: [] }));
  for (const etape of ['preparation', 'raisonnement', 'redaction', 'finalisation', 'attente', 'clos']) {
    await etapes.dossier({ projectPath: root, etape });
    assert.equal((await etapes.tableau(true)).cartes[0].etape, etape);
  }
  pret = false;
  etapes.invalider(root);
  await attendre(2100);
  assert.equal((await etapes.tableau(true)).cartes[0].etape, 'clos');
  await etapes.dossier({ projectPath: root, nonJuridique: true });
  assert.equal((await etapes.tableau(true)).cartes[0].exclu, true);
  assert.equal(fs.existsSync(path.join(root, '.piecemaker', 'catala')), false);
});

test('une reprise dont la persistance échoue retire ses nouvelles copies et permet de réessayer', async () => {
  const { root, etapes } = service(async () => ({ pret: true, lignes: [] }));
  ajouterRaisonnement(root);
  const temporaire = path.join(root, '.piecemaker', 'etapes.json.tmp');
  fs.mkdirSync(temporaire);
  await assert.rejects(etapes.reprise({ projectPath: root, raisonnement: 'demande' }));
  assert.equal(fs.existsSync(path.join(root, '.piecemaker', 'catala', 'demande-v2')), false);
  fs.rmdirSync(temporaire);
  assert.deepEqual(await etapes.reprise({ projectPath: root, raisonnement: 'demande' }), { raisonnement: 'demande-v2' });
});

test('un acte reste en cours de rédaction tant que l’avocat ne l’a pas validé', async () => {
  const { root, etapes } = service(async () => ({ pret: true, lignes: [] }));
  ajouterRaisonnement(root);
  const { documents } = await etapes.raisonnement({ projectPath: root, raisonnement: 'demande', documents: [{ type: 'Courrier', nom: 'Projet' }] });
  fs.mkdirSync(path.join(root, 'Projets'), { recursive: true });
  fs.writeFileSync(path.join(root, documents![0].chemin), 'brouillon');
  const statut = async () => ((await etapes.tableau(true)).cartes as Array<{ documents?: Array<{ statut: string }> }>).find((carte) => carte.documents?.length)!.documents![0].statut;
  assert.equal(await statut(), 'en cours');
  await etapes.raisonnement({ projectPath: root, raisonnement: 'demande', documents: [{ ...documents![0], valide: true }] });
  assert.equal(await statut(), 'validé');
  await etapes.raisonnement({ projectPath: root, raisonnement: 'demande', documents: [{ ...documents![0], valide: false }] });
  assert.equal(await statut(), 'en cours');
});
