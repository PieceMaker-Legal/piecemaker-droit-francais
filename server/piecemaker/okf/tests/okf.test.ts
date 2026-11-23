import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { bundleRoot, linksOf, readTypes } from '../bundle.js';
import { createOkfBackend, parseValidation, premiseDate } from '../index.js';
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
  return { projectPath, root };
}

function backend(projectPath: string) {
  return createOkfBackend({
    projects: { getProjectById: () => ({ project_path: projectPath }), getProjectPath: () => ({ project_id: 'p', project_path: projectPath }) },
    snapshot: (projectId) => ({ projectId, nodes: [], links: [], mappings: [], citations: [] }),
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
  assert.deepEqual(await okf.verify('p'), { erreurs: [], lints: [], resume: '7 file(s), 0 error(s), 0 lint(s)' });
  write(root, 'roles/client.md', '---\ndescription: Jean Dupont.\n---\n\n# Client\n\nVoir [absent](absent.md).\n');
  const report = await okf.verify('p');
  assert.ok(report.erreurs.some((finding) => finding.fiche === 'roles/client.md'));
  assert.ok(report.lints.some((finding) => finding.fiche === 'roles/client.md'));
  fs.rmSync(path.join(root, 'index.md'));
  assert.match((await okf.verify('p')).erreurs[0].erreur, /bundle OKF du dossier absent/);
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
