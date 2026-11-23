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

test('les anciens fichiers du dossier passent dans goals/<goal>/, une seule fois', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const { caseOf, readRoadmap } = await load();
  const technical = path.join(f.dossier, '.piecemaker');
  fs.writeFileSync(path.join(technical, 'appel-suivi.json'), JSON.stringify({ echeances: { 'appel': { intitule: 'Former appel' } } }));
  fs.writeFileSync(path.join(technical, 'bail-suivi.json.supprime'), JSON.stringify({ echeances: {} }));
  fs.writeFileSync(path.join(technical, 'etapes.json'), JSON.stringify({ mappingValide: '2026-01-01', raisonnements: { appel: { etape: 'redaction' } } }));
  fs.writeFileSync(path.join(technical, 'memoires', 'appel.md'), 'L’avocat veut contester la date de signification.\n');
  const target = caseOf(f.dossier, { home: f.home, create: true });
  assert.equal(target.directory, path.join(f.brain, 'projects', 'Dossier Dupont'));
  const roadmap = readRoadmap(target.roadmap);
  assert.deepEqual(Object.keys(roadmap), ['etapes', 'suivis', 'suivisSupprimes']);
  assert.equal(roadmap.suivis['appel-suivi.json'].echeances.appel.intitule, 'Former appel');
  assert.deepEqual(roadmap.suivisSupprimes, { 'bail-suivi.json': { echeances: {} } });
  const goal = path.join(target.directory, 'goals', 'appel');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(goal, 'Timeline.json'), 'utf8')), { actes: { appel: { etape: 'redaction' } }, echeances: { appel: { intitule: 'Former appel' } } });
  assert.equal(fs.readFileSync(path.join(goal, 'Memory.md'), 'utf8'), 'L’avocat veut contester la date de signification.\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(target.roadmap, 'utf8')), { mappingValide: '2026-01-01', suivisSupprimes: { 'bail-suivi.json': { echeances: {} } } });
  assert.ok(fs.existsSync(path.join(technical, 'appel-suivi.json.migre')));
  assert.ok(fs.existsSync(path.join(technical, 'memoires', 'appel.md.migre')));
  caseOf(f.dossier, { home: f.home, create: true });
  assert.equal(readRoadmap(target.roadmap).suivis['appel-suivi.json'].echeances.appel.intitule, 'Former appel');
});

test('une Roadmap.json et les mémoires d’About.md passent dans goals/<goal>/', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const { caseDirectory, caseOf, readRoadmap } = await load();
  const directory = caseDirectory(f.dossier, { home: f.home, create: true }).directory;
  fs.writeFileSync(path.join(directory, 'Roadmap.json'), JSON.stringify({ etapes: { etape: 'redaction', raisonnements: { bail: { etape: 'raisonnement' } } }, suivis: { 'suivi.json': { matter: { client: 'Jean Dupont' } } } }));
  fs.writeFileSync(path.join(directory, 'About.md'), '# Dossier Dupont\n\n## Ce que c’est\n\nUn bail.\n\n## Mémoire : bail\n\nClause résolutoire à vérifier.\n\n## Décisions\n\nAucune.\n');
  const target = caseOf(f.dossier, { home: f.home, create: true });
  assert.deepEqual(readRoadmap(target.roadmap), { etapes: { etape: 'redaction', raisonnements: { bail: { etape: 'raisonnement' } } }, suivis: { 'suivi.json': { matter: { client: 'Jean Dupont' } } } });
  assert.ok(fs.existsSync(path.join(directory, 'goals', 'principal', 'Timeline.json')));
  assert.equal(fs.readFileSync(path.join(directory, 'goals', 'bail', 'Memory.md'), 'utf8'), 'Clause résolutoire à vérifier.\n');
  assert.equal(fs.readFileSync(target.about, 'utf8'), '# Dossier Dupont\n\n## Ce que c’est\n\nUn bail.\n\n## Décisions\n\nAucune.\n');
  assert.ok(fs.existsSync(path.join(directory, 'Roadmap.json.migre')));
});

test('une nouvelle version d’acte reste dans le goal de son acte, et un suivi supprimé vide son Timeline.json', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const { caseOf, readRoadmap, updateRoadmap } = await load();
  const target = caseOf(f.dossier, { home: f.home, create: true });
  fs.mkdirSync(path.join(target.goals, 'contentieux'), { recursive: true });
  fs.writeFileSync(path.join(target.goals, 'contentieux', 'Timeline.json'), JSON.stringify({ actes: { assignation: { etape: 'redaction' } }, echeances: {} }));
  updateRoadmap(target.roadmap, (roadmap) => { roadmap.etapes.raisonnements['assignation-v2'] = { etape: 'preparation', precedent: 'assignation' }; });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(target.goals, 'contentieux', 'Timeline.json'), 'utf8')).actes), ['assignation', 'assignation-v2']);
  updateRoadmap(target.roadmap, (roadmap) => { roadmap.etapes.raisonnements = {}; delete roadmap.suivis; });
  assert.equal(fs.readFileSync(path.join(target.goals, 'contentieux', 'Timeline.json'), 'utf8'), '{}\n');
  assert.deepEqual(readRoadmap(target.roadmap), {});
});

test('deux dossiers de même nom ont chacun leur paire, et un dossier inconnu n’en reçoit pas sans création', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const { caseDirectory, caseOfBrainFile } = await load();
  const autre = path.join(f.base, 'ailleurs', 'Dossier Dupont');
  fs.mkdirSync(autre, { recursive: true });
  assert.equal(caseDirectory(f.dossier, { home: f.home, create: true }).name, 'Dossier Dupont');
  assert.equal(caseDirectory(autre, { home: f.home, create: true }).name, 'Dossier Dupont (2)');
  assert.equal(caseDirectory(path.join(f.base, 'Societe Exemple'), { home: f.home, create: false }), null);
  const found = caseOfBrainFile(path.join(f.brain, 'projects', 'Dossier Dupont (2)', 'goals', 'bail', 'Timeline.json'), f.home);
  assert.deepEqual([found.folder, found.rest], [autre, 'goals/bail/Timeline.json']);
});

test('le script de synthèse du dossier est modifiable et son résultat entre dans Timeline.json', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const { caseOf, readRoadmap, runSynthese, SYNTHESE } = await load();
  const points = [
    { numero: '3°', ok: true, texte: 'Mapping : valide' },
    { numero: '4°', ok: false, texte: 'Index : 2 manque(s) → pm okf verify' },
  ];
  const calls = [];
  const pm = async (...argv) => { calls.push(argv); return 'cote\tnombre\nclient\t1\nadversaire\t2\nà qualifier\t1\n0 ligne(s) modifiée(s)'; };
  const synthese = await runSynthese(f.dossier, { points, pm }, { home: f.home, create: true });
  assert.equal(calls[0][0], 'dossier');
  assert.deepEqual(synthese.parties, { etat: 'à exécuter : 1 partie(s) à qualifier dans l’onglet Dossier', nombre: { client: 1, adversaire: 2, 'à qualifier': 1 } });
  assert.deepEqual(synthese.okf, { etat: 'à exécuter : 2 manque(s) → pm okf verify' });
  const target = caseOf(f.dossier, { home: f.home, create: true });
  assert.deepEqual(readRoadmap(target.roadmap).synthese.okf, synthese.okf);
  fs.writeFileSync(path.join(target.directory, SYNTHESE), 'export default async () => ({ echeances: { etat: "valide" } });\n');
  await runSynthese(f.dossier, { points, pm }, { home: f.home, create: true });
  assert.deepEqual(readRoadmap(target.roadmap).synthese.echeances, { etat: 'valide' });
});
