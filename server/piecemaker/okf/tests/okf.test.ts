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
import { addLink as addLinkTo, linkReview, markExamined as markExaminedOf, removeLink as removeLinkOf, unlinkReview, unmarkExamined as unmarkExaminedOf } from '../links.js';
import { createOkfStore } from '../store.js';
import { LEGAL_DOCUMENT, LEGAL_POSITION, MATERIAL_ENTITY } from '../lof.js';
import { ontologyFile, readOntology, migrateArborescence, saveOntology } from '../ontology.js';
import { createOkfBackend } from '../index.js';
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
  saveOntology(projectPath, { arborescence: [{ name: 'Pièces', explanation: '' }, { name: 'Projets', explanation: '' }] });
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
const CREANCE_ID = '/_lof/creance-de-facture.md';

const AT = '2026-01-01T00:00:00.000Z';

test('datesIn reconnaît les dates françaises écrites et chiffrées', () => {
  assert.deepEqual(datesIn('le 1er août 2020 puis le 12/03/2021').map((entry) => entry.date), ['2020-08-01', '2021-03-12']);
});

test('la construction écrit une fiche OKF par document, de classe LOF, sans lien entre pièces', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf, now: NOW });
  const letter = concept(projectPath, LETTER);
  assert.equal(letter.frontmatter.type, 'Pièces');
  assert.equal(letter.frontmatter.resource, LETTER);
  assert.equal(letter.frontmatter.lof, LEGAL_DOCUMENT);
  assert.deepEqual(letter.frontmatter.generated, { by: 'piecemaker/gliner', at: NOW });
  assert.equal(letter.frontmatter.relations, undefined);
  assert.equal(concept(projectPath, DRAFT).frontmatter.type, 'Projets');
  const index = fs.readFileSync(path.join(bundleRoot(projectPath), 'index.md'), 'utf8');
  assert.match(index, /^---\nokf_version: "0.2"\n---\n\n# Pièces\n/);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('une reconstruction sans changement ne réécrit rien', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf, now: NOW });
  assert.deepEqual(buildBundle({ projectPath, documents, markdownOf, now: '2026-02-02T00:00:00.000Z' }), { written: 0, removed: 0 });
});

test('un lien LOF est contrôlé, conservé à la reconstruction et suit un renommage', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  const evidences = { source: LETTER, relation: 'evidences', target: 'Créance de facture', target_class: 'legal position', piece: LETTER, citation: 'Nous contestons la facture.' };
  assert.throws(() => addLink(projectPath, { ...evidences, relation: 'annule' }, markdownOf), /propriété hors LOF : « annule »/);
  assert.throws(() => addLink(projectPath, { ...evidences, citation: 'Phrase absente.' }, markdownOf), /citation introuvable/);
  assert.throws(() => addLink(projectPath, { ...evidences, target_class: undefined }, markdownOf), /nouvelle fiche « Créance de facture » sans classe/);
  assert.throws(() => addLink(projectPath, { ...evidences, target_class: 'créance' }, markdownOf), /classe hors LOF/);
  assert.throws(() => addLink(projectPath, { source: LETTER, relation: 'amends', target: CONTRACT, piece: LETTER, citation: 'Il est résilié.' }, markdownOf), /hors du domaine de « amends »/);
  assert.throws(() => addLink(projectPath, { source: 'Résiliation', source_class: 'legal act', relation: 'amends', target: CONTRACT, piece: LETTER, citation: 'Il est résilié.' }, markdownOf), /hors du codomaine de « amends »/);
  assert.equal(fs.existsSync(conceptFile(projectPath, CREANCE_ID)), false);
  assert.deepEqual(addLink(projectPath, { ...evidences, source: `${LETTER}.md.md` }, markdownOf, undefined, AT), { source: `/${LETTER}.md`, relation: 'evidences', target: CREANCE_ID });
  addLink(projectPath, { source: CONTRACT, relation: 'evidences', target: 'Créance de facture', piece: CONTRACT, citation: MARKDOWN[CONTRACT] }, markdownOf, undefined, AT);

  const moved = 'Pièces/Contrat signé.pdf';
  fs.renameSync(path.join(projectPath, CONTRACT), path.join(projectPath, moved));
  const renamedDocuments = documents.map((document) => document.resource === CONTRACT ? { ...document, resource: moved } : document);
  const renamedMarkdown = (resource: string) => resource === moved ? MARKDOWN[CONTRACT] : markdownOf(resource);
  buildBundle({ projectPath, documents: renamedDocuments, markdownOf: renamedMarkdown, renamed: { previous: CONTRACT, current: moved } });

  assert.deepEqual(relationsOf(concept(projectPath, moved).frontmatter).evidences.map((entry) => [entry.target, entry.piece]), [[CREANCE_ID, `/${moved}.md`]]);
  assert.equal(fs.existsSync(conceptFile(projectPath, `/${CONTRACT}.md`)), false);
  assert.deepEqual(verifyBundle({ projectPath, resources: [moved, LETTER, DRAFT], markdownOf: renamedMarkdown }), []);
});

test('la vérification signale propriétés hors LOF, cibles et documents sans fiche', () => {
  const { projectPath, documents, markdownOf } = dossier();
  fs.writeFileSync(path.join(projectPath, 'Hors classement.pdf'), '');
  buildBundle({ projectPath, documents: [...documents, { resource: 'Hors classement.pdf', title: 'Hors classement.pdf', nature: '', date: '', parties: [] }], markdownOf });
  const letterFile = conceptFile(projectPath, `/${LETTER}.md`);
  fs.writeFileSync(letterFile, fs.readFileSync(letterFile, 'utf8').replace(`\nresource: ${LETTER}`, `\nrelations:\n  annule:\n    - target: /Pièces/Contrat.pdf.md\n      citation: Il est résilié.\n      origin: piecemaker/agent\n  evidences:\n    - target: /Pièces/Absent.pdf.md\n      citation: Il est résilié.\n      origin: piecemaker/agent\nresource: ${LETTER}`));
  fs.writeFileSync(path.join(projectPath, 'Pièces', 'Annexe.pdf'), '');

  const errors = verifyBundle({ projectPath, resources: [...resources, 'Pièces/Annexe.pdf'], markdownOf }).map((entry) => `${entry.fiche} | ${entry.erreur}`);
  assert.deepEqual(errors, [
    `/${LETTER}.md | relation hors LOF : annule`,
    `/${LETTER}.md | evidences → /Pièces/Absent.pdf.md : cible absente du dossier`,
    '/Pièces/Annexe.pdf.md | document sans fiche : lancer pm dossier conversion, qui convertit puis analyse le dossier et écrit les fiches',
  ]);
});

test('les parties de la liste du dossier sont des « material entity »', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf, parties: [{ code: PERSON, side: 'client' }], now: NOW });
  const person = parseConcept(fs.readFileSync(conceptFile(projectPath, PERSON_ID), 'utf8'));
  assert.equal(person.frontmatter.type, 'material entity');
  assert.equal(person.frontmatter.lof, MATERIAL_ENTITY);
  assert.equal(person.frontmatter.title, PERSON);
  assert.equal(person.frontmatter.description, 'Partie cliente');
  assert.equal(person.frontmatter.side, 'client');
  assert.equal(relationsOf(concept(projectPath, CONTRACT).frontmatter).mentions, undefined);
  assert.equal(fs.existsSync(conceptFile(projectPath, `/_parties/${COMPANY}.md`)), false);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('une fiche LOF créée par un lien garde sa classe, survit à la reconstruction et disparaît sans lien', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  addLink(projectPath, { source: LETTER, relation: 'evidences', target: 'Créance de facture', target_class: 'legal position', piece: LETTER, citation: 'Nous contestons la facture.' }, markdownOf, undefined, AT);
  buildBundle({ projectPath, documents, markdownOf, now: '2026-02-02T00:00:00.000Z' });
  const entity = parseConcept(fs.readFileSync(conceptFile(projectPath, CREANCE_ID), 'utf8'));
  assert.equal(entity.frontmatter.type, 'legal position');
  assert.equal(entity.frontmatter.lof, LEGAL_POSITION);
  assert.equal(entity.frontmatter.title, 'Créance de facture');
  assert.throws(() => addLink(projectPath, { source: LETTER, relation: 'evidences', target: 'Créance de facture', target_class: 'legal act', piece: LETTER, citation: 'Il est résilié.' }, markdownOf), /déjà de classe « legal position »/);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);

  removeLink(projectPath, { source: LETTER, relation: 'evidences', target: 'Créance de facture' });
  assert.equal(relationsOf(concept(projectPath, LETTER).frontmatter).evidences, undefined);
  assert.equal(fs.existsSync(conceptFile(projectPath, CREANCE_ID)), false);
});

test('held by relie une position juridique à une seule partie', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf, parties: [{ code: PERSON, side: 'client' }, { code: COMPANY, side: 'adversaire' }] });
  const heldBy = { source: 'Créance de facture', source_class: 'legal position', relation: 'held by', target: PERSON, piece: CONTRACT, citation: MARKDOWN[CONTRACT] };
  assert.throws(() => addLink(projectPath, { ...heldBy, target_class: 'legal position' }, markdownOf), /une partie est une « material entity »/);
  assert.deepEqual(addLink(projectPath, heldBy, markdownOf, undefined, AT), { source: CREANCE_ID, relation: 'held by', target: PERSON_ID });
  assert.throws(() => addLink(projectPath, { ...heldBy, target: COMPANY }, markdownOf), /« held by » est fonctionnelle/);
  assert.deepEqual(relationsOf(parseConcept(fs.readFileSync(conceptFile(projectPath, CREANCE_ID), 'utf8')).frontmatter)['held by'].map((entry) => [entry.target, entry.piece]), [[PERSON_ID, `/${CONTRACT}.md`]]);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('contradictions compare les dates d’un même instant après normalisation', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  const date = (title: string, value: string, piece: string) => addLink(projectPath, { source: title, source_class: 'temporal instant', relation: 'has date-time value', value, piece, citation: piece === CONTRACT ? MARKDOWN[CONTRACT] : 'Nous contestons la facture.' }, markdownOf, undefined, AT);
  assert.throws(() => date('Date de signature', 'demain', CONTRACT), /AAAA-MM-JJ/);
  assert.throws(() => addLink(projectPath, { source: 'Créance de facture', source_class: 'legal position', relation: 'has date-time value', value: '2024-03-03', piece: CONTRACT, citation: MARKDOWN[CONTRACT] }, markdownOf), /hors du domaine de « has date-time value »/);
  date('Date de signature', '3 mars 2024', CONTRACT);
  date('Date de signature', '03/03/2024', LETTER);
  date('Date de réception', '2024-03-03', CONTRACT);
  date('Date de réception', '2024-03-04', LETTER);
  assert.deepEqual(contradictions(projectPath), [{
    premise: '/_lof/date-de-reception.md',
    titre: 'Date de réception',
    valeurs: [{ piece: `/${CONTRACT}.md`, valeur: '2024-03-03' }, { piece: `/${LETTER}.md`, valeur: '2024-03-04' }],
  }]);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('premiseEvidence donne les pièces citées d’une fiche LOF', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  addLink(projectPath, { source: LETTER, relation: 'evidences', target: 'Créance de facture', target_class: 'legal position', piece: LETTER, citation: 'Nous contestons la facture.' }, markdownOf, undefined, AT);
  assert.deepEqual(premiseEvidence(projectPath, `okf:${CREANCE_ID}`), { id: CREANCE_ID, title: 'Créance de facture', pieces: [{ resource: LETTER, title: 'Courrier.pdf', citation: 'Nous contestons la facture.', value: '', origin: 'piecemaker/agent' }] });
  assert.equal(premiseEvidence(projectPath, 'okf:/_lof/inconnue.md'), null);
});

test('graphGaps part des positions juridiques et des parties', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf, parties: [{ code: PERSON, side: 'client' }, { code: COMPANY, side: 'adversaire' }] });
  addLink(projectPath, { source: LETTER, relation: 'evidences', target: 'Créance de facture', target_class: 'legal position', piece: LETTER, citation: 'Nous contestons la facture.' }, markdownOf, undefined, AT);
  const gapOf = (element: string) => graphGaps(projectPath).filter((gap) => gap.element === element).map((gap) => gap.manque);
  assert.match(gapOf(CREANCE_ID)[0], /^legal position incomplète : « held by », /);
  assert.deepEqual(gapOf(PERSON_ID), ['partie sans lien LOF cité']);
  assert.deepEqual(gapOf(`/${LETTER}.md`), []);

  addLink(projectPath, { source: 'Créance de facture', relation: 'held by', target: PERSON, piece: CONTRACT, citation: MARKDOWN[CONTRACT] }, markdownOf, undefined, AT);
  assert.match(gapOf(CREANCE_ID)[0], /^legal position du client incomplète : /);
  assert.doesNotMatch(gapOf(CREANCE_ID)[0], /held by/);
  assert.deepEqual(gapOf(PERSON_ID), []);
  assert.deepEqual(gapOf(`/_parties/${COMPANY}.md`), ['partie sans lien LOF cité']);
});

test('sans partie qualifiée, le titulaire d’une position attend l’avocat et dit où qualifier', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  addLink(projectPath, { source: LETTER, relation: 'evidences', target: 'Créance de facture', target_class: 'legal position', piece: LETTER, citation: 'Nous contestons la facture.' }, markdownOf, undefined, AT);
  const gap = graphGaps(projectPath).find((entry) => entry.element === CREANCE_ID && entry.avocat);
  assert.match(gap?.manque ?? '', /sans titulaire \(held by\) : attend l’avocat.*onglet Dossier, vue générale.*ne la qualifie pas toi-même/);
});

test('examinee marque une pièce examinée sans lien jusqu\'à ce que le document change', () => {
  const { projectPath, documents, markdownOf } = dossier();
  const build = () => buildBundle({ projectPath, documents, markdownOf });
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

test('le type principal suit le dossier choisi et ses sous-dossiers sans déplacer les pièces', () => {
  const { projectPath, documents, markdownOf } = dossier();
  saveOntology(projectPath, { arborescence: [
    { name: 'Pièces', type: 'Archives', explanation: '' },
    { name: 'Pièces/Contrats', explanation: '' },
    { name: 'Projets', type: 'Pièces', explanation: '' },
  ] });
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
  addLink(projectPath, { source: LETTER, relation: 'evidences', target: 'Créance de facture', target_class: 'legal position', piece: LETTER, citation: 'Nous contestons la facture.' }, markdownOf, undefined, AT);
  markExamined(projectPath, { source: DRAFT, motif: 'Projet sans lien.' }, undefined, AT);
  fs.rmSync(bundleRoot(projectPath), { recursive: true, force: true });
  buildBundle({ projectPath, documents, markdownOf, now: NOW });
  assert.deepEqual(relationsOf(concept(projectPath, LETTER).frontmatter).evidences.map((entry) => [entry.target, entry.citation]), [[CREANCE_ID, 'Nous contestons la facture.']]);
  assert.equal((concept(projectPath, DRAFT).frontmatter.examen_sans_lien as { motif: string }).motif, 'Projet sans lien.');
  const letterFile = conceptFile(projectPath, `/${LETTER}.md`);
  fs.writeFileSync(letterFile, fs.readFileSync(letterFile, 'utf8').replace('relations:', 'relations:\n  amends:\n    - target: /Pièces/Contrat.pdf.md\n      citation: Il est résilié.\n      origin: piecemaker/agent'));
  buildBundle({ projectPath, documents, markdownOf, now: NOW });
  assert.equal(relationsOf(concept(projectPath, LETTER).frontmatter).amends, undefined);
  assert.equal(okf(projectPath).store.records('p').relations.filter((entry) => ['amends', 'ODP005_0001100'].includes(entry.relation)).length, 0);
});

test('une revue tabulaire ne crée ni ne supprime de fiche LOF', () => {
  const { projectPath, documents, markdownOf } = dossier();
  const folder = path.join(projectPath, REVIEW_FOLDER);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'revue.json'), JSON.stringify({ columns: [{ index: 0, name: 'Statut du contrat', prompt: 'Résilié ?', format: 'text' }], rows: [{ id: 'r', label: 'Courrier', documents: [], status: 'done', piece: LETTER }], cells: { r: { 0: { summary: 'résilié', citations: [{ document: LETTER, quote: 'Il est résilié.', verified: true }] } } } }));
  buildBundle({ projectPath, documents, markdownOf, now: NOW });
  assert.equal(fs.existsSync(conceptFile(projectPath, '/_lof/statut-du-contrat.md')), false);
  addLink(projectPath, { source: LETTER, relation: 'evidences', target: 'Statut du contrat', target_class: 'legal position', piece: LETTER, citation: 'Il est résilié.' }, markdownOf, undefined, AT);
  fs.rmSync(folder, { recursive: true });
  buildBundle({ projectPath, documents, markdownOf, now: NOW });
  assert.equal(fs.existsSync(conceptFile(projectPath, '/_lof/statut-du-contrat.md')), true);
});

test('l\'arborescence est commune, scellée avec l\'ontologie, et reprise une fois des anciens dossiers', () => {
  const { projectPath } = dossier();
  fs.rmSync(ontologyFile(), { force: true });
  const older = dossier().projectPath;
  fs.rmSync(ontologyFile(), { force: true });
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

test('une revue liée à une fiche LOF la prouve par ses lignes positives, d\'auteur agent puis humain une fois vérifiées', () => {
  const { projectPath, documents, markdownOf } = dossier();
  const folder = path.join(projectPath, REVIEW_FOLDER);
  fs.mkdirSync(folder, { recursive: true });
  const reviewPath = path.join(folder, 'resiliation.json');
  const cells = {
    r1: { 0: { summary: 'Oui, le contrat est résilié', flag: 'red', reasoning: '', citations: [{ document: 'Courrier.pdf', quote: 'Il est résilié.', verified: true }] } },
    r2: { 0: { summary: 'Non', flag: 'grey', reasoning: '', citations: [{ document: 'Contrat.pdf', quote: 'Contrat de prestation', verified: true }] } },
    r3: { 0: { summary: 'Non trouvé', flag: 'grey', reasoning: '', citations: [] } },
  };
  const review = { version: 1, title: 'Résiliations', category: 'documents', columns: [{ index: 0, name: 'Résilié', prompt: 'Le contrat est-il résilié ?', format: 'yes_no' }], rows: [
    { id: 'r1', label: 'Courrier', documents: [{ source: LETTER, copy: 'x', chars: 1 }], status: 'done' },
    { id: 'r2', label: 'Contrat', documents: [{ source: CONTRACT, copy: 'y', chars: 1 }], status: 'done' },
    { id: 'r3', label: 'Conclusions', documents: [{ source: DRAFT, copy: 'z', chars: 1 }], status: 'done' },
  ], cells };
  fs.writeFileSync(reviewPath, JSON.stringify(review));
  buildBundle({ projectPath, documents, markdownOf, now: NOW });

  assert.throws(() => linkReview(okf(projectPath), { premise: 'Résiliation du contrat', fichier: 'resiliation.json', colonne: 'résilié' }), /sans classe/);
  assert.throws(() => linkReview(okf(projectPath), { premise: 'Résiliation du contrat', classe: 'legal act', fichier: 'resiliation.json', colonne: 'Inconnue' }), /aucune colonne « Inconnue »/);
  const link = rebuilt(projectPath, linkReview(okf(projectPath), { premise: 'Résiliation du contrat', classe: 'legal act', fichier: 'resiliation.json', colonne: 'résilié' }, 'piecemaker/agent', AT));
  assert.deepEqual(link, { premise: '/_lof/resiliation-du-contrat.md', fichier: 'resiliation.json', colonne: 0 });
  const entity = parseConcept(fs.readFileSync(conceptFile(projectPath, link.premise), 'utf8'));
  assert.equal(entity.frontmatter.type, 'legal act');
  assert.deepEqual(entity.frontmatter.revues, [{ fichier: 'resiliation.json', colonne: 0, by: 'piecemaker/agent', at: AT }]);
  assert.match(entity.body, /# Revues tabulaires/);
  assert.match(entity.body, /Oui, le contrat est résilié \(agent, non vérifiée\)\n  > Il est résilié\./);
  assert.doesNotMatch(entity.body, /Contrat de prestation/);

  const piece = { resource: LETTER, title: 'Courrier.pdf', citation: 'Il est résilié.', value: 'Oui, le contrat est résilié', origin: 'piecemaker/tabular-review', author: 'agent', review: 'resiliation.json' };
  assert.deepEqual(premiseEvidence(projectPath, `okf:${link.premise}`)?.pieces, [piece]);
  assert.ok(!graphGaps(projectPath).some((gap) => gap.element === link.premise && /sans pièce citée/.test(gap.manque)));

  cells.r1[0] = { ...cells.r1[0], checked: { at: AT } } as typeof cells.r1[0];
  fs.writeFileSync(reviewPath, JSON.stringify(review));
  assert.equal(premiseEvidence(projectPath, `okf:${link.premise}`)?.pieces[0].author, 'human');
  const view = backendOf(projectPath, markdownOf).read('p').fiches.find((fiche) => fiche.id === link.premise);
  assert.equal(view?.revues?.[0].lignes[0].author, 'human');

  fs.rmSync(reviewPath);
  assert.ok(verifyBundle({ projectPath, resources, markdownOf }).some((entry) => entry.fiche === link.premise && /revue tabulaire introuvable/.test(entry.erreur)));
  rebuilt(projectPath, unlinkReview(okf(projectPath), { premise: 'Résiliation du contrat', fichier: 'resiliation.json', colonne: 0 }));
  assert.equal(fs.existsSync(conceptFile(projectPath, link.premise)), false);
});

test('une recherche juridique ne se lie pas à une fiche LOF', () => {
  const { projectPath, documents, markdownOf } = dossier();
  const folder = path.join(projectPath, REVIEW_FOLDER);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'recherche.json'), JSON.stringify({ category: 'recherche-juridique', columns: [{ index: 0, name: 'Solution', format: 'text' }], rows: [], cells: {} }));
  buildBundle({ projectPath, documents, markdownOf, now: NOW });
  assert.throws(() => linkReview(okf(projectPath), { premise: 'Solution', classe: 'legal act', fichier: 'recherche.json', colonne: 0 }), /recherche juridique/);
  assert.deepEqual(backendOf(projectPath, markdownOf).read('p').fiches.filter((fiche) => fiche.type === 'legal act'), []);
});
