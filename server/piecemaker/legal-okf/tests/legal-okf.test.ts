import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { brainDossiers, generateLibrary } from '../generate.js';
import { linkProject, readLibrary, writeConcept } from '../read.js';
import { openSource } from '../source.js';

function write(root: string, file: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-okf-'));
  const brain = path.join(base, 'brain');
  const dossier = path.join(base, 'Dupont');
  const bundle = path.join(brain, 'Library', 'okf');
  write(brain, '.piecemaker/dossiers.json', JSON.stringify({ [dossier]: 'Dupont', [path.join(base, 'absent')]: 'Absent' }));
  write(dossier, '.piecemaker/okf/persons/personne-physique-01.md', '---\ntype: Personne\ntitle: PERSONNE_PHYSIQUE_01\ncode: PERSONNE_PHYSIQUE_01\nside: client\n---\n\n# PERSONNE_PHYSIQUE_01\n\n## Désignation\n\n- Côté : client\n\n## Liens\n\nAucun lien.\n');
  write(dossier, '.piecemaker/okf/persons/societe-01.md', '---\ntype: Organisation\ntitle: SOCIETE_01\nside: adverse\n---\n');
  write(dossier, '.piecemaker/artifacts/items/assignation-dupont/artifact.json', JSON.stringify({ id: 'assignation-dupont', title: 'Assignation Dupont', document: 'Actes/Assignation.docx', updated_at: '2026-11-20T10:00:00Z', versions: [] }));
  write(dossier, '.piecemaker/artifacts/items/page/artifact.json', JSON.stringify({ id: 'page', title: 'Page', versions: [] }));
  write(bundle, 'index.md', '---\ntitle: Legal-OKF\n---\n# Fonds\n\n- [Templates](/templates/index.md)\n');
  write(bundle, 'templates/assignation.md', '---\ntype: Template\ntitle: Assignation\ndomaine: litigation\nresource: /assets/assignation.docx\n---\n# Assignation\n');
  write(bundle, 'guidelines/redaction-assignation.md', '---\ntype: Guideline\ntitle: Rédaction d’assignation\n---\n# Règles\n');
  write(bundle, 'domains/litigation.md', '---\ntype: Domaine\ntitle: Litigation\n---\n| Acte | Template | Guidelines |\n| --- | --- | --- |\n| Assignation | [T](/templates/assignation.md) | [G](/guidelines/redaction-assignation.md) |\n');
  write(bundle, 'exemples/ancien.md', '---\ntype: Exemple\ntitle: Ancien exemple\n---\n# Ancien\n');
  write(bundle, 'guidelines/citations.md', '---\ntype: Guideline\ntitle: Citations\n---\nVoir [l’exemple](/exemples/ancien.md).\n');
  return { brain, bundle };
}

test('clients et projects sont générés depuis les dossiers du brain', () => {
  const { brain, bundle } = fixture();
  const dossiers = brainDossiers(brain);
  assert.deepEqual(dossiers.map((dossier) => dossier.name), ['Dupont']);
  assert.deepEqual(generateLibrary(bundle, dossiers), { clients: 1, projects: 1 });
  const client = fs.readFileSync(path.join(bundle, 'clients', 'dupont--personne-physique-01.md'), 'utf8');
  assert.match(client, /type: Client/);
  assert.match(client, /\[Assignation Dupont\]\(\/projects\/dupont--assignation-dupont\.md\)/);
  const project = fs.readFileSync(path.join(bundle, 'projects', 'dupont--assignation-dupont.md'), 'utf8');
  assert.match(project, /document: Actes\/Assignation\.docx/);
  assert.match(fs.readFileSync(path.join(bundle, 'index.md'), 'utf8'), /\/clients\/index\.md[\s\S]*\/projects\/index\.md/);
});

test('les exemples deviennent des projets et les liens suivent', () => {
  const { brain, bundle } = fixture();
  generateLibrary(bundle, brainDossiers(brain));
  assert.equal(fs.existsSync(path.join(bundle, 'exemples')), false);
  assert.match(fs.readFileSync(path.join(bundle, 'projects', 'ancien.md'), 'utf8'), /type: Projet/);
  assert.match(fs.readFileSync(path.join(bundle, 'guidelines', 'citations.md'), 'utf8'), /\(\/projects\/ancien\.md\)/);
});

test('un lien de projet survit à la régénération et attache le projet au template', () => {
  const { brain, bundle } = fixture();
  const dossiers = brainDossiers(brain);
  generateLibrary(bundle, dossiers);
  linkProject(bundle, '/projects/dupont--assignation-dupont.md', '/templates/assignation.md', true);
  generateLibrary(bundle, dossiers);
  const template = readLibrary(bundle).templates.find((entry) => entry.id === '/templates/assignation.md');
  assert.deepEqual(template?.projects, ['/projects/dupont--assignation-dupont.md']);
  assert.deepEqual(template?.guidelines, ['/guidelines/redaction-assignation.md']);
  linkProject(bundle, '/projects/dupont--assignation-dupont.md', '/templates/assignation.md', false);
  assert.deepEqual(readLibrary(bundle).templates[0].projects, []);
});

test('une fiche générée disparue est retirée, une fiche faite à la main reste', () => {
  const { brain, bundle } = fixture();
  generateLibrary(bundle, brainDossiers(brain));
  generateLibrary(bundle, []);
  assert.equal(fs.existsSync(path.join(bundle, 'projects', 'dupont--assignation-dupont.md')), false);
  assert.equal(fs.existsSync(path.join(bundle, 'clients', 'dupont--personne-physique-01.md')), false);
  assert.equal(fs.existsSync(path.join(bundle, 'projects', 'ancien.md')), true);
});

test('seuls les concepts modifiables s’écrivent, frontmatter et 500 lignes au plus', () => {
  const { bundle } = fixture();
  writeConcept(bundle, '/guidelines/citations.md', '---\ntype: Guideline\ntitle: Citations\n---\nNouveau texte.\n');
  assert.match(fs.readFileSync(path.join(bundle, 'guidelines', 'citations.md'), 'utf8'), /Nouveau texte/);
  assert.throws(() => writeConcept(bundle, '/index.md', '---\n---\n'), /Seuls/);
  assert.throws(() => writeConcept(bundle, '/guidelines/../index.md', '---\n---\n'), /Seuls/);
  assert.throws(() => writeConcept(bundle, '/guidelines/citations.md', 'sans frontmatter'), /frontmatter/);
  assert.throws(() => writeConcept(bundle, '/guidelines/citations.md', `---\n---\n${'x\n'.repeat(500)}`), /500/);
});

test('le clone part dans le brain, puis se met à jour en fast-forward', async () => {
  const { brain } = fixture();
  fs.rmSync(path.join(brain, 'Library'), { recursive: true });
  const calls: string[][] = [];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-okf-home-'));
  const source = openSource({ home, brainRoot: () => brain, env: {}, git: async (args) => {
    calls.push(args);
    if (args[0] === 'clone') write(args.at(-1)!, '.git/HEAD', 'ref');
    return { code: 0, stdout: '', stderr: '' };
  } });
  await source.sync();
  await source.sync();
  assert.deepEqual(calls.map((args) => args[0]), ['clone', 'pull']);
  assert.equal(calls[0].at(-1), path.join(brain, 'Library'));
  assert.deepEqual(calls[1], ['pull', '--ff-only', 'origin', 'main']);
  assert.ok(JSON.parse(fs.readFileSync(path.join(home, 'legal-okf.json'), 'utf8')).last_sync);
});
