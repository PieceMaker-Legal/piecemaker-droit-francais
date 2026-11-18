import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Review } from '../shared.js';
import { classificationColumn, DEFAULT_CLASSIFICATION, REVIEW_FOLDER } from '../shared.js';
import { classifiedFolder, matchingFolder, newNotes, newPieces, plannedChange, targetPath } from '../client/sorting.js';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-classement-')));
const project = path.join(home, 'Dossier Exemple');
vi.stubEnv('HOME', home);
vi.stubEnv('USERPROFILE', home);

const { assistant } = await import('../server/assistant.js');
const { addClassification, classificationLines, dropClassificationProposal, readClassification, readClassificationProposal, saveClassification } = await import('../server/classification.js');
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

  it('conserve le type principal et refuse un type réservé', async () => {
    const folders = [{ name: 'Documents', explanation: 'Pièces reçues', type: 'Pièces' }];
    await saveClassification(project, folders);
    expect(readClassification(project)).toEqual(folders);
    await expect(saveClassification(project, [{ ...folders[0], type: 'Partie' }])).rejects.toThrow('Type principal invalide');
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

  it('l’agent propose l’arborescence, l’avocat seul l’applique', async () => {
    await saveClassification(project, [{ name: 'Pièces', explanation: '' }, { name: 'Projets', explanation: '' }]);
    const tree = (dossiers: unknown, motif?: string) => assistant({ action: 'arborescence', project, dossiers, motif }, launchers());
    const proposed = await tree([{ nom: 'Pièces/Contrats', explication: 'Contrats signés.' }, { nom: 'Factures' }], 'Isoler les contrats') as { dossiers: unknown; proposition: { dossiers: unknown; motif: string }; message: string };
    expect(proposed.dossiers).toEqual([{ nom: 'Pièces', explication: '' }, { nom: 'Projets', explication: '' }]);
    expect(proposed.proposition).toMatchObject({ dossiers: [{ nom: 'Pièces/Contrats', explication: 'Contrats signés.' }, { nom: 'Factures', explication: '' }], motif: 'Isoler les contrats' });
    expect(proposed.message).toContain('l’avocat');
    expect(readClassification(project).map((folder) => folder.name)).toEqual(['Pièces', 'Projets']);
    expect(readClassificationProposal(project)?.dossiers).toHaveLength(2);
    await expect(tree([{ nom: '.cache' }])).rejects.toThrow('Nom de dossier invalide');
    await saveClassification(project, DEFAULT_CLASSIFICATION);
    expect(readClassificationProposal(project)).toBeNull();
  });

  it('situe chaque dossier dans le fichier pour le chat', async () => {
    await saveClassification(project, [{ name: 'Pièces', explanation: '' }, { name: 'Projets', explanation: 'Actes.' }]);
    const lines = classificationLines(project, readClassification(project));
    expect(lines.fichier).toBe(path.join(home, '.piecemaker', 'ontologie.json'));
    const text = fs.readFileSync(lines.fichier!, 'utf8').split('\n');
    expect(Object.keys(lines.lignes)).toEqual(['Pièces', 'Projets']);
    for (const [name, { debut, fin }] of Object.entries(lines.lignes)) {
      const block = text.slice(debut - 1, fin).join('\n');
      expect(block.trim().startsWith('{')).toBe(true);
      expect(block).toContain(`"name": ${JSON.stringify(name)}`);
      expect(text.slice(0, debut).some((line) => line.trim().startsWith('"arborescence"'))).toBe(true);
    }
    expect(lines.total).toBe(text.length - 1);
    dropClassificationProposal(project);
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

  it('range dans le sous-dossier choisi, même écrit partiellement', () => {
    const tags = ['Pièces', 'Pièces/Contrats', 'Projets'];
    expect(matchingFolder(tags, 'Pièces/Contrats')).toBe('Pièces/Contrats');
    expect(matchingFolder(tags, 'pièces / contrats')).toBe('Pièces/Contrats');
    expect(matchingFolder(tags, 'Pièces › Contrats')).toBe('Pièces/Contrats');
    expect(matchingFolder(tags, 'Contrats')).toBe('Pièces/Contrats');
    expect(matchingFolder(tags, 'Pièces, Pièces/Contrats')).toBe('Pièces/Contrats');
    expect(matchingFolder(['Pièces/Contrats', 'Projets/Contrats'], 'Contrats')).toBe('');
    const review = reviewOf('Contrats');
    review.columns = [{ index: 0, ...classificationColumn([{ name: 'Pièces', explanation: '' }, { name: 'Pièces/Contrats', explanation: '' }]) }];
    expect(targetPath(plannedChange(review, { ...review.rows[0], piece: 'Pièces/bail.pdf' }, [], pieces)!)).toBe('Pièces/Contrats/bail.pdf');
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

describe('un seul index par dossier', () => {
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
    [{ modele: 'Index' }],
    [{ nom: 'Scan intégral du dossier', documents: ['Notes'], questions: [{ nom: 'Date', consigne: 'Date ?' }] }],
    [{ modele: 'Tri des pièces' }],
    [{ nom: 'Chronologie des faits', documents: ['Notes'], questions: [{ nom: 'Date', consigne: 'Date ?' }] }],
    [{ nom: 'Tri des pièces', documents: ['Notes'] }],
  ])('preparer %j ne crée pas de second projet', async (demande) => {
    const run = launchers();
    const unique = await assistant({ action: 'index', project: dossier }, run) as { projet: string };
    const reponse = await assistant({ action: 'preparer', project: dossier, ...demande }, run) as { projet: string; suite: string };
    expect(reponse.projet).toBe(unique.projet);
    expect(reponse.suite).toContain('Une seule analyse');
    expect(listDrafts([dossier])).toHaveLength(1);
    deleteDraft(unique.projet);
  });

  it('garde le classement et le nom quand l’agent complète le projet', async () => {
    const run = launchers();
    const unique = await assistant({ action: 'index', project: dossier }, run) as { projet: string };
    const complete = await assistant({ action: 'preparer', project: dossier, projet: unique.projet, nom: 'Autre', questions: [{ nom: 'Montant', consigne: 'Quel montant ?' }] }, run) as { nom: string; questions: string[]; chronologie: boolean };
    expect(complete).toMatchObject({ nom: 'Index', questions: ['Montant', 'Classement'], index: true });
    deleteDraft(unique.projet);
  });

  it('laisse les analyses classiques et les recherches indépendantes', async () => {
    const run = launchers();
    const classique = await assistant({ action: 'preparer', project: dossier, nom: 'Baux', documents: ['Notes'], questions: [{ nom: 'Prix', consigne: 'Quel prix ?' }] }, run) as { projet: string; index?: boolean };
    const recherche = await assistant({ action: 'preparer', project: dossier, mode: 'recherche', nom: 'Chronologie de la jurisprudence', questions: [{ nom: 'Solution', consigne: 'Quelle solution ?' }] }, run) as { projet: string; index?: boolean };
    expect(classique.index).toBeUndefined();
    expect(recherche.index).toBeUndefined();
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
    expect(await assistant({ action: 'index', project: dossier }, run)).toMatchObject({ fichier: premiere.file, absentes: expect.any(Number) });
    expect(await assistant({ action: 'preparer', project: dossier, modele: 'Chronologie' }, run)).toMatchObject({ fichier: premiere.file });
    const listed = await assistant({ action: 'lister', project: dossier }, run) as { analyses: { fichier: string; index?: boolean }[] };
    expect(listed.analyses).toEqual([expect.objectContaining({ fichier: premiere.file, nom: 'Index', index: true })]);
  });

  it('crée une analyse classique à côté de la chronologie', async () => {
    const classique = createReview(dossier, { ...template, name: 'Analyse de contrat' }, 'Baux', rows, settings);
    expect(classique.created).toBe(true);
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

  it('lit l’arborescence et la proposition en attente', async () => {
    const run = launchers();
    await assistant({ action: 'arborescence', project, dossiers: [{ nom: 'Clients', explication: 'Échanges.' }] }, run);
    const read = await assistant({ action: 'arborescence', project }, run) as { dossiers: unknown; proposition: { dossiers: unknown } };
    expect(read.dossiers).toEqual(DEFAULT_CLASSIFICATION.map((folder) => ({ nom: folder.name, explication: folder.explanation })));
    expect(read.proposition.dossiers).toEqual([{ nom: 'Clients', explication: 'Échanges.' }]);
    await saveClassification(project, DEFAULT_CLASSIFICATION);
    expect(await assistant({ action: 'arborescence', project }, run)).not.toHaveProperty('proposition');
  });

  it('ajoute la colonne une seule fois', async () => {
    fs.mkdirSync(path.join(project, REVIEW_FOLDER), { recursive: true });
    const plain = reviewOf('');
    plain.columns = [{ index: 3, name: 'Date', prompt: 'Date ?', format: 'date' }];
    fs.writeFileSync(path.join(project, REVIEW_FOLDER, 'simple.json'), JSON.stringify(plain));
    const run = launchers();
    await addClassification(project, 'simple.json');
    await addClassification(project, 'simple.json');
    const again = await assistant({ action: 'lire', project, fichier: 'simple.json' }, run) as { colonnes: { colonne: number }[] };
    expect(again.colonnes.map((column) => column.colonne)).toEqual([3, 4]);
  });

  it('relance seulement sur les documents nouveaux', async () => {
    writeReview('relance.json');
    const run = launchers();
    expect(await assistant({ action: 'relancer', project, fichier: 'relance.json' }, run)).toMatchObject({ ajoutes: 1 });
    expect(run.appendDocuments).toHaveBeenCalledWith(expect.objectContaining({ file: 'relance.json', rows: [{ label: 'nouveau', documents: ['Notes/nouveau.md'] }] }));
  });
});
