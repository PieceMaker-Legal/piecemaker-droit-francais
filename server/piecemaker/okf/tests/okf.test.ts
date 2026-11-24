import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { bundleRoot, linksOf, readTypes } from '../bundle.js';
import { createOkfBackend, parseValidation, premiseDate } from '../index.js';
import { renderPersons } from '../persons.js';
import { ontologyFile, readOntology, migrateArborescence, saveOntology } from '../ontology.js';

process.env.PIECEMAKER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-home-'));

const SKILL = path.resolve(import.meta.dirname, '..', '..', 'vendor', 'skills', 'okf');
const CONTRACT = 'Pièces/Contrat.pdf';

function write(root: string, file: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

function dossier() {
  const projectPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'okf-')));
  const root = bundleRoot(projectPath);
  write(root, 'index.md', '---\nokf_version: "0.3"\n---\n\n# Dossier\n\n- [Documents](documents/index.md)\n- [Positions](positions/index.md)\n- [Rôles](roles/index.md)\n');
  write(root, 'documents/index.md', '# Documents\n\n- [Contrat](contrat.md)\n');
  write(root, 'positions/index.md', '# Positions\n\n- [Créance](creance.md)\n');
  write(root, 'roles/index.md', '# Rôles\n\n- [Prestataire](prestataire.md)\n');
  write(root, 'documents/contrat.md', `---\ntype: Document\ntitle: Contrat de prestation\ndescription: Contrat entre Jean Dupont et la Société Exemple SAS.\nresource: "/${CONTRACT}"\n---\n\n# Contrat\n\nFonde [la créance](../positions/creance.md).\n`);
  write(root, 'positions/creance.md', `---\ntype: Position\ntitle: Créance de paiement du prix\ndescription: Le client doit payer le prix.\nresource: "/${CONTRACT}"\ndate: 2026-03-01\ncitation: "Le Client paie le prix."\n---\n\n# Créance\n\nTitulaire : [prestataire](../roles/prestataire.md). Exemple : \`[ignoré](../roles/absent.md)\`.\n`);
  write(root, 'roles/prestataire.md', '---\ntype: Rôle\ntitle: Prestataire\ndescription: Société Exemple SAS.\n---\n\n# Prestataire\n');
  write(projectPath, CONTRACT, 'Le Client paie le prix.');
  return { projectPath, root };
}

const node = (id: string, kind: string, label: string, data: Record<string, unknown> = {}) => ({ projectId: 'p', id, kind, label, aliases: [], data, date: null, createdAt: '', updatedAt: '' });
const link = (fromNodeId: string, toNodeId: string, relation: string, data: Record<string, unknown> = {}) => ({ projectId: 'p', fromNodeId, toNodeId, relation, data, createdAt: '', updatedAt: '' });
const PARTIES = {
  projectId: 'p',
  nodes: [
    node('document:contrat', 'document', 'Contrat', { path: CONTRACT }),
    node('entity:PERSONNE_PHYSIQUE_01', 'person', 'Jean Dupont', { code: 'PERSONNE_PHYSIQUE_01', partySide: 'client', auteur: 'human' }),
    node('entity:SOCIETE_01', 'company', 'Société Exemple SAS', { code: 'SOCIETE_01', auteur: 'agent' }),
    node('entity:SIREN_01', 'identifier', '123 456 789'),
    node('entity:ADRESSE_01', 'address', '12 rue des Lilas, Paris'),
  ],
  links: [
    link('document:contrat', 'entity:PERSONNE_PHYSIQUE_01', 'mentions'),
    link('entity:PERSONNE_PHYSIQUE_01', 'entity:SOCIETE_01', 'dirigeant de', { auteur: 'agent' }),
    link('entity:SOCIETE_01', 'entity:SIREN_01', 'immatriculée sous'),
  ],
  mappings: [],
  citations: [{ projectId: 'p', fromNodeId: 'entity:SOCIETE_01', toNodeId: 'entity:SIREN_01', relation: 'immatriculée sous', pieceId: 'document:contrat', source: '', texte: 'RCS Paris 123 456 789', createdAt: '' }],
};

function backend(projectPath: string, snapshot: (projectId: string) => unknown = (projectId) => ({ projectId, nodes: [], links: [], mappings: [], citations: [] })) {
  return createOkfBackend({
    projects: { getProjectById: () => ({ project_path: projectPath }), getProjectPath: () => ({ project_id: 'p', project_path: projectPath }) },
    snapshot: snapshot as never,
    skillRoot: SKILL,
    python: () => 'python3',
    isLoopback: () => true,
  });
}

test('parseValidation sépare erreurs, lints et résumé', () => {
  const report = parseValidation('ERROR  positions/a.md: missing required field: title\nLINT   roles/b.md: orphan concept\n3 file(s), 1 error(s), 1 lint(s)\n');
  assert.deepEqual(report, {
    erreurs: [{ fiche: 'positions/a.md', erreur: 'missing required field: title' }],
    lints: [{ fiche: 'roles/b.md', erreur: 'orphan concept' }],
    resume: '3 file(s), 1 error(s), 1 lint(s)',
  });
});

test('linksOf résout les liens relatifs et ignore le code, index et soi-même', () => {
  assert.deepEqual(linksOf('/positions/creance.md', '[a](../roles/x.md) [b](creance.md) [c](index.md) `[d](y.md)` [e](https://exemple.fr/z.md) [f](/actes/signature.md#date)'), ['/roles/x.md', '/actes/signature.md']);
});

test('read rend chaque concept du bundle avec ses liens vers d\'autres concepts', () => {
  const { projectPath } = dossier();
  const fiches = backend(projectPath).read('p').fiches;
  assert.deepEqual(fiches.map((fiche) => [fiche.id, fiche.lof, fiche.resource, fiche.relations.map((relation) => [relation.relation, relation.target])]), [
    ['/documents/contrat.md', 'Document', CONTRACT, [['Position', '/positions/creance.md']]],
    ['/positions/creance.md', 'Position', CONTRACT, [['Rôle', '/roles/prestataire.md']]],
    ['/roles/prestataire.md', 'Rôle', '', []],
  ]);
});

test('premiseDate trouve un concept daté par son titre, avec sa pièce et sa citation', () => {
  const { projectPath } = dossier();
  assert.deepEqual(premiseDate(projectPath, 'Créance de paiement du prix'), { date: '2026-03-01', intitule: 'Créance de paiement du prix', preuve: [{ piece: CONTRACT, citation: 'Le Client paie le prix.' }] });
  assert.equal(premiseDate(projectPath, 'Prestataire'), null);
});

test('verify lance le validateur Context-OKF en mode strict', async () => {
  const { projectPath, root } = dossier();
  const okf = backend(projectPath);
  assert.deepEqual(await okf.verify('p'), { erreurs: [], lints: [], resume: '8 file(s), 0 error(s), 0 lint(s)' });
  write(root, 'roles/client.md', '---\ndescription: Jean Dupont.\n---\n\n# Client\n\nVoir [absent](absent.md).\n');
  const report = await okf.verify('p');
  assert.ok(report.erreurs.some((finding) => finding.fiche === 'roles/client.md'));
  assert.ok(report.lints.some((finding) => finding.fiche === 'roles/client.md'));
  fs.rmSync(path.join(root, 'index.md'));
  assert.match((await okf.verify('p')).erreurs[0].erreur, /bundle OKF du dossier absent/);
});

test('verify refuse une resource hors des pièces de l\'arborescence', async () => {
  const { projectPath, root } = dossier();
  const okf = backend(projectPath);
  const resources = ['/../secret.pdf', '/.piecemaker/okf/index.md', '/Autre/Contrat.pdf', '/Pièces/Absent.pdf', 'Pièces/Contrat.pdf'];
  resources.forEach((resource, index) => write(root, `positions/p${index}.md`, `---\ntype: Position\ntitle: P${index}\ndescription: Test.\nresource: "${resource}"\n---\n\n# P${index}\n\nVoir [créance](creance.md).\n`));
  const erreurs = (await okf.verify('p')).erreurs.filter((finding) => finding.fiche.startsWith('positions/p'));
  assert.deepEqual(erreurs.map((finding) => finding.fiche), resources.map((_, index) => `positions/p${index}.md`));
  assert.match(erreurs[0].erreur, /hors des pièces de l'arborescence/);
  assert.match(erreurs[3].erreur, /introuvable/);
});

test('persons rend une fiche par personne ou organisation, classée par auteur', () => {
  const files = renderPersons(PARTIES as never);
  assert.deepEqual([...files.keys()], ['index.md', 'personne-physique-01.md', 'societe-01.md']);
  const index = files.get('index.md')!;
  assert.match(index, /## Validé\n\n- \[Jean Dupont\]\(\/persons\/personne-physique-01\.md\) — Personne/);
  assert.match(index, /## À vérifier\n\n- \[Société Exemple SAS\]/);
  assert.match(index, /## Éléments non rattachés\n\n- address : 12 rue des Lilas, Paris/);
  const societe = files.get('societe-01.md')!;
  assert.match(societe, /type: Organisation\n[^]*cco: Organization\n/);
  assert.match(societe, /- \[Jean Dupont\]\(\/persons\/personne-physique-01\.md\) → dirigeant de — À vérifier/);
  assert.match(societe, /immatriculée sous → 123 456 789 — À trier — « RCS Paris 123 456 789 » \(`Pièces\/Contrat\.pdf`\)/);
  assert.match(files.get('personne-physique-01.md')!, /## Pièces qui la mentionnent\n\n- `Pièces\/Contrat\.pdf`/);
});

test('un Rôle lié à une fiche persons prend son côté, et le bundle reste valide', async () => {
  const { projectPath, root } = dossier();
  write(root, 'roles/prestataire.md', '---\ntype: Rôle\ntitle: Prestataire\ndescription: Prestataire du contrat.\n---\n\n# Prestataire\n\nPorteur : [Jean Dupont](/persons/personne-physique-01.md).\n');
  const okf = backend(projectPath, () => PARTIES);
  assert.equal(okf.read('p').fiches.find((fiche) => fiche.id === '/roles/prestataire.md')?.side, 'client');
  const report = await okf.verify('p');
  assert.deepEqual([report.erreurs, report.lints], [[], []]);
});

test('un pseudonyme changé met à jour ses liens dans tout le bundle', () => {
  const { projectPath, root } = dossier();
  write(root, 'roles/prestataire.md', '---\ntype: Rôle\ntitle: Prestataire\ndescription: Prestataire du contrat.\n---\n\n# Prestataire\n\nPorteur : [Jean Dupont](/persons/personne-physique-01.md) et [fiche](../persons/personne-physique-01.md#liens).\n');
  const renamed = { ...PARTIES, nodes: PARTIES.nodes.map((entry) => entry.id === 'entity:PERSONNE_PHYSIQUE_01' ? { ...entry, id: 'entity:PERSONNE_PHYSIQUE_09', data: { ...entry.data, code: 'PERSONNE_PHYSIQUE_09', codes_retires: ['PERSONNE_PHYSIQUE_01'] } } : entry) };
  backend(projectPath, () => renamed).read('p');
  assert.match(fs.readFileSync(path.join(root, 'roles/prestataire.md'), 'utf8'), /\[Jean Dupont\]\(\/persons\/personne-physique-09\.md\) et \[fiche\]\(\.\.\/persons\/personne-physique-09\.md#liens\)/);
  assert.ok(!fs.existsSync(path.join(root, 'persons/personne-physique-01.md')));
});

test('l\'ontologie rend les six patterns LOF du contexte', () => {
  const { projectPath } = dossier();
  assert.deepEqual(backend(projectPath).ontology('p').patterns.map((pattern) => pattern.id), ['odp-001', 'odp-002', 'odp-003', 'odp-004', 'odp-005', 'odp-006']);
});

test('le type principal d\'un document suit le dossier choisi et ses sous-dossiers', () => {
  const { projectPath, root } = dossier();
  saveOntology(projectPath, { arborescence: [
    { name: 'Pièces', type: 'Archives', explanation: '' },
    { name: 'Pièces/Contrats', explanation: '' },
    { name: 'Projets', type: 'Pièces', explanation: '' },
  ] });
  write(root, 'documents/projet.md', '---\ntype: Document\ntitle: Conclusions\ndescription: Projet.\nresource: "/Projets/Conclusions.docx"\n---\n\n# Conclusions\n');
  assert.deepEqual(readTypes(projectPath), ['Archives', 'Pièces']);
  const types = Object.fromEntries(backend(projectPath).read('p').fiches.map((fiche) => [fiche.id, fiche.type]));
  assert.equal(types['/documents/contrat.md'], 'Archives');
  assert.equal(types['/documents/projet.md'], 'Pièces');
  assert.equal(types['/positions/creance.md'], 'Position');
});

test('l\'arborescence est commune, scellée, et reprise une fois des anciens dossiers', () => {
  const { projectPath } = dossier();
  fs.rmSync(ontologyFile(), { force: true });
  const older = dossier().projectPath;
  fs.rmSync(ontologyFile(), { force: true });
  fs.mkdirSync(path.join(older, '.piecemaker'), { recursive: true });
  fs.writeFileSync(path.join(older, '.piecemaker', 'arborescence.json'), JSON.stringify([{ name: 'Anciens', explanation: '' }]));
  fs.utimesSync(path.join(older, '.piecemaker', 'arborescence.json'), new Date('2020-01-01'), new Date('2020-01-01'));
  fs.writeFileSync(path.join(projectPath, '.piecemaker', 'arborescence.json'), JSON.stringify([{ name: 'Pièces', type: 'Archives', explanation: '' }]));
  assert.equal(migrateArborescence([older, projectPath]), path.join(projectPath, '.piecemaker', 'arborescence.json'));
  assert.deepEqual(readTypes(older), ['Archives']);
  assert.equal(migrateArborescence([older]), null);
  const stored = JSON.parse(fs.readFileSync(ontologyFile(), 'utf8'));
  stored.arborescence[0].type = 'Pièces';
  fs.writeFileSync(ontologyFile(), JSON.stringify(stored));
  assert.match(readOntology(projectPath).erreur || '', /modifiée hors/);
  assert.deepEqual(readTypes(projectPath), ['Projets', 'Pièces', 'Archives', 'Notes et recherches']);
});
