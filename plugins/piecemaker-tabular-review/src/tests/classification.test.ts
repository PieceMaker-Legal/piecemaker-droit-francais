import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Review } from '../shared.js';
import { classificationColumn, DEFAULT_CLASSIFICATION, REVIEW_FOLDER } from '../shared.js';
import { classifiedFolder, newNotes, newPieces, plannedChange, targetPath } from '../client/sorting.js';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-classement-')));
const project = path.join(home, 'Dossier Exemple');
vi.stubEnv('HOME', home);
vi.stubEnv('USERPROFILE', home);

const { assistant } = await import('../server/assistant.js');
const { readClassification, saveClassification } = await import('../server/classification.js');
const { appendRows, createReview, listReviews, readReview } = await import('../server/reviews.js');
const { deleteDraft, listDrafts } = await import('../server/drafts.js');

const launchers = () => ({
  isRunning: () => false,
  launchAnalysis: vi.fn(),
  launchResearch: vi.fn(),
  appendDocuments: vi.fn(async () => ({ project, file: 'revue.json', status: 'running' as const, review: {} as never })),
});

const reviewOf = (cellValue: string, source = 'Fichiers convertis PieceMaker/bail.md'): Review => ({
  version: 1,
  title: 'Chronologie',
  templateName: 'Chronologie',
  category: 'documents',
  projectPath: project,
  createdAt: '',
  updatedAt: '',
  provider: 'claude',
  model: 'haiku',
  concurrency: 1,
  columns: [{ index: 0, ...classificationColumn(DEFAULT_CLASSIFICATION) }],
  rows: [{ id: 'r1', label: 'bail', documents: [{ name: 'bail', source, markdownFile: 'bail.md' }], status: 'done' }],
  cells: { r1: { 0: { summary: cellValue, flag: 'green', reasoning: '' } } },
} as unknown as Review);

const pieces = [{ path: 'bail.pdf', status: 'ready', markdown: 'Fichiers convertis PieceMaker/bail.md' }];

function writeReview(file: string) {
  fs.mkdirSync(path.join(project, REVIEW_FOLDER), { recursive: true });
  const review = reviewOf('Archives', 'Notes/bail.md');
  review.columns.unshift({ index: 1, name: 'Date', prompt: 'Date ?', format: 'date' });
  fs.writeFileSync(path.join(project, REVIEW_FOLDER, file), JSON.stringify(review));
}

beforeAll(() => {
  fs.mkdirSync(path.join(project, 'Notes'), { recursive: true });
  fs.writeFileSync(path.join(project, 'Notes', 'bail.md'), '# Bail');
  fs.writeFileSync(path.join(project, 'Notes', 'nouveau.md'), '# Nouveau');
  fs.mkdirSync(path.join(home, '.piecemaker'), { recursive: true });
  fs.writeFileSync(path.join(home, '.piecemaker', 'projects.json'), JSON.stringify({ sources: { test: [project] } }));
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('arborescence du dossier', () => {
  it('propose la base puis enregistre l’arborescence de l’avocat', async () => {
    expect(readClassification(project).map((folder) => folder.name)).toEqual(['Projets', 'Pièces', 'Archives', 'Notes et recherches']);
    await saveClassification(project, [{ name: 'Procédure/Actes', explanation: 'Actes de procédure.' }]);
    expect(readClassification(project)).toEqual([{ name: 'Procédure/Actes', explanation: 'Actes de procédure.' }]);
    await saveClassification(project, DEFAULT_CLASSIFICATION);
  });

  it.each(['', '../hors', '.cache', 'a//b', 'Tabular Review', 'a:b'])('refuse le dossier « %s »', async (name) => {
    await expect(saveClassification(project, [{ name, explanation: '' }])).rejects.toThrow('Nom de dossier invalide');
  });

  it('refuse les doublons et une arborescence vide', async () => {
    await expect(saveClassification(project, [{ name: 'A' }, { name: 'a' }])).rejects.toThrow('même nom');
    await expect(saveClassification(project, [])).rejects.toThrow('au moins un dossier');
  });

  it('reporte l’arborescence sur la colonne des analyses du dossier', async () => {
    writeReview('reportee.json');
    await saveClassification(project, [{ name: 'Clients', explanation: 'Échanges avec le client.' }]);
    const review = JSON.parse(fs.readFileSync(path.join(project, REVIEW_FOLDER, 'reportee.json'), 'utf8')) as Review;
    const column = review.columns.find((entry) => entry.action === 'classify');
    expect(column?.tags).toEqual(['Clients']);
    expect(column?.prompt).toContain('Clients : Échanges avec le client.');
    await saveClassification(project, DEFAULT_CLASSIFICATION);
  });
});

describe('effet du classement', () => {
  it('range la pièce dont le Markdown est le document analysé', () => {
    const review = reviewOf('Archives');
    expect(classifiedFolder(review, review.rows[0])).toBe('Archives');
    expect(targetPath(plannedChange(review, review.rows[0], [], pieces)!)).toBe('Archives/bail.pdf');
  });

  it('ignore une réponse hors arborescence et une ligne sans pièce', () => {
    const review = reviewOf('Divers');
    expect(plannedChange(review, review.rows[0], [], pieces)).toBeNull();
    const orphan = reviewOf('Archives', 'Notes/libre.md');
    expect(plannedChange(orphan, orphan.rows[0], [], pieces)).toBeNull();
  });

  it('laisse en place une pièce déjà rangée dans ce dossier ou un sous-dossier', () => {
    const review = reviewOf('Archives');
    const row = { ...review.rows[0], piece: 'Archives/2023/bail.pdf' };
    expect(plannedChange(review, row, [], pieces)).toBeNull();
  });

  it('n’ajoute pas deux fois le même document, même si deux ajouts se chevauchent', async () => {
    writeReview('doublon.json');
    const rows = [{ label: 'nouveau', documents: ['Notes/nouveau.md'] }];
    const [first, second] = await Promise.all([appendRows(project, 'doublon.json', rows), appendRows(project, 'doublon.json', rows)]);
    expect([first.length, second.length]).toEqual([1, 0]);
    expect(await appendRows(project, 'doublon.json', [{ label: 'bail', documents: ['Notes/bail.md'] }])).toEqual([]);
    expect(readReview(project, 'doublon.json').rows.map((row) => row.label)).toEqual(['bail', 'nouveau']);
  });

  it('repère les nouveaux documents par leur Markdown', () => {
    const review = reviewOf('Archives');
    const arrived = { path: 'courrier.pdf', status: 'ready', markdown: null };
    expect(newPieces(review, [...pieces, arrived])).toEqual([arrived]);
    const note = { path: 'Notes/libre.md', name: 'libre', size: 1, updatedAt: '' };
    const converted = { path: 'Fichiers convertis PieceMaker/bail.md', name: 'bail', size: 1, updatedAt: '' };
    expect(newNotes(review, [note, converted] as never, pieces)).toEqual([note]);
  });
});

describe('un seul inventaire intégral par dossier', () => {
  const settings = { provider: 'claude' as const, model: 'haiku', concurrency: 1 };
  const template = { id: 't', name: 'Chronologie', description: '', updatedAt: '', columns: [{ name: 'Date', prompt: 'Date ?', format: 'date' as const }] };
  const rows = [{ label: 'bail', documents: ['Notes/bail.md'] }];
  const dossier = path.join(home, 'Dossier Unique');
  const fichiers = () => listReviews([dossier], () => false).map((review) => review.file);

  beforeAll(() => {
    fs.mkdirSync(path.join(dossier, 'Notes'), { recursive: true });
    fs.writeFileSync(path.join(dossier, 'Notes', 'bail.md'), '# Bail');
    fs.writeFileSync(path.join(home, '.piecemaker', 'projects.json'), JSON.stringify({ sources: { test: [project, dossier] } }));
  });

  it.each([
    [{ modele: 'Chronologie' }],
    [{ modele: 'Inventaire intégral des pièces' }],
    [{ nom: 'Scan intégral du dossier', documents: ['Notes'], questions: [{ nom: 'Date', consigne: 'Date ?' }] }],
    [{ modele: 'Tri des pièces' }],
    [{ nom: 'Chronologie des faits', documents: ['Notes'], questions: [{ nom: 'Date', consigne: 'Date ?' }] }],
    [{ nom: 'Tri des pièces', documents: ['Notes'] }],
  ])('preparer %j ne crée pas de second projet', async (demande) => {
    const run = launchers();
    const unique = await assistant({ action: 'inventaire', project: dossier }, run) as { projet: string };
    const reponse = await assistant({ action: 'preparer', project: dossier, ...demande }, run) as { projet: string; suite: string };
    expect(reponse.projet).toBe(unique.projet);
    expect(reponse.suite).toContain('Une seule analyse');
    expect(listDrafts([dossier])).toHaveLength(1);
    deleteDraft(unique.projet);
  });

  it('garde le classement et le nom quand l’agent complète le projet', async () => {
    const run = launchers();
    const unique = await assistant({ action: 'inventaire', project: dossier }, run) as { projet: string };
    const complete = await assistant({ action: 'preparer', project: dossier, projet: unique.projet, nom: 'Autre', questions: [{ nom: 'Montant', consigne: 'Quel montant ?' }] }, run) as { nom: string; questions: string[]; chronologie: boolean };
    expect(complete).toMatchObject({ nom: 'Inventaire intégral des pièces', questions: ['Montant', 'Classement'], inventaire: true });
    deleteDraft(unique.projet);
  });

  it('laisse les analyses classiques et les recherches indépendantes', async () => {
    const run = launchers();
    const classique = await assistant({ action: 'preparer', project: dossier, nom: 'Baux', documents: ['Notes'], questions: [{ nom: 'Prix', consigne: 'Quel prix ?' }] }, run) as { projet: string; inventaire?: boolean };
    const recherche = await assistant({ action: 'preparer', project: dossier, mode: 'recherche', nom: 'Chronologie de la jurisprudence', questions: [{ nom: 'Solution', consigne: 'Quelle solution ?' }] }, run) as { projet: string; inventaire?: boolean };
    expect(classique.inventaire).toBeUndefined();
    expect(recherche.inventaire).toBeUndefined();
    expect(listDrafts([dossier])).toHaveLength(2);
    deleteDraft(classique.projet);
    deleteDraft(recherche.projet);
  });

  it('ne crée jamais une seconde analyse et retrouve la première', async () => {
    const premiere = createReview(dossier, template, 'Chronologie', rows, settings);
    const seconde = createReview(dossier, template, 'Chronologie', rows, settings);
    const autreNom = createReview(dossier, template, 'Faits du dossier', rows, settings);
    expect([premiere.created, seconde.created, autreNom.created]).toEqual([true, false, false]);
    expect(fichiers()).toEqual([premiere.file]);
    const run = launchers();
    expect(await assistant({ action: 'inventaire', project: dossier }, run)).toEqual({ fichier: premiere.file });
    expect(await assistant({ action: 'preparer', project: dossier, modele: 'Chronologie' }, run)).toMatchObject({ fichier: premiere.file });
    const listed = await assistant({ action: 'lister', project: dossier }, run) as { analyses: { fichier: string; inventaire?: boolean }[] };
    expect(listed.analyses).toEqual([expect.objectContaining({ fichier: premiere.file, inventaire: true })]);
  });

  it('crée une analyse classique à côté de la chronologie, sans classement pour l’agent', async () => {
    const classique = createReview(dossier, { ...template, name: 'Analyse de contrat' }, 'Baux', rows, settings);
    expect(classique.created).toBe(true);
    await expect(assistant({ action: 'classement', project: dossier, fichier: classique.file }, launchers())).rejects.toThrow('inventaire');
  });
});

describe('outil tabular_review', () => {
  it('lit une analyse et modifie ses colonnes', async () => {
    writeReview('lecture.json');
    const run = launchers();
    const read = await assistant({ action: 'lire', project, fichier: `${REVIEW_FOLDER}/lecture.json` }, run) as { colonnes: { colonne: number; action?: string }[]; lignes: { reponses: Record<string, string> }[] };
    expect(read.colonnes.map((column) => column.colonne)).toEqual([1, 0]);
    expect(read.lignes[0].reponses['0']).toBe('Archives');
    const edited = await assistant({ action: 'colonnes', project, fichier: 'lecture.json', questions: [
      { colonne: 1, nom: 'Date du document' },
      { nom: 'Montant', consigne: 'Quel montant ?', format: 'amount' },
    ] }, run) as { colonnes: { colonne: number; nom?: string }[] };
    expect(edited.colonnes.map((column) => column.colonne)).toEqual([1, 0, 2]);
    const removed = await assistant({ action: 'colonnes', project, fichier: 'lecture.json', questions: [{ colonne: 2, supprimer: true }] }, run) as { colonnes: unknown[] };
    expect(removed.colonnes).toHaveLength(2);
  });

  it('protège la colonne de classement et refuse une analyse en cours', async () => {
    writeReview('protegee.json');
    const run = launchers();
    await expect(assistant({ action: 'colonnes', project, fichier: 'protegee.json', questions: [{ colonne: 0, consigne: 'Autre' }] }, run)).rejects.toThrow('arborescence');
    await expect(assistant({ action: 'colonnes', project, fichier: 'protegee.json', questions: [{ colonne: 1, nom: 'X' }] }, { ...run, isRunning: () => true })).rejects.toThrow('Attendez');
  });

  it('lit et remplace l’arborescence', async () => {
    const run = launchers();
    await assistant({ action: 'arborescence', project, dossiers: [{ nom: 'Clients', explication: 'Échanges.' }] }, run);
    expect(await assistant({ action: 'arborescence', project }, run)).toEqual({ dossiers: [{ nom: 'Clients', explication: 'Échanges.' }] });
    await saveClassification(project, DEFAULT_CLASSIFICATION);
  });

  it('ajoute la colonne une seule fois', async () => {
    fs.mkdirSync(path.join(project, REVIEW_FOLDER), { recursive: true });
    const plain = reviewOf('');
    plain.columns = [{ index: 3, name: 'Date', prompt: 'Date ?', format: 'date' }];
    fs.writeFileSync(path.join(project, REVIEW_FOLDER, 'simple.json'), JSON.stringify(plain));
    const run = launchers();
    await assistant({ action: 'classement', project, fichier: 'simple.json' }, run);
    const again = await assistant({ action: 'classement', project, fichier: 'simple.json' }, run) as { colonnes: { colonne: number }[] };
    expect(again.colonnes.map((column) => column.colonne)).toEqual([3, 4]);
  });

  it('relance seulement sur les documents nouveaux', async () => {
    writeReview('relance.json');
    const run = launchers();
    expect(await assistant({ action: 'relancer', project, fichier: 'relance.json' }, run)).toMatchObject({ ajoutes: 1 });
    expect(run.appendDocuments).toHaveBeenCalledWith(expect.objectContaining({ file: 'relance.json', rows: [{ label: 'nouveau', documents: ['Notes/nouveau.md'] }] }));
  });
});
