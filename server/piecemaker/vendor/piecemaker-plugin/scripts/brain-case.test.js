const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, 'lib', 'brain-case.mjs')).href);

function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'brain-case-')));
  const home = path.join(base, 'home');
  const brain = path.join(base, 'brain');
  const dossier = path.join(base, 'Dossier Dupont');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(dossier, '.piecemaker', 'memoires'), { recursive: true });
  fs.writeFileSync(path.join(home, 'brain.json'), JSON.stringify({ path: brain }));
  return { base, home, brain, dossier, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('les anciens fichiers du dossier passent dans Roadmap.json et About.md, une seule fois', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const { caseOf, readRoadmap, sections } = await load();
  const technical = path.join(f.dossier, '.piecemaker');
  fs.writeFileSync(path.join(technical, 'appel-suivi.json'), JSON.stringify({ echeances: { 'appel': { intitule: 'Former appel' } } }));
  fs.writeFileSync(path.join(technical, 'bail-suivi.json.supprime'), JSON.stringify({ echeances: {} }));
  fs.writeFileSync(path.join(technical, 'etapes.json'), JSON.stringify({ mappingValide: '2026-01-01' }));
  fs.writeFileSync(path.join(technical, 'memoires', 'appel.md'), 'L’avocat veut contester la date de signification.\n');
  const target = caseOf(f.dossier, { home: f.home });
  assert.equal(target.directory, path.join(f.brain, 'projects', 'Dossier Dupont'));
  const roadmap = readRoadmap(target.roadmap);
  assert.deepEqual(Object.keys(roadmap), ['etapes', 'suivis', 'suivisSupprimes']);
  assert.equal(roadmap.suivis['appel-suivi.json'].echeances.appel.intitule, 'Former appel');
  assert.deepEqual(roadmap.suivisSupprimes, { 'bail-suivi.json': { echeances: {} } });
  assert.deepEqual(sections(fs.readFileSync(target.about, 'utf8')), [{ name: 'appel', line: 3, body: 'L’avocat veut contester la date de signification.' }]);
  assert.ok(fs.existsSync(path.join(technical, 'appel-suivi.json.migre')));
  assert.ok(fs.existsSync(path.join(technical, 'memoires', 'appel.md.migre')));
  caseOf(f.dossier, { home: f.home });
  assert.equal(sections(fs.readFileSync(target.about, 'utf8')).length, 1);
});

test('deux dossiers de même nom ont chacun leur paire, et un dossier inconnu n’en reçoit pas sans création', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const { caseDirectory, caseOfBrainFile } = await load();
  const autre = path.join(f.base, 'ailleurs', 'Dossier Dupont');
  fs.mkdirSync(autre, { recursive: true });
  assert.equal(caseDirectory(f.dossier, { home: f.home }).name, 'Dossier Dupont');
  assert.equal(caseDirectory(autre, { home: f.home }).name, 'Dossier Dupont (2)');
  assert.equal(caseDirectory(path.join(f.base, 'Societe Exemple'), { home: f.home, create: false }), null);
  const found = caseOfBrainFile(path.join(f.brain, 'projects', 'Dossier Dupont (2)', 'Roadmap.json'), f.home);
  assert.deepEqual([found.folder, found.rest], [autre, 'Roadmap.json']);
});

test('le script de synthèse du dossier est modifiable et son résultat entre dans Roadmap.json', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const { caseOf, readRoadmap, runSynthese, SYNTHESE } = await load();
  const points = [
    { numero: '3°', ok: true, texte: 'Mapping : valide' },
    { numero: '4°', ok: false, texte: 'Index : 2 manque(s) → pm okf verify' },
  ];
  const calls = [];
  const pm = async (...argv) => { calls.push(argv); return 'cote\tnombre\nclient\t1\nadversaire\t2\nà qualifier\t1\n0 ligne(s) modifiée(s)'; };
  const synthese = await runSynthese(f.dossier, { points, pm }, { home: f.home });
  assert.equal(calls[0][0], 'dossier');
  assert.deepEqual(synthese.parties, { etat: 'à exécuter : 1 partie(s) à qualifier dans l’onglet Dossier', nombre: { client: 1, adversaire: 2, 'à qualifier': 1 } });
  assert.deepEqual(synthese.okf, { etat: 'à exécuter : 2 manque(s) → pm okf verify' });
  const target = caseOf(f.dossier, { home: f.home });
  assert.deepEqual(readRoadmap(target.roadmap).synthese.okf, synthese.okf);
  fs.writeFileSync(path.join(target.directory, SYNTHESE), 'export default async () => ({ echeances: { etat: "valide" } });\n');
  await runSynthese(f.dossier, { points, pm }, { home: f.home });
  assert.deepEqual(readRoadmap(target.roadmap).synthese.echeances, { etat: 'valide' });
});
