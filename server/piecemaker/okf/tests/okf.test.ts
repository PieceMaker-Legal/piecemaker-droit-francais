import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { REVIEW_FOLDER } from '../../../../plugins/piecemaker-tabular-review/src/shared.js';

import type { SourceDocument, SourceParty } from '../build.js';
import { buildBundle, datesIn } from '../build.js';
import { bundleRoot, conceptFile, parseConcept, readBundle, relationsOf } from '../bundle.js';
import { factsFromReviews } from '../reviews.js';
import type { ReviewFact } from '../reviews.js';
import { addLink, removeLink } from '../links.js';
import { contradictions, verifyBundle } from '../verify.js';

const CONTRACT = 'Pièces/Contrat.pdf';
const LETTER = 'Pièces/Courrier.pdf';
const DRAFT = 'Projets/Conclusions.docx';
const PERSON = 'PERSONNE_PHYSIQUE_01';
const COMPANY = 'SOCIETE_01';
const MARKDOWN: Record<string, string> = {
  [CONTRACT]: 'Contrat de prestation conclu entre Jean Dupont et la Société Exemple SAS.',
  [LETTER]: 'Monsieur,\nNous faisons suite au contrat de prestation du 12 mars 2021. Il est résilié.\nNous contestons la facture.',
  [DRAFT]: 'Le contrat de prestation du 12 mars 2021 est nul.',
};
const NOW = '2026-01-01T00:00:00.000Z';

function dossier(): { projectPath: string; documents: SourceDocument[]; markdownOf: (resource: string) => string | null } {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-'));
  for (const resource of Object.keys(MARKDOWN)) {
    fs.mkdirSync(path.dirname(path.join(projectPath, resource)), { recursive: true });
    fs.writeFileSync(path.join(projectPath, resource), '');
  }
  fs.mkdirSync(path.join(projectPath, '.piecemaker'));
  fs.writeFileSync(path.join(projectPath, '.piecemaker', 'arborescence.json'), JSON.stringify([{ name: 'Pièces', explanation: '' }, { name: 'Projets', explanation: '' }]));
  const documents: SourceDocument[] = [
    { resource: CONTRACT, title: 'Contrat.pdf', nature: 'Contrat de prestation', date: '2021-03-12', parties: [{ code: PERSON, citation: MARKDOWN[CONTRACT] }, { code: COMPANY, citation: MARKDOWN[CONTRACT] }] },
    { resource: LETTER, title: 'Courrier.pdf', nature: 'Courrier', date: '2021-06-01', parties: [] },
    { resource: DRAFT, title: 'Conclusions.docx', nature: 'Conclusions', date: '', parties: [] },
  ];
  return { projectPath, documents, markdownOf: (resource) => MARKDOWN[resource] ?? null };
}

const concept = (projectPath: string, resource: string) => parseConcept(fs.readFileSync(conceptFile(projectPath, `/${resource}.md`), 'utf8'));
const resources = Object.keys(MARKDOWN);
const PERSON_ID = `/_parties/${PERSON}.md`;
const RESILIATION_ID = '/_faits/montant-de-la-facture.md';

test('datesIn reconnaît les dates françaises écrites et chiffrées', () => {
  assert.deepEqual(datesIn('le 1er août 2020 puis le 12/03/2021').map((entry) => entry.date), ['2020-08-01', '2021-03-12']);
});

test('la construction écrit une fiche OKF par document et relie les pièces par date et nature', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf, now: NOW });

  const letter = concept(projectPath, LETTER);
  assert.equal(letter.frontmatter.type, 'Pièces');
  assert.equal(letter.frontmatter.resource, LETTER);
  assert.deepEqual(letter.frontmatter.generated, { by: 'piecemaker/gliner', at: NOW });
  assert.deepEqual(relationsOf(letter.frontmatter)['refers-to'], [{
    target: `/${CONTRACT}.md`,
    citation: 'Nous faisons suite au contrat de prestation du 12 mars 2021.',
    origin: 'piecemaker/gliner',
  }]);
  assert.equal(concept(projectPath, DRAFT).frontmatter.type, 'Projets');
  assert.equal(concept(projectPath, DRAFT).frontmatter.relations, undefined);
  assert.equal(concept(projectPath, CONTRACT).body.trim(), '');
  assert.equal(relationsOf(concept(projectPath, CONTRACT).frontmatter).mentions, undefined);
  const index = fs.readFileSync(path.join(bundleRoot(projectPath), 'index.md'), 'utf8');
  assert.match(index, /^---\nokf_version: "0.2"\n---\n\n# Pièces\n/);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('une reconstruction sans changement ne réécrit rien', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf, now: NOW });
  assert.deepEqual(buildBundle({ projectPath, documents, markdownOf, now: '2026-02-02T00:00:00.000Z' }), { written: 0, removed: 0 });
});

test('un lien ajouté est contrôlé, conservé à la reconstruction et suit un renommage', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  assert.throws(() => addLink(projectPath, { source: LETTER, relation: 'amends', target: CONTRACT, citation: 'Phrase absente.' }, markdownOf), /citation introuvable/);
  assert.throws(() => addLink(projectPath, { source: DRAFT, relation: 'amends', target: CONTRACT, citation: MARKDOWN[DRAFT] }, markdownOf), /seuls les types Pièces/);
  assert.throws(() => addLink(projectPath, { source: LETTER, relation: 'annule', target: CONTRACT, citation: 'Il est résilié.' }, markdownOf), /relation inconnue/);
  addLink(projectPath, { source: LETTER, relation: 'amends', target: CONTRACT, citation: 'Il est résilié.' }, markdownOf);

  const moved = 'Pièces/Contrat signé.pdf';
  fs.renameSync(path.join(projectPath, CONTRACT), path.join(projectPath, moved));
  const renamedDocuments = documents.map((document) => document.resource === CONTRACT ? { ...document, resource: moved } : document);
  const renamedMarkdown = (resource: string) => resource === moved ? MARKDOWN[CONTRACT] : markdownOf(resource);
  buildBundle({ projectPath, documents: renamedDocuments, markdownOf: renamedMarkdown, renamed: { previous: CONTRACT, current: moved } });

  assert.deepEqual(relationsOf(concept(projectPath, LETTER).frontmatter).amends, [{ target: `/${moved}.md`, citation: 'Il est résilié.', origin: 'piecemaker/agent' }]);
  assert.equal(fs.existsSync(conceptFile(projectPath, `/${CONTRACT}.md`)), false);
  assert.deepEqual(verifyBundle({ projectPath, resources: [moved, LETTER, DRAFT], markdownOf: renamedMarkdown }), []);
});

test('un lien du scan écarté ne revient pas', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  removeLink(projectPath, { source: LETTER, relation: 'refers-to', target: CONTRACT });
  buildBundle({ projectPath, documents, markdownOf });
  assert.equal(relationsOf(concept(projectPath, LETTER).frontmatter)['refers-to'][0].dismissed, true);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('la vérification signale types, cibles, citations et documents sans fiche', () => {
  const { projectPath, documents, markdownOf } = dossier();
  fs.writeFileSync(path.join(projectPath, 'Hors classement.pdf'), '');
  buildBundle({ projectPath, documents: [...documents, { resource: 'Hors classement.pdf', title: 'Hors classement.pdf', nature: '', date: '', parties: [] }], markdownOf });
  const letterFile = conceptFile(projectPath, `/${LETTER}.md`);
  fs.writeFileSync(letterFile, fs.readFileSync(letterFile, 'utf8')
    .replace('Nous faisons suite au contrat', 'Nous faisons référence au contrat')
    .replace('relations:', `relations:\n  annule:\n    - target: /Pièces/Absent.pdf.md\n      citation: Il est résilié.\n      origin: piecemaker/agent`));
  fs.writeFileSync(path.join(projectPath, 'Pièces', 'Facture.pdf'), '');

  const errors = verifyBundle({ projectPath, resources: [...resources, 'Pièces/Facture.pdf'], markdownOf }).map((entry) => `${entry.fiche} | ${entry.erreur}`);
  assert.deepEqual(errors, [
    '/Hors classement.pdf.md | type « Non classé » hors arborescence (Pièces, Projets)',
    `/${LETTER}.md | relation inconnue : annule (amends, responds-to, refers-to, supersedes, states, mentions)`,
    `/${LETTER}.md | annule → /Pièces/Absent.pdf.md : cible absente du dossier`,
    `/${LETTER}.md | refers-to → /${CONTRACT}.md : citation introuvable dans le document`,
    '/Pièces/Facture.pdf.md | document sans fiche : relancer l\'analyse du dossier',
  ]);
  assert.equal(readBundle(projectPath).length, 4);
});

test('les parties viennent de la liste du dossier, seules les parties listées sont mentionnées', () => {
  const { projectPath, documents, markdownOf } = dossier();
  const parties: SourceParty[] = [{ code: PERSON, side: 'client' }];
  buildBundle({ projectPath, documents, markdownOf, parties, now: NOW });

  assert.deepEqual(relationsOf(concept(projectPath, CONTRACT).frontmatter).mentions, [{ target: PERSON_ID, citation: MARKDOWN[CONTRACT], origin: 'piecemaker/gliner' }]);
  assert.equal(relationsOf(concept(projectPath, LETTER).frontmatter).mentions, undefined);
  const person = parseConcept(fs.readFileSync(conceptFile(projectPath, PERSON_ID), 'utf8'));
  assert.equal(person.frontmatter.type, 'Partie');
  assert.equal(person.frontmatter.title, PERSON);
  assert.equal(person.frontmatter.description, 'Partie cliente');
  assert.equal(person.frontmatter.side, 'client');
  assert.match(person.body, /# Pièces\n\n## \[Contrat\.pdf\]\(\/Pi%C3%A8ces\/Contrat\.pdf\.md\)\n\n> Contrat de prestation conclu/);
  assert.equal(fs.existsSync(conceptFile(projectPath, `/_parties/${COMPANY}.md`)), false);
  const index = fs.readFileSync(path.join(bundleRoot(projectPath), 'index.md'), 'utf8');
  assert.match(index, /# Partie\n\n\* \[PERSONNE_PHYSIQUE_01\]\(\/_parties\/PERSONNE_PHYSIQUE_01\.md\) - Partie cliente/);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('un fait lié à une pièce crée sa fiche, garde la valeur et survit à la reconstruction', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  assert.throws(() => addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Phrase absente.' }, markdownOf), /citation introuvable/);
  assert.equal(fs.existsSync(conceptFile(projectPath, RESILIATION_ID)), false);

  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Nous contestons la facture.', value: '  1 200   euros ', single: true }, markdownOf);
  const fact = parseConcept(fs.readFileSync(conceptFile(projectPath, RESILIATION_ID), 'utf8'));
  assert.equal(fact.frontmatter.type, 'Fait');
  assert.equal(fact.frontmatter.title, 'Montant de la facture');
  assert.equal(fact.frontmatter.single_value, true);

  buildBundle({ projectPath, documents, markdownOf, now: '2026-02-02T00:00:00.000Z' });
  assert.deepEqual(relationsOf(concept(projectPath, LETTER).frontmatter).states, [{ target: RESILIATION_ID, citation: 'Nous contestons la facture.', origin: 'piecemaker/agent', value: '1 200 euros' }]);
  assert.match(parseConcept(fs.readFileSync(conceptFile(projectPath, RESILIATION_ID), 'utf8')).body, /Valeur : 1 200 euros\n\n> Nous contestons la facture\./);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);

  removeLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture' });
  buildBundle({ projectPath, documents, markdownOf });
  assert.equal(relationsOf(concept(projectPath, LETTER).frontmatter).states, undefined);
  assert.equal(fs.existsSync(conceptFile(projectPath, RESILIATION_ID)), false);
});

test('mentions ne peut pas être posé à la main', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf, parties: [{ code: PERSON, side: 'client' }] });
  assert.throws(() => addLink(projectPath, { source: LETTER, relation: 'mentions', target: PERSON, citation: 'Nous contestons la facture.' }, markdownOf), /posé par l'analyse/);
});

test('involves relie un fait à une partie sans citation', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf, parties: [{ code: PERSON, side: 'client' }] });
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Nous contestons la facture.' }, markdownOf);
  assert.throws(() => addLink(projectPath, { source: 'Montant de la facture', relation: 'involves', target: 'INCONNU_01' }, markdownOf), /n'est pas une partie du dossier/);

  addLink(projectPath, { source: 'Montant de la facture', relation: 'involves', target: PERSON }, markdownOf);
  buildBundle({ projectPath, documents, markdownOf, parties: [{ code: PERSON, side: 'client' }] });
  assert.deepEqual(relationsOf(parseConcept(fs.readFileSync(conceptFile(projectPath, RESILIATION_ID), 'utf8')).frontmatter).involves, [{ target: PERSON_ID, citation: '', origin: 'piecemaker/agent' }]);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('supersedes relie deux pièces comme amends', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  assert.throws(() => addLink(projectPath, { source: DRAFT, relation: 'supersedes', target: CONTRACT, citation: MARKDOWN[DRAFT] }, markdownOf), /seuls les types Pièces/);
  addLink(projectPath, { source: LETTER, relation: 'supersedes', target: CONTRACT, citation: 'Il est résilié.' }, markdownOf);
  buildBundle({ projectPath, documents, markdownOf });
  assert.deepEqual(relationsOf(concept(projectPath, LETTER).frontmatter).supersedes, [{ target: `/${CONTRACT}.md`, citation: 'Il est résilié.', origin: 'piecemaker/agent' }]);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('une colonne de revue devient un fait lié à la pièce citée, un lien écarté ne revient pas', () => {
  const { projectPath, documents, markdownOf } = dossier();
  const reviewFacts: ReviewFact[] = [
    { id: '/_faits/statut-du-contrat.md', title: 'Statut du contrat', description: 'Le contrat est-il résilié ?', single: true, statements: [{ candidates: [LETTER], quote: 'Il est résilié.', value: 'résilié' }] },
    { id: '/_faits/validite-du-contrat.md', title: 'Validité du contrat', description: 'Le contrat est-il valable ?', single: false, statements: [{ candidates: ['Projets/Absent.docx'], quote: 'Le contrat de prestation du 12 mars 2021 est nul.', value: 'nul' }] },
  ];
  buildBundle({ projectPath, documents, markdownOf, reviewFacts, now: NOW });

  assert.deepEqual(relationsOf(concept(projectPath, LETTER).frontmatter).states, [{ target: '/_faits/statut-du-contrat.md', citation: 'Il est résilié.', origin: 'piecemaker/tabular-review', value: 'résilié' }]);
  assert.deepEqual(relationsOf(concept(projectPath, DRAFT).frontmatter).states, [{ target: '/_faits/validite-du-contrat.md', citation: 'Le contrat de prestation du 12 mars 2021 est nul.', origin: 'piecemaker/tabular-review', value: 'nul' }]);
  const fact = parseConcept(fs.readFileSync(conceptFile(projectPath, '/_faits/statut-du-contrat.md'), 'utf8'));
  assert.equal(fact.frontmatter.single_value, true);
  assert.deepEqual(fact.frontmatter.generated, { by: 'piecemaker/tabular-review', at: NOW });
  assert.equal(parseConcept(fs.readFileSync(conceptFile(projectPath, '/_faits/validite-du-contrat.md'), 'utf8')).frontmatter.single_value, undefined);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);

  removeLink(projectPath, { source: LETTER, relation: 'states', target: '/_faits/statut-du-contrat.md' });
  buildBundle({ projectPath, documents, markdownOf, reviewFacts });
  const states = relationsOf(concept(projectPath, LETTER).frontmatter).states;
  assert.equal(states.length, 1);
  assert.equal(states[0].dismissed, true);
  assert.equal(fs.existsSync(conceptFile(projectPath, '/_faits/statut-du-contrat.md')), true);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('contradictions signale un fait à valeur unique écrit avec deux valeurs distinctes', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  addLink(projectPath, { source: CONTRACT, relation: 'states', target: 'Prix du contrat', citation: MARKDOWN[CONTRACT], value: '5 000 euros', single: true }, markdownOf);
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Prix du contrat', citation: 'Nous faisons suite au contrat de prestation du 12 mars 2021.', value: '4 000 euros' }, markdownOf);
  addLink(projectPath, { source: CONTRACT, relation: 'states', target: 'Date du contrat', citation: MARKDOWN[CONTRACT], value: '12 mars 2021', single: true }, markdownOf);
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Date du contrat', citation: 'Nous faisons suite au contrat de prestation du 12 mars 2021.', value: '12 MARS 2021' }, markdownOf);
  addLink(projectPath, { source: CONTRACT, relation: 'states', target: 'Objet de la lettre', citation: MARKDOWN[CONTRACT], value: 'prestation' }, markdownOf);
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Objet de la lettre', citation: 'Nous contestons la facture.', value: 'facture' }, markdownOf);

  assert.deepEqual(contradictions(projectPath), [{
    fait: '/_faits/prix-du-contrat.md',
    titre: 'Prix du contrat',
    valeurs: [
      { piece: `/${CONTRACT}.md`, valeur: '5 000 euros' },
      { piece: `/${LETTER}.md`, valeur: '4 000 euros' },
    ],
  }]);
});

test('factsFromReviews lit les colonnes de fait des revues JSON du dossier', () => {
  const { projectPath, documents, markdownOf } = dossier();
  const folder = path.join(projectPath, REVIEW_FOLDER);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'revue.json'), JSON.stringify({
    version: 1,
    title: 'Revue de test',
    templateName: 'Modèle de test',
    projectPath,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    provider: 'mistral',
    model: 'modele-test',
    concurrency: 1,
    columns: [
      { index: 0, name: 'Statut du contrat', prompt: 'Le contrat est-il résilié ?', format: 'text', fact: 'single' },
      { index: 1, name: 'Ton du courrier', prompt: 'Quel ton ?', format: 'text', fact: 'checkpoint' },
      { index: 2, name: 'Note libre', prompt: 'Note', format: 'text' },
    ],
    rows: [{ id: 'row-1', label: 'Courrier', documents: [], status: 'done', piece: LETTER }],
    cells: {
      'row-1': {
        '0': { summary: 'résilié', flag: 'ok', reasoning: '', citations: [{ document: LETTER, quote: 'Il est résilié.', verified: true }] },
        '1': { summary: 'ferme', flag: 'ok', reasoning: '', citations: [{ document: LETTER, quote: 'Nous contestons la facture.', verified: false }] },
        '2': { summary: 'sans objet', flag: 'ok', reasoning: '', citations: [{ document: LETTER, quote: 'Monsieur,', verified: true }] },
      },
    },
  }));
  fs.writeFileSync(path.join(folder, 'bruit.json'), '{}');
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'texte');

  const facts = factsFromReviews(projectPath);
  assert.deepEqual(facts.map((fact) => [fact.id, fact.single, fact.statements.length]), [
    ['/_faits/statut-du-contrat.md', true, 1],
    ['/_faits/ton-du-courrier.md', false, 0],
  ]);
  assert.deepEqual(facts[0].statements, [{ candidates: [LETTER], quote: 'Il est résilié.', value: 'résilié' }]);

  buildBundle({ projectPath, documents, markdownOf, reviewFacts: facts, now: NOW });
  assert.deepEqual(relationsOf(concept(projectPath, LETTER).frontmatter).states, [{ target: '/_faits/statut-du-contrat.md', citation: 'Il est résilié.', origin: 'piecemaker/tabular-review', value: 'résilié' }]);
  assert.equal(fs.existsSync(conceptFile(projectPath, '/_faits/ton-du-courrier.md')), true);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});
