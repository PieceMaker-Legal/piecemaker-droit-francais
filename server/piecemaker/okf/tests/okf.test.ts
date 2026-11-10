import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { SourceDocument } from '../build.js';
import { buildBundle, datesIn } from '../build.js';
import { bundleRoot, conceptFile, parseConcept, readBundle, relationsOf } from '../bundle.js';
import { addLink, removeLink } from '../links.js';
import { verifyBundle } from '../verify.js';

const CONTRACT = 'Pièces/Contrat.pdf';
const LETTER = 'Pièces/Courrier.pdf';
const DRAFT = 'Projets/Conclusions.docx';
const MARKDOWN: Record<string, string> = {
  [CONTRACT]: 'Contrat de prestation conclu entre Jean Dupont et la Société Exemple SAS.',
  [LETTER]: 'Monsieur,\nNous faisons suite au contrat de prestation du 12 mars 2021. Il est résilié.\nNous contestons la facture.',
  [DRAFT]: 'Le contrat de prestation du 12 mars 2021 est nul.',
};

function dossier(): { projectPath: string; documents: SourceDocument[]; markdownOf: (resource: string) => string | null } {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-'));
  for (const resource of Object.keys(MARKDOWN)) {
    fs.mkdirSync(path.dirname(path.join(projectPath, resource)), { recursive: true });
    fs.writeFileSync(path.join(projectPath, resource), '');
  }
  fs.mkdirSync(path.join(projectPath, '.piecemaker'));
  fs.writeFileSync(path.join(projectPath, '.piecemaker', 'arborescence.json'), JSON.stringify([{ name: 'Pièces', explanation: '' }, { name: 'Projets', explanation: '' }]));
  const documents: SourceDocument[] = [
    { resource: CONTRACT, title: 'Contrat.pdf', nature: 'Contrat de prestation', date: '2021-03-12', atoms: [{ code: 'PERSONNE_PHYSIQUE_01', citation: MARKDOWN[CONTRACT] }] },
    { resource: LETTER, title: 'Courrier.pdf', nature: 'Courrier', date: '2021-06-01', atoms: [] },
    { resource: DRAFT, title: 'Conclusions.docx', nature: 'Conclusions', date: '', atoms: [] },
  ];
  return { projectPath, documents, markdownOf: (resource) => MARKDOWN[resource] ?? null };
}

const concept = (projectPath: string, resource: string) => parseConcept(fs.readFileSync(conceptFile(projectPath, `/${resource}.md`), 'utf8'));
const resources = Object.keys(MARKDOWN);

test('datesIn reconnaît les dates françaises écrites et chiffrées', () => {
  assert.deepEqual(datesIn('le 1er août 2020 puis le 12/03/2021').map((entry) => entry.date), ['2020-08-01', '2021-03-12']);
});

test('la construction écrit une fiche OKF par document et relie les pièces par date et nature', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf, now: '2026-01-01T00:00:00.000Z' });

  const letter = concept(projectPath, LETTER);
  assert.equal(letter.frontmatter.type, 'Pièces');
  assert.equal(letter.frontmatter.resource, LETTER);
  assert.deepEqual(letter.frontmatter.generated, { by: 'piecemaker/gliner', at: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(relationsOf(letter.frontmatter)['se-refere-a'], [{
    cible: `/${CONTRACT}.md`,
    citation: 'Nous faisons suite au contrat de prestation du 12 mars 2021.',
    origine: 'piecemaker/gliner',
  }]);
  assert.equal(concept(projectPath, DRAFT).frontmatter.type, 'Projets');
  assert.equal(concept(projectPath, DRAFT).frontmatter.relations, undefined);
  assert.match(concept(projectPath, CONTRACT).body, /## PERSONNE_PHYSIQUE_01\n\n> Contrat de prestation conclu/);
  const index = fs.readFileSync(path.join(bundleRoot(projectPath), 'index.md'), 'utf8');
  assert.match(index, /^---\nokf_version: "0.2"\n---\n\n# Pièces\n/);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('une reconstruction sans changement ne réécrit rien', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf, now: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(buildBundle({ projectPath, documents, markdownOf, now: '2026-02-02T00:00:00.000Z' }), { written: 0, removed: 0 });
});

test('un lien ajouté est contrôlé, conservé à la reconstruction et suit un renommage', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  assert.throws(() => addLink(projectPath, { source: LETTER, relation: 'modifie', cible: CONTRACT, citation: 'Phrase absente.' }, markdownOf), /citation introuvable/);
  assert.throws(() => addLink(projectPath, { source: DRAFT, relation: 'modifie', cible: CONTRACT, citation: MARKDOWN[DRAFT] }, markdownOf), /seuls les types Pièces/);
  assert.throws(() => addLink(projectPath, { source: LETTER, relation: 'annule', cible: CONTRACT, citation: 'Il est résilié.' }, markdownOf), /relation inconnue/);
  addLink(projectPath, { source: LETTER, relation: 'modifie', cible: CONTRACT, citation: 'Il est résilié.' }, markdownOf);

  const moved = 'Pièces/Contrat signé.pdf';
  fs.renameSync(path.join(projectPath, CONTRACT), path.join(projectPath, moved));
  const renamedDocuments = documents.map((document) => document.resource === CONTRACT ? { ...document, resource: moved } : document);
  const renamedMarkdown = (resource: string) => resource === moved ? MARKDOWN[CONTRACT] : markdownOf(resource);
  buildBundle({ projectPath, documents: renamedDocuments, markdownOf: renamedMarkdown, renamed: { previous: CONTRACT, current: moved } });

  assert.deepEqual(relationsOf(concept(projectPath, LETTER).frontmatter).modifie, [{ cible: `/${moved}.md`, citation: 'Il est résilié.', origine: 'piecemaker/agent' }]);
  assert.equal(fs.existsSync(conceptFile(projectPath, `/${CONTRACT}.md`)), false);
  assert.deepEqual(verifyBundle({ projectPath, resources: [moved, LETTER, DRAFT], markdownOf: renamedMarkdown }), []);
});

test('un lien du scan écarté ne revient pas', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  removeLink(projectPath, { source: LETTER, relation: 'se-refere-a', cible: CONTRACT });
  buildBundle({ projectPath, documents, markdownOf });
  assert.equal(relationsOf(concept(projectPath, LETTER).frontmatter)['se-refere-a'][0].ecarte, true);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('la vérification signale types, cibles, citations et documents sans fiche', () => {
  const { projectPath, documents, markdownOf } = dossier();
  fs.writeFileSync(path.join(projectPath, 'Hors classement.pdf'), '');
  buildBundle({ projectPath, documents: [...documents, { resource: 'Hors classement.pdf', title: 'Hors classement.pdf', nature: '', date: '', atoms: [] }], markdownOf });
  const letterFile = conceptFile(projectPath, `/${LETTER}.md`);
  fs.writeFileSync(letterFile, fs.readFileSync(letterFile, 'utf8')
    .replace('Nous faisons suite au contrat', 'Nous faisons référence au contrat')
    .replace('relations:', `relations:\n  annule:\n    - cible: /Pièces/Absent.pdf.md\n      citation: Il est résilié.\n      origine: piecemaker/agent`));
  fs.writeFileSync(path.join(projectPath, 'Pièces', 'Facture.pdf'), '');

  const errors = verifyBundle({ projectPath, resources: [...resources, 'Pièces/Facture.pdf'], markdownOf }).map((entry) => `${entry.fiche} | ${entry.erreur}`);
  assert.deepEqual(errors, [
    '/Hors classement.pdf.md | type « Non classé » hors arborescence (Pièces, Projets)',
    `/${LETTER}.md | relation inconnue : annule (modifie, repond-a, se-refere-a)`,
    `/${LETTER}.md | annule → /Pièces/Absent.pdf.md : cible absente du dossier`,
    `/${LETTER}.md | se-refere-a → /${CONTRACT}.md : citation introuvable dans le document`,
    '/Pièces/Facture.pdf.md | document sans fiche : relancer l\'analyse du dossier',
  ]);
  assert.equal(readBundle(projectPath).length, 4);
});
