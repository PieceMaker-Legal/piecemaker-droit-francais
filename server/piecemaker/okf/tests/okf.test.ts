import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { REVIEW_FOLDER } from '../../../../plugins/piecemaker-tabular-review/src/shared.js';

import type { MarkdownOf, Renamed, SourceDocument, SourceParty } from '../build.js';
import { buildBundle as writeBundle, datesIn, documentsFromSnapshot, legacyRecords } from '../build.js';
import { bundleRoot, conceptFile, parseConcept, readBundle, readTypes, relationsOf } from '../bundle.js';
import { graphGaps, graphReport, premiseEvidence } from '../premises.js';
import type { ExamInput, LinkInput, OkfTarget } from '../links.js';
import { addLink as addLinkTo, markExamined as markExaminedOf, removeLink as removeLinkOf, unmarkExamined as unmarkExaminedOf } from '../links.js';
import { createOkfStore } from '../store.js';
import { graphTypesOf, ontologyFile, readOntology, saveOntology } from '../ontology.js';
import { createOkfBackend } from '../index.js';
import { proposalFile, proposeOntology, readProposal, storedOntologyErrors } from '../ontology-proposal.js';
import { contradictions, quoted, verifyBundle } from '../verify.js';

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
process.env.PIECEMAKER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'okf-home-'));

// Each case has its SQLite base, the source of the OKF; fiches are rebuilt after each write, as createOkfBackend does.
type BuildInput = { projectPath: string; documents: SourceDocument[]; markdownOf: MarkdownOf; parties?: SourceParty[]; renamed?: Renamed; now?: string };
const targets = new Map<string, OkfTarget>();
const builds = new Map<string, BuildInput>();
function okf(projectPath: string): OkfTarget {
  if (!targets.has(projectPath)) {
    const database = new Database(':memory:');
    database.exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY); INSERT INTO projects VALUES('p');");
    targets.set(projectPath, { projectPath, projectId: 'p', store: createOkfStore(database) });
  }
  return targets.get(projectPath) as OkfTarget;
}
function buildBundle(input: BuildInput) {
  const { store, projectId } = okf(input.projectPath);
  builds.set(input.projectPath, { ...input, renamed: undefined });
  store.importOnce(projectId, legacyRecords(input.projectPath), NOW);
  if (input.renamed) store.rename(projectId, `/${input.renamed.previous}.md`, `/${input.renamed.current}.md`);
  return writeBundle({ ...input, records: store.records(projectId) });
}
const rebuilt = <T>(projectPath: string, result: T): T => {
  const input = builds.get(projectPath);
  if (input) buildBundle(input);
  return result;
};
const addLink = (projectPath: string, input: LinkInput, markdownOf: MarkdownOf, origin?: string, now?: string) => rebuilt(projectPath, addLinkTo(okf(projectPath), input, markdownOf, origin, now));
const removeLink = (projectPath: string, input: LinkInput) => rebuilt(projectPath, removeLinkOf(okf(projectPath), input));
const markExamined = (projectPath: string, input: ExamInput, origin?: string, now?: string) => rebuilt(projectPath, markExaminedOf(okf(projectPath), input, origin, now));
const unmarkExamined = (projectPath: string, input: ExamInput) => rebuilt(projectPath, unmarkExaminedOf(okf(projectPath), input));

function dossier(): { projectPath: string; documents: SourceDocument[]; markdownOf: (resource: string) => string | null } {
  fs.rmSync(ontologyFile(), { force: true });
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
const RESILIATION_ID = '/_premises/montant-de-la-facture.md';

const AT = '2026-01-01T00:00:00.000Z';

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
  assert.throws(() => addLink(projectPath, { source: DRAFT, relation: 'amends', target: CONTRACT, citation: MARKDOWN[DRAFT] }, markdownOf), /L'ontologie admet amends depuis : Pièces/);
  assert.throws(() => addLink(projectPath, { source: LETTER, relation: 'annule', target: CONTRACT, citation: 'Il est résilié.' }, markdownOf), /relation hors ontologie/);
  assert.throws(() => addLink(projectPath, { source: 'Pièces/Absent.pdf.md', relation: 'amends', target: CONTRACT, citation: 'Il est résilié.' }, markdownOf), /source : aucune fiche \/Pièces\/Absent\.pdf\.md\.md\. Vérifier le chemin : les fiches sont listées dans/);
  assert.deepEqual(addLink(projectPath, { source: `${LETTER}.md.md`, relation: 'amends', target: `${CONTRACT}.md`, citation: 'Il est résilié.' }, markdownOf, undefined, AT), { source: `/${LETTER}.md`, relation: 'amends', target: `/${CONTRACT}.md` });
  addLink(projectPath, { source: LETTER, relation: 'amends', target: CONTRACT, citation: 'Il est résilié.' }, markdownOf, undefined, AT);

  const moved = 'Pièces/Contrat signé.pdf';
  fs.renameSync(path.join(projectPath, CONTRACT), path.join(projectPath, moved));
  const renamedDocuments = documents.map((document) => document.resource === CONTRACT ? { ...document, resource: moved } : document);
  const renamedMarkdown = (resource: string) => resource === moved ? MARKDOWN[CONTRACT] : markdownOf(resource);
  buildBundle({ projectPath, documents: renamedDocuments, markdownOf: renamedMarkdown, renamed: { previous: CONTRACT, current: moved } });

  assert.deepEqual(relationsOf(concept(projectPath, LETTER).frontmatter).amends, [{ target: `/${moved}.md`, citation: 'Il est résilié.', origin: 'piecemaker/agent', at: AT }]);
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
  fs.writeFileSync(path.join(projectPath, 'Pièces', 'Premiseure.pdf'), '');

  const errors = verifyBundle({ projectPath, resources: [...resources, 'Pièces/Premiseure.pdf'], markdownOf }).map((entry) => `${entry.fiche} | ${entry.erreur}`);
  assert.deepEqual(errors, [
    '/Hors classement.pdf.md | type « Non classé » hors arborescence (Pièces, Projets)',
    `/${LETTER}.md | relation hors ontologie : annule (relations admises : amends, responds-to, refers-to, supersedes, states, mentions)`,
    `/${LETTER}.md | annule → /Pièces/Absent.pdf.md : cible absente du dossier`,
    `/${LETTER}.md | refers-to → /${CONTRACT}.md : citation introuvable dans le document`,
    '/Pièces/Premiseure.pdf.md | document sans fiche : lancer pm dossier conversion, qui convertit puis analyse le dossier et écrit les fiches',
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

test('une prémisse liée à une pièce crée sa fiche, garde la valeur et survit à la reconstruction', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  assert.throws(() => addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Phrase absente.' }, markdownOf), /citation introuvable/);
  assert.equal(fs.existsSync(conceptFile(projectPath, RESILIATION_ID)), false);

  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Nous contestons la facture.', value: '  1 200   euros ', single: true }, markdownOf, undefined, AT);
  const premise = parseConcept(fs.readFileSync(conceptFile(projectPath, RESILIATION_ID), 'utf8'));
  assert.equal(premise.frontmatter.type, 'Premise');
  assert.equal(premise.frontmatter.title, 'Montant de la facture');
  assert.equal(premise.frontmatter.single_value, true);

  buildBundle({ projectPath, documents, markdownOf, now: '2026-02-02T00:00:00.000Z' });
  assert.deepEqual(relationsOf(concept(projectPath, LETTER).frontmatter).states, [{ target: RESILIATION_ID, citation: 'Nous contestons la facture.', origin: 'piecemaker/agent', at: AT, value: '1 200 euros' }]);
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

test('involves relie une prémisse à une partie sans citation', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf, parties: [{ code: PERSON, side: 'client' }] });
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Nous contestons la facture.' }, markdownOf, undefined, AT);
  assert.throws(() => addLink(projectPath, { source: 'Montant de la facture', relation: 'involves', target: 'INCONNU_01' }, markdownOf), (error: Error) => error.message.includes(`n'est pas une partie du dossier. Parties : ${PERSON}.`) && error.message.includes('ne la qualifie pas toi-même'));

  addLink(projectPath, { source: 'Montant de la facture', relation: 'involves', target: PERSON }, markdownOf, undefined, AT);
  buildBundle({ projectPath, documents, markdownOf, parties: [{ code: PERSON, side: 'client' }] });
  assert.deepEqual(relationsOf(parseConcept(fs.readFileSync(conceptFile(projectPath, RESILIATION_ID), 'utf8')).frontmatter).involves, [{ target: PERSON_ID, citation: '', origin: 'piecemaker/agent', at: AT }]);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('supersedes relie deux pièces comme amends', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  assert.throws(() => addLink(projectPath, { source: DRAFT, relation: 'supersedes', target: CONTRACT, citation: MARKDOWN[DRAFT] }, markdownOf), /L'ontologie admet supersedes depuis : Pièces/);
  addLink(projectPath, { source: LETTER, relation: 'supersedes', target: CONTRACT, citation: 'Il est résilié.' }, markdownOf, undefined, AT);
  buildBundle({ projectPath, documents, markdownOf });
  assert.deepEqual(relationsOf(concept(projectPath, LETTER).frontmatter).supersedes, [{ target: `/${CONTRACT}.md`, citation: 'Il est résilié.', origin: 'piecemaker/agent', at: AT }]);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('contradictions signale une prémisse à valeur unique écrite avec deux valeurs distinctes', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  addLink(projectPath, { source: CONTRACT, relation: 'states', target: 'Prix du contrat', citation: MARKDOWN[CONTRACT], value: '5 000 euros', single: true }, markdownOf, undefined, AT);
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Prix du contrat', citation: 'Nous faisons suite au contrat de prestation du 12 mars 2021.', value: '4 000 euros' }, markdownOf, undefined, AT);
  addLink(projectPath, { source: CONTRACT, relation: 'states', target: 'Date du contrat', citation: MARKDOWN[CONTRACT], value: '12 mars 2021', single: true }, markdownOf, undefined, AT);
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Date du contrat', citation: 'Nous faisons suite au contrat de prestation du 12 mars 2021.', value: '12 MARS 2021' }, markdownOf, undefined, AT);
  addLink(projectPath, { source: CONTRACT, relation: 'states', target: 'Objet de la lettre', citation: MARKDOWN[CONTRACT], value: 'prestation' }, markdownOf, undefined, AT);
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Objet de la lettre', citation: 'Nous contestons la facture.', value: 'facture' }, markdownOf, undefined, AT);

  assert.deepEqual(contradictions(projectPath), [{
    premise: '/_premises/prix-du-contrat.md',
    titre: 'Prix du contrat',
    valeurs: [
      { piece: `/${CONTRACT}.md`, valeur: '5 000 euros' },
      { piece: `/${LETTER}.md`, valeur: '4 000 euros' },
    ],
  }]);
});

test('un index antérieur sous /_faits/ est migré vers /_premises/', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Nous contestons la facture.' }, markdownOf, undefined, AT);
  const legacy = '/_faits/montant-de-la-facture.md';
  const letterFile = conceptFile(projectPath, `/${LETTER}.md`);
  fs.writeFileSync(letterFile, fs.readFileSync(letterFile, 'utf8').replace(RESILIATION_ID, legacy));
  fs.mkdirSync(path.dirname(conceptFile(projectPath, legacy)), { recursive: true });
  fs.writeFileSync(conceptFile(projectPath, legacy), fs.readFileSync(conceptFile(projectPath, RESILIATION_ID), 'utf8').replace('type: Premise', 'type: Fait'));
  fs.rmSync(conceptFile(projectPath, RESILIATION_ID));

  buildBundle({ projectPath, documents, markdownOf });
  assert.equal(relationsOf(concept(projectPath, LETTER).frontmatter).states?.[0].target, RESILIATION_ID);
  assert.equal(parseConcept(fs.readFileSync(conceptFile(projectPath, RESILIATION_ID), 'utf8')).frontmatter.type, 'Premise');
  assert.equal(fs.existsSync(conceptFile(projectPath, legacy)), false);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('premiseEvidence donne les pièces citées d’une prémisse', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Nous contestons la facture.', value: '1 200 euros' }, markdownOf, undefined, AT);
  assert.deepEqual(premiseEvidence(projectPath, `okf:${RESILIATION_ID}`), { id: RESILIATION_ID, title: 'Montant de la facture', pieces: [{ resource: LETTER, title: 'Courrier.pdf', citation: 'Nous contestons la facture.', origin: 'piecemaker/agent', value: '1 200 euros' }] });
  assert.equal(premiseEvidence(projectPath, 'okf:/_faits/montant-de-la-facture.md')?.id, RESILIATION_ID);
  assert.equal(premiseEvidence(projectPath, 'okf:/_premises/inconnue.md'), null);
});

test('graphGaps liste les éléments manquants du graphe', () => {
  const { projectPath, documents, markdownOf } = dossier();
  const parties: SourceParty[] = [{ code: PERSON, side: 'client' }, { code: COMPANY, side: 'adversaire' }];
  const build = () => buildBundle({ projectPath, documents: documents.map((document) => ({ ...document, parties: document.parties.filter((party) => party.code === PERSON) })), markdownOf, parties });
  build();
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Nous contestons la facture.', single: true }, markdownOf, undefined, AT);
  build();
  const gaps = graphGaps(projectPath).map((gap) => `${gap.element} | ${gap.manque}`);
  assert.ok(gaps.includes(`${RESILIATION_ID} | prémisse à valeur unique sans valeur`));
  assert.ok(gaps.includes(`${RESILIATION_ID} | prémisse sans partie concernée (involves) : pm okf link "Montant de la facture" involves <CODE_PARTIE>`));
  assert.ok(gaps.includes(`/_parties/${COMPANY}.md | partie sans mention dans une pièce ni prémisse qui la concerne`));
  assert.equal(gaps.some((gap) => gap.startsWith(`/${LETTER}.md`)), false);

  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Nous contestons la facture.', value: '1 200 euros', single: true }, markdownOf, undefined, AT);
  addLink(projectPath, { source: 'Montant de la facture', relation: 'involves', target: PERSON }, markdownOf, undefined, AT);
  assert.deepEqual(graphGaps(projectPath).filter((gap) => gap.element === RESILIATION_ID), []);
});

test('sans partie qualifiée, le manque involves attend l\'avocat et dit où qualifier', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Nous contestons la facture.' }, markdownOf, undefined, AT);
  const gap = graphGaps(projectPath).find((entry) => entry.element === RESILIATION_ID && entry.manque.includes('involves'));
  assert.equal(gap?.avocat, true);
  assert.match(gap?.manque ?? '', /attend l’avocat.*onglet Dossier, vue générale.*ne la qualifie pas toi-même/);
});

test('examinee marque une pièce examinée sans lien jusqu\'à ce que le document change', () => {
  const { projectPath, documents, markdownOf } = dossier();
  const build = () => buildBundle({ projectPath, documents, markdownOf });
  build();
  removeLink(projectPath, { source: LETTER, relation: 'refers-to', target: CONTRACT });
  build();
  const pieceGaps = () => graphReport(projectPath).manques.filter((gap) => gap.element.startsWith('/Pièces/'));
  assert.deepEqual(pieceGaps().map((gap) => gap.element).sort(), [`/${CONTRACT}.md`, `/${LETTER}.md`]);
  assert.match(pieceGaps()[0].manque, /^pièce à examiner : .* pm okf examinee <pièce> --motif "…"$/);
  assert.throws(() => markExamined(projectPath, { source: LETTER, motif: '  ' }), /motif absent/);
  assert.throws(() => unmarkExamined(projectPath, { source: LETTER }), /n'est pas marquée/);

  const motif = 'Courrier isolé : il ne cite aucune autre pièce.';
  markExamined(projectPath, { source: LETTER, motif }, undefined, AT);
  build();
  assert.deepEqual(graphReport(projectPath).examinees, [{ element: `/${LETTER}.md`, motif, by: 'piecemaker/agent', at: AT }]);
  assert.deepEqual(pieceGaps().map((gap) => gap.element), [`/${CONTRACT}.md`]);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);

  fs.writeFileSync(path.join(projectPath, LETTER), 'nouvelle version');
  assert.deepEqual(graphReport(projectPath).examinees, []);
  assert.match(pieceGaps().find((gap) => gap.element === `/${LETTER}.md`)?.manque || '', /^pièce modifiée depuis son examen sans lien du 2026-01-01 : /);

  markExamined(projectPath, { source: LETTER, motif }, undefined, AT);
  assert.equal(pieceGaps().length, 1);
  unmarkExamined(projectPath, { source: LETTER });
  assert.equal(concept(projectPath, LETTER).frontmatter.examen_sans_lien, undefined);
  assert.equal(pieceGaps().length, 2);
});

function backendOf(projectPath: string, markdownOf: (resource: string) => string | null) {
  return createOkfBackend({
    projects: { getProjectById: () => ({ project_path: projectPath }), getProjectPath: () => ({ project_id: 'p', project_path: projectPath }) },
    snapshot: (projectId) => ({ projectId, nodes: [], links: [], mappings: [], citations: [] }),
    store: okf(projectPath).store,
    convertedMarkdown: (_projectPath, filePath) => markdownOf(path.relative(projectPath, filePath)),
    listDocuments: async () => resources.map((resource) => path.join(projectPath, resource)),
    isLoopback: () => true,
  });
}

const filesUnder = (directory: string): string[] => fs.readdirSync(directory, { recursive: true }).map(String).sort();

test('verify lit les fiches telles qu\'elles sont sur le disque et signale une fiche modifiée à la main', async () => {
  const { projectPath: createdPath, documents, markdownOf } = dossier();
  const projectPath = fs.realpathSync(createdPath);
  buildBundle({ projectPath, documents, markdownOf });
  const letterFile = conceptFile(projectPath, `/${LETTER}.md`);
  fs.writeFileSync(letterFile, fs.readFileSync(letterFile, 'utf8').replace(`resource: ${LETTER}`, `resource: ${CONTRACT}`));
  const { erreurs } = await backendOf(projectPath, markdownOf).verify('p');
  assert.ok(erreurs.some((entry) => entry.fiche === `/${LETTER}.md` && entry.erreur.startsWith('la fiche ne correspond pas à son document')));
});

test('read n\'écrit aucun fichier', () => {
  const { projectPath: createdPath, documents, markdownOf } = dossier();
  const projectPath = fs.realpathSync(createdPath);
  buildBundle({ projectPath, documents, markdownOf });
  fs.rmSync(conceptFile(projectPath, `/${LETTER}.md`));
  const before = filesUnder(projectPath);
  const view = backendOf(projectPath, markdownOf).read('p');
  assert.deepEqual(filesUnder(projectPath), before);
  assert.equal(view.fiches.some((fiche) => fiche.resource === LETTER), false);
});

test('quoted accepte les apostrophes typographiques et une ellipse au milieu', () => {
  const markdown = 'Article 3 : l’avenant du contrat\u00A0est conclu. Le prix est fixé à 5 000 euros.';
  assert.equal(quoted(markdown, "l'avenant du contrat est conclu."), true);
  assert.equal(quoted("l'avenant du contrat est conclu.", 'l’avenant du contrat est conclu.'), true);
  assert.equal(quoted(markdown, 'avenant … 5 000 euros'), true);
  assert.equal(quoted(markdown, 'avenant ... 5 000 euros'), true);
  assert.equal(quoted(markdown, '5 000 euros … avenant'), false);
  assert.equal(quoted(markdown, '…Le prix est fixé'), true);
  assert.equal(quoted(markdown, 'avenant … prix inconnu'), false);
});

test('contradictions normalise les dates avant de comparer', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  const states = (title: string, value: string, source = CONTRACT, single = false) => addLink(projectPath, { source, relation: 'states', target: title, citation: source === CONTRACT ? MARKDOWN[CONTRACT] : 'Nous contestons la facture.', value, single }, markdownOf);
  states('Date de signature', '3 mars 2024', CONTRACT, true);
  states('Date de signature', '03/03/2024', LETTER);
  states('Date de réception', '3 mars 2024', CONTRACT, true);
  states('Date de réception', '4 mars 2024', LETTER);
  assert.deepEqual(contradictions(projectPath).map((entry) => entry.titre), ['Date de réception']);
  assert.deepEqual(contradictions(projectPath)[0].valeurs.map((entry) => entry.valeur), ['3 mars 2024', '4 mars 2024']);
});

test('l\'ontologie par défaut reprend les quatre relations entre pièces', () => {
  const { projectPath } = dossier();
  const ontology = readOntology(projectPath);
  assert.equal(ontology.personnalisee, false);
  assert.deepEqual(ontology.relations.map((relation) => [relation.name, relation.source, relation.target]), [
    ['amends', ['Pièces'], ['Pièces']],
    ['responds-to', ['Pièces'], ['Pièces']],
    ['refers-to', ['Pièces'], ['Pièces']],
    ['supersedes', ['Pièces'], ['Pièces']],
  ]);
});

test('l\'ontologie enregistrée refuse les noms, types et relations système invalides', () => {
  const { projectPath } = dossier();
  const relation = { name: 'conteste', label: 'conteste', source: ['Projets'], target: ['Pièces'] };
  assert.throws(() => saveOntology(projectPath, { relations: [{ ...relation, name: 'Conteste' }] }), /minuscules/);
  assert.throws(() => saveOntology(projectPath, { relations: [{ ...relation, name: 'states' }] }), /relation système/);
  assert.throws(() => saveOntology(projectPath, { relations: [relation, relation] }), /en double/);
  assert.throws(() => saveOntology(projectPath, { relations: [{ ...relation, source: ['Premise'] }] }), /type réservé/);
  const saved = saveOntology(projectPath, { relations: [relation] });
  assert.deepEqual(saved.relations, [{ ...relation, inverse: 'conteste', description: '' }]);
  assert.equal(saved.personnalisee, true);
});

test('les liens, le scan et la vérification suivent l\'ontologie globale', () => {
  const { projectPath, documents, markdownOf } = dossier();
  saveOntology(projectPath, { relations: [{ name: 'conteste', label: 'conteste', inverse: 'contesté par', source: ['Projets'], target: ['Pièces'] }] });
  buildBundle({ projectPath, documents, markdownOf });
  assert.equal(relationsOf(concept(projectPath, LETTER).frontmatter)['refers-to'], undefined);
  assert.throws(() => addLink(projectPath, { source: LETTER, relation: 'amends', target: CONTRACT, citation: 'Il est résilié.' }, markdownOf), /relation hors ontologie : « amends »\. Relations admises : conteste, states, involves/);
  assert.throws(() => addLink(projectPath, { source: LETTER, relation: 'conteste', target: CONTRACT, citation: 'Il est résilié.' }, markdownOf), /source : .* L'ontologie admet conteste depuis : Projets/);
  assert.throws(() => addLink(projectPath, { source: DRAFT, relation: 'conteste', target: DRAFT, citation: MARKDOWN[DRAFT] }, markdownOf), /lui-même/);
  addLink(projectPath, { source: DRAFT, relation: 'conteste', target: CONTRACT, citation: MARKDOWN[DRAFT] }, markdownOf, undefined, AT);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
  assert.deepEqual(graphGaps(projectPath).map((gap) => gap.element).filter((element) => element.startsWith('/Pièces/')), [`/${LETTER}.md`]);

  saveOntology(projectPath, { relations: [] });
  const errors = verifyBundle({ projectPath, resources, markdownOf }).map((entry) => `${entry.fiche} | ${entry.erreur}`);
  assert.deepEqual(errors, [`/${DRAFT}.md | relation hors ontologie : conteste (relations admises : states, mentions)`]);
  removeLink(projectPath, { source: DRAFT, relation: 'conteste', target: CONTRACT });
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('l\'ontologie globale est commune aux dossiers et ne s\'applique qu\'aux types présents', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  fs.writeFileSync(ontologyFile(), '{ "relations": [ { "name": "Conteste" } ] }');
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf })[0].fiche, '~/.piecemaker/ontologie.json');
  assert.match(verifyBundle({ projectPath, resources, markdownOf })[0].erreur, /ontologie illisible, ontologie par défaut appliquée/);
  assert.ok(verifyBundle({ projectPath, resources, markdownOf }).some((entry) => entry.erreur === 'relation Conteste : clé « label » absente.'));
  const other = dossier().projectPath;
  saveOntology(projectPath, { relations: [{ name: 'conteste', label: 'conteste', source: ['Courriers', 'Projets'], target: ['Pièces'] }] });
  fs.writeFileSync(path.join(other, '.piecemaker', 'arborescence.json'), JSON.stringify([{ name: 'Courriers', explanation: '' }, { name: 'Pièces', explanation: '' }]));
  assert.deepEqual(readOntology(other).relations.map((relation) => relation.name), ['conteste']);
  assert.deepEqual(graphTypesOf(projectPath), ['Projets', 'Pièces']);
  assert.deepEqual(graphTypesOf(other), ['Courriers', 'Pièces']);
  buildBundle({ projectPath, documents, markdownOf });
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('une ontologie modifiée hors du serveur perd son sceau et n\'est pas appliquée', () => {
  const { projectPath } = dossier();
  saveOntology(projectPath, { relations: [{ name: 'conteste', label: 'conteste', source: ['Projets'], target: ['Pièces'] }] });
  assert.equal(readOntology(projectPath).erreur, undefined);
  const stored = JSON.parse(fs.readFileSync(ontologyFile(), 'utf8'));
  stored.relations.push({ name: 'invente', label: 'invente', inverse: 'invente', description: '', source: ['Pièces'], target: ['Pièces'] });
  fs.writeFileSync(ontologyFile(), JSON.stringify(stored));
  const tampered = readOntology(projectPath);
  assert.match(tampered.erreur || '', /modifiée hors de l’onglet Index/);
  assert.deepEqual(tampered.relations.map((relation) => relation.name), ['amends', 'responds-to', 'refers-to', 'supersedes']);
  fs.writeFileSync(ontologyFile(), JSON.stringify({ relations: stored.relations }));
  assert.match(readOntology(projectPath).erreur || '', /modifiée hors de l’onglet Index/);
});

test('l\'assistant propose une ontologie que seul l\'enregistrement de l\'avocat applique', () => {
  const { projectPath: createdPath, markdownOf } = dossier();
  const projectPath = fs.realpathSync(createdPath);
  const backend = backendOf(projectPath, markdownOf);
  backend.saveOntology('p', { relations: [{ name: 'conteste', label: 'conteste', source: ['Projets'], target: ['Pièces'] }, { name: 'annule', label: 'annule', source: ['Pièces'], target: ['Pièces'] }] });
  const saved = backend.ontology('p');
  assert.equal(saved.fichier, ontologyFile());
  const lines = fs.readFileSync(ontologyFile(), 'utf8').replace(/\n$/, '').split('\n');
  assert.equal(saved.total, lines.length);
  assert.equal(lines[saved.total - 1], '}');
  for (const name of ['conteste', 'annule']) {
    const { debut, fin } = saved.lignes[name];
    assert.equal(lines[debut - 1].trim(), '{');
    assert.match(lines[fin - 1].trim(), /^},?$/);
    assert.ok(lines.slice(debut - 1, fin).some((line) => line.includes(`"name": "${name}"`)));
  }
  assert.equal(saved.proposition, null);
  assert.throws(() => proposeOntology(projectPath, { relations: [{ name: 'states', label: 'établit', inverse: '', description: '', source: ['Pièces'], target: ['Pièces'] }] }), /relation système/);
  assert.throws(() => proposeOntology(projectPath, { relations: [{ name: 'conteste', lable: 'conteste', source: ['Projets'], target: ['Pièces'] }] }), (error: Error) => /clé « label » absente/.test(error.message) && /clé « lable » inconnue/.test(error.message) && /clé « inverse » absente/.test(error.message));
  assert.throws(() => proposeOntology(projectPath, { documentTypes: [{ name: 'Contrat', icon: 'inconnue' }, { name: 'contrat', icon: 'pen' }] }), /type Contrat : icône inconnue/);
  assert.throws(() => proposeOntology(projectPath, { documentTypes: [{ name: 'Contrat', icon: 'pen' }, { name: 'contrat', icon: 'pen' }] }), /en double/);
  proposeOntology(projectPath, { relations: [{ name: 'conteste', label: 'conteste', inverse: 'contesté par', description: '', source: ['Projets'], target: ['Pièces', 'Projets'] }], motif: 'Les conclusions contestent aussi des projets.' });
  const pending = backend.ontology('p');
  assert.deepEqual(pending.relations.map((relation) => relation.name), ['conteste', 'annule']);
  assert.deepEqual(pending.proposition?.relations?.[0].target, ['Pièces', 'Projets']);
  assert.equal(pending.proposition?.motif, 'Les conclusions contestent aussi des projets.');
  proposeOntology(projectPath, { documentTypes: [{ name: 'Contrat', icon: 'pen' }] });
  assert.deepEqual(readProposal()?.documentTypes, [{ name: 'Contrat', icon: 'pen' }]);
  assert.equal(readProposal()?.relations?.length, 1);
  backend.saveOntology('p', { relations: pending.proposition!.relations });
  assert.equal(backend.ontology('p').proposition?.relations, undefined);
  assert.deepEqual(backend.ontology('p').proposition?.documentTypes, [{ name: 'Contrat', icon: 'pen' }]);
  assert.deepEqual(readOntology(projectPath).relations.map((relation) => relation.name), ['conteste']);
  fs.writeFileSync(proposalFile(), JSON.stringify({ documentTypes: [{ name: 'Contrat' }], date: '' }));
  assert.deepEqual(storedOntologyErrors(), [{ fiche: '~/.piecemaker/ontologie.proposition.json', erreur: 'type Contrat : clé « icon » absente.' }]);
  proposeOntology(projectPath, { relations: readOntology(projectPath).relations, documentTypes: readOntology(projectPath).documentTypes });
  assert.equal(readProposal(), null);
});


test('le titre descriptif de la revue et sa nature arrivent dans le graphe sans reconstruction', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  const directory = path.join(projectPath, REVIEW_FOLDER);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'index.json'), JSON.stringify({
    category: 'documents', updatedAt: '2026-01-01',
    columns: [{ index: 0, name: 'Titre' }, { index: 1, name: 'Type de pièce' }],
    rows: [{ id: 'r1', piece: CONTRACT, documents: [] }],
    cells: { r1: { 0: { summary: 'Convention de prestation' }, 1: { summary: 'contrat' } } },
  }));
  const before = fs.readFileSync(conceptFile(projectPath, `/${CONTRACT}.md`), 'utf8');
  const view = backendOf(projectPath, markdownOf).read('p');
  assert.equal(view.fiches.find((fiche) => fiche.resource === CONTRACT)?.title, 'Convention de prestation');
  assert.equal(view.fiches.find((fiche) => fiche.resource === CONTRACT)?.icon, 'pen');
  assert.equal(fs.readFileSync(conceptFile(projectPath, `/${CONTRACT}.md`), 'utf8'), before);
  const snapshot = { projectId: 'p', nodes: [{ id: 'document:1', kind: 'document', label: 'Contrat.pdf', data: { path: path.join(projectPath, CONTRACT) }, aliases: [], date: null }], citations: [], links: [], mappings: [] };
  assert.equal(documentsFromSnapshot(projectPath, snapshot as never)[0].title, 'Convention de prestation');
  const reviewFile = path.join(directory, 'index.json');
  const review = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
  review.rows[0].title = { summary: 'Contrat de prestation', citations: [{ quote: 'Contrat de prestation conclu', verified: true }] };
  review.columns = review.columns.filter((entry: { index: number }) => entry.index !== 0);
  delete review.cells.r1[0];
  fs.writeFileSync(reviewFile, JSON.stringify(review));
  const refreshed = backendOf(projectPath, markdownOf).read('p').fiches.find((fiche) => fiche.resource === CONTRACT);
  assert.equal(refreshed?.title, 'Contrat de prestation');
  assert.equal(refreshed?.titleCitation, 'Contrat de prestation conclu');
});

test('le catalogue conserve ses icônes à une sauvegarde des relations et détecte une altération', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  const relations = readOntology(projectPath).relations;
  const documentTypes = [{ name: 'Contrat de prestation', icon: 'scroll' }];
  saveOntology(projectPath, { relations, documentTypes });
  saveOntology(projectPath, { relations });
  assert.deepEqual(readOntology(projectPath).documentTypes, documentTypes);
  assert.equal(backendOf(projectPath, markdownOf).read('p').fiches.find((fiche) => fiche.resource === CONTRACT)?.icon, 'scroll');
  for (const invalid of [[{ name: 'contrat', icon: 'javascript:alert(1)' }], [{ name: 'x', icon: 'file' }, { name: 'X', icon: 'pen' }], [{ name: 'Partie', icon: 'users' }]]) {
    assert.throws(() => saveOntology(projectPath, { relations, documentTypes: invalid }), TypeError);
  }
  const stored = JSON.parse(fs.readFileSync(ontologyFile(), 'utf8'));
  stored.documentTypes[0].icon = 'mail';
  fs.writeFileSync(ontologyFile(), JSON.stringify(stored));
  assert.match(readOntology(projectPath).erreur || '', /sceau|modifiée hors/);
});

test('le type principal suit le dossier choisi et ses sous-dossiers sans déplacer les pièces', () => {
  const { projectPath, documents, markdownOf } = dossier();
  fs.writeFileSync(path.join(projectPath, '.piecemaker', 'arborescence.json'), JSON.stringify([
    { name: 'Pièces', type: 'Archives', explanation: '' },
    { name: 'Pièces/Contrats', explanation: '' },
    { name: 'Projets', type: 'Pièces', explanation: '' },
  ]));
  buildBundle({ projectPath, documents, markdownOf });
  assert.deepEqual(readTypes(projectPath), ['Archives', 'Pièces']);
  assert.equal(concept(projectPath, CONTRACT).frontmatter.type, 'Archives');
  assert.equal(concept(projectPath, DRAFT).frontmatter.type, 'Pièces');
  assert.ok(fs.existsSync(path.join(projectPath, CONTRACT)));
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('SQLite fait foi : une fiche effacée ou modifiée à la main est régénérée avec ses liens', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf, now: NOW });
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Nous contestons la facture.', value: '1 200 euros' }, markdownOf, undefined, AT);
  markExamined(projectPath, { source: DRAFT, motif: 'Projet sans lien.' }, undefined, AT);
  fs.rmSync(bundleRoot(projectPath), { recursive: true, force: true });
  buildBundle({ projectPath, documents, markdownOf, now: NOW });
  assert.deepEqual(relationsOf(concept(projectPath, LETTER).frontmatter).states, [{ target: RESILIATION_ID, citation: 'Nous contestons la facture.', origin: 'piecemaker/agent', at: AT, value: '1 200 euros' }]);
  assert.equal((concept(projectPath, DRAFT).frontmatter.examen_sans_lien as { motif: string }).motif, 'Projet sans lien.');
  const letterFile = conceptFile(projectPath, `/${LETTER}.md`);
  fs.writeFileSync(letterFile, fs.readFileSync(letterFile, 'utf8').replace('relations:', 'relations:\n  amends:\n    - target: /Pièces/Contrat.pdf.md\n      citation: Il est résilié.\n      origin: piecemaker/agent'));
  buildBundle({ projectPath, documents, markdownOf, now: NOW });
  assert.equal(relationsOf(concept(projectPath, LETTER).frontmatter).amends, undefined);
  assert.equal(okf(projectPath).store.records('p').relations.filter((entry) => entry.relation === 'amends').length, 0);
});

test('une revue tabulaire ne crée ni ne supprime de prémisse', () => {
  const { projectPath, documents, markdownOf } = dossier();
  const folder = path.join(projectPath, REVIEW_FOLDER);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'revue.json'), JSON.stringify({ columns: [{ index: 0, name: 'Statut du contrat', prompt: 'Résilié ?', format: 'text', premise: 'single' }], rows: [{ id: 'r', label: 'Courrier', documents: [], status: 'done', piece: LETTER }], cells: { r: { 0: { summary: 'résilié', citations: [{ document: LETTER, quote: 'Il est résilié.', verified: true }] } } } }));
  buildBundle({ projectPath, documents, markdownOf, now: NOW });
  assert.equal(fs.existsSync(conceptFile(projectPath, '/_premises/statut-du-contrat.md')), false);
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Statut du contrat', citation: 'Il est résilié.' }, markdownOf, undefined, AT);
  fs.rmSync(folder, { recursive: true });
  buildBundle({ projectPath, documents, markdownOf, now: NOW });
  assert.equal(fs.existsSync(conceptFile(projectPath, '/_premises/statut-du-contrat.md')), true);
});
