import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { REVIEW_FOLDER } from '../../../../plugins/piecemaker-tabular-review/src/shared.js';

import type { SourceDocument, SourceParty } from '../build.js';
import { buildBundle, datesIn } from '../build.js';
import { bundleRoot, conceptFile, parseConcept, readBundle, relationsOf } from '../bundle.js';
import { graphGaps, premiseEvidence } from '../premises.js';
import { premisesFromReviews } from '../reviews.js';
import type { ReviewPremise } from '../reviews.js';
import { addLink, removeLink } from '../links.js';
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
const RESILIATION_ID = '/_premises/montant-de-la-facture.md';

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
  fs.writeFileSync(path.join(projectPath, 'Pièces', 'Premiseure.pdf'), '');

  const errors = verifyBundle({ projectPath, resources: [...resources, 'Pièces/Premiseure.pdf'], markdownOf }).map((entry) => `${entry.fiche} | ${entry.erreur}`);
  assert.deepEqual(errors, [
    '/Hors classement.pdf.md | type « Non classé » hors arborescence (Pièces, Projets)',
    `/${LETTER}.md | relation inconnue : annule (amends, responds-to, refers-to, supersedes, states, mentions)`,
    `/${LETTER}.md | annule → /Pièces/Absent.pdf.md : cible absente du dossier`,
    `/${LETTER}.md | refers-to → /${CONTRACT}.md : citation introuvable dans le document`,
    '/Pièces/Premiseure.pdf.md | document sans fiche : relancer l\'analyse du dossier',
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

  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Nous contestons la facture.', value: '  1 200   euros ', single: true }, markdownOf);
  const premise = parseConcept(fs.readFileSync(conceptFile(projectPath, RESILIATION_ID), 'utf8'));
  assert.equal(premise.frontmatter.type, 'Premise');
  assert.equal(premise.frontmatter.title, 'Montant de la facture');
  assert.equal(premise.frontmatter.single_value, true);

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

test('involves relie une prémisse à une partie sans citation', () => {
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

test('une colonne de revue devient une prémisse liée à la pièce citée, un lien écarté ne revient pas', () => {
  const { projectPath, documents, markdownOf } = dossier();
  const reviewPremises: ReviewPremise[] = [
    { id: '/_premises/statut-du-contrat.md', title: 'Statut du contrat', description: 'Le contrat est-il résilié ?', single: true, statements: [{ candidates: [LETTER], quote: 'Il est résilié.', value: 'résilié' }] },
    { id: '/_premises/validite-du-contrat.md', title: 'Validité du contrat', description: 'Le contrat est-il valable ?', single: false, statements: [{ candidates: ['Projets/Absent.docx'], quote: 'Le contrat de prestation du 12 mars 2021 est nul.', value: 'nul' }] },
  ];
  buildBundle({ projectPath, documents, markdownOf, reviewPremises, now: NOW });

  assert.deepEqual(relationsOf(concept(projectPath, LETTER).frontmatter).states, [{ target: '/_premises/statut-du-contrat.md', citation: 'Il est résilié.', origin: 'piecemaker/tabular-review', value: 'résilié' }]);
  assert.deepEqual(relationsOf(concept(projectPath, DRAFT).frontmatter).states, [{ target: '/_premises/validite-du-contrat.md', citation: 'Le contrat de prestation du 12 mars 2021 est nul.', origin: 'piecemaker/tabular-review', value: 'nul' }]);
  const premise = parseConcept(fs.readFileSync(conceptFile(projectPath, '/_premises/statut-du-contrat.md'), 'utf8'));
  assert.equal(premise.frontmatter.single_value, true);
  assert.deepEqual(premise.frontmatter.generated, { by: 'piecemaker/tabular-review', at: NOW });
  assert.equal(parseConcept(fs.readFileSync(conceptFile(projectPath, '/_premises/validite-du-contrat.md'), 'utf8')).frontmatter.single_value, undefined);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);

  removeLink(projectPath, { source: LETTER, relation: 'states', target: '/_premises/statut-du-contrat.md' });
  buildBundle({ projectPath, documents, markdownOf, reviewPremises });
  const states = relationsOf(concept(projectPath, LETTER).frontmatter).states;
  assert.equal(states.length, 1);
  assert.equal(states[0].dismissed, true);
  assert.equal(fs.existsSync(conceptFile(projectPath, '/_premises/statut-du-contrat.md')), true);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('contradictions signale une prémisse à valeur unique écrite avec deux valeurs distinctes', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  addLink(projectPath, { source: CONTRACT, relation: 'states', target: 'Prix du contrat', citation: MARKDOWN[CONTRACT], value: '5 000 euros', single: true }, markdownOf);
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Prix du contrat', citation: 'Nous faisons suite au contrat de prestation du 12 mars 2021.', value: '4 000 euros' }, markdownOf);
  addLink(projectPath, { source: CONTRACT, relation: 'states', target: 'Date du contrat', citation: MARKDOWN[CONTRACT], value: '12 mars 2021', single: true }, markdownOf);
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Date du contrat', citation: 'Nous faisons suite au contrat de prestation du 12 mars 2021.', value: '12 MARS 2021' }, markdownOf);
  addLink(projectPath, { source: CONTRACT, relation: 'states', target: 'Objet de la lettre', citation: MARKDOWN[CONTRACT], value: 'prestation' }, markdownOf);
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Objet de la lettre', citation: 'Nous contestons la facture.', value: 'facture' }, markdownOf);

  assert.deepEqual(contradictions(projectPath), [{
    premise: '/_premises/prix-du-contrat.md',
    titre: 'Prix du contrat',
    valeurs: [
      { piece: `/${CONTRACT}.md`, valeur: '5 000 euros' },
      { piece: `/${LETTER}.md`, valeur: '4 000 euros' },
    ],
  }]);
});

test('premisesFromReviews lit les colonnes de prémisse des revues JSON du dossier', () => {
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
      { index: 0, name: 'Statut du contrat', prompt: 'Le contrat est-il résilié ?', format: 'text', premise: 'single' },
      { index: 1, name: 'Ton du courrier', prompt: 'Quel ton ?', format: 'text', premise: 'checkpoint' },
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

  const premises = premisesFromReviews(projectPath);
  assert.deepEqual(premises.map((premise) => [premise.id, premise.single, premise.statements.length]), [
    ['/_premises/statut-du-contrat.md', true, 1],
    ['/_premises/ton-du-courrier.md', false, 0],
  ]);
  assert.deepEqual(premises[0].statements, [{ candidates: [LETTER], quote: 'Il est résilié.', value: 'résilié' }]);

  buildBundle({ projectPath, documents, markdownOf, reviewPremises: premises, now: NOW });
  assert.deepEqual(relationsOf(concept(projectPath, LETTER).frontmatter).states, [{ target: '/_premises/statut-du-contrat.md', citation: 'Il est résilié.', origin: 'piecemaker/tabular-review', value: 'résilié' }]);
  assert.equal(fs.existsSync(conceptFile(projectPath, '/_premises/ton-du-courrier.md')), true);
  assert.deepEqual(verifyBundle({ projectPath, resources, markdownOf }), []);
});

test('un index antérieur sous /_faits/ est migré vers /_premises/', () => {
  const { projectPath, documents, markdownOf } = dossier();
  buildBundle({ projectPath, documents, markdownOf });
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Nous contestons la facture.' }, markdownOf);
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
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Nous contestons la facture.', value: '1 200 euros' }, markdownOf);
  assert.deepEqual(premiseEvidence(projectPath, `okf:${RESILIATION_ID}`), { id: RESILIATION_ID, title: 'Montant de la facture', pieces: [{ resource: LETTER, title: 'Courrier.pdf', citation: 'Nous contestons la facture.', value: '1 200 euros' }] });
  assert.equal(premiseEvidence(projectPath, 'okf:/_faits/montant-de-la-facture.md')?.id, RESILIATION_ID);
  assert.equal(premiseEvidence(projectPath, 'okf:/_premises/inconnue.md'), null);
});

test('graphGaps liste les éléments manquants du graphe', () => {
  const { projectPath, documents, markdownOf } = dossier();
  const parties: SourceParty[] = [{ code: PERSON, side: 'client' }, { code: COMPANY, side: 'adversaire' }];
  const build = () => buildBundle({ projectPath, documents: documents.map((document) => ({ ...document, parties: document.parties.filter((party) => party.code === PERSON) })), markdownOf, parties });
  build();
  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Nous contestons la facture.', single: true }, markdownOf);
  build();
  const program = path.join(projectPath, '.piecemaker', 'catala', 'demo');
  fs.mkdirSync(program, { recursive: true });
  const doc = (title: string, source: string) => `#[doc=${JSON.stringify(`titre: ${title}\nsource: ${source}`)}]`;
  fs.writeFileSync(path.join(program, 'demo.catala_fr'), ['```catala', doc('Prémisse absente', 'okf:/_premises/inconnue.md'), 'définition a égal à vrai', doc('Pièce directe', 'Pièces/Contrat.pdf'), 'définition b égal à vrai', '```', ''].join('\n'));

  const gaps = graphGaps(projectPath).map((gap) => `${gap.element} | ${gap.manque}`);
  assert.ok(gaps.includes(`${RESILIATION_ID} | prémisse à valeur unique sans valeur`));
  assert.ok(gaps.includes(`${RESILIATION_ID} | prémisse sans partie concernée (involves)`));
  assert.ok(gaps.includes(`${RESILIATION_ID} | prémisse citée par aucun programme Catala`));
  assert.ok(gaps.includes(`/_parties/${COMPANY}.md | partie sans mention dans une pièce ni prémisse qui la concerne`));
  assert.ok(gaps.some((gap) => /demo\.catala_fr:\d+ \| #\[doc\] cite une prémisse absente de l'index : \/_premises\/inconnue\.md/.test(gap)));
  assert.ok(gaps.some((gap) => /demo\.catala_fr:\d+ \| #\[doc\] cite une pièce directement \(Pièces\/Contrat\.pdf\)/.test(gap)));
  assert.equal(gaps.some((gap) => gap.startsWith(`/${LETTER}.md`)), false);
  assert.deepEqual([...new Set(graphGaps(projectPath).filter((gap) => gap.element.includes('demo.catala_fr')).flatMap((gap) => gap.programmes ?? []))], ['demo']);
  assert.equal(graphGaps(projectPath).find((gap) => gap.element === RESILIATION_ID)?.programmes, undefined);

  addLink(projectPath, { source: LETTER, relation: 'states', target: 'Montant de la facture', citation: 'Nous contestons la facture.', value: '1 200 euros', single: true }, markdownOf);
  addLink(projectPath, { source: 'Montant de la facture', relation: 'involves', target: PERSON }, markdownOf);
  fs.writeFileSync(path.join(program, 'demo.catala_fr'), ['```catala', doc('Montant', `okf:${RESILIATION_ID}`), 'définition a égal à vrai', '```', ''].join('\n'));
  assert.deepEqual(graphGaps(projectPath).filter((gap) => gap.element === RESILIATION_ID || gap.element.includes('catala')), []);
});

function backendOf(projectPath: string, markdownOf: (resource: string) => string | null) {
  return createOkfBackend({
    projects: { getProjectById: () => ({ project_path: projectPath }), getProjectPath: () => ({ project_id: 'p', project_path: projectPath }) },
    snapshot: (projectId) => ({ projectId, nodes: [], links: [], mappings: [], citations: [] }),
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
