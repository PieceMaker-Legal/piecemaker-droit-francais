import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Review, ResearchFilters } from '../shared.js';
import { cellAuthor, isPositiveCell, researchCriteria } from '../shared.js';
import { updateResearchFilters } from '../server/research.js';
import { checkCell, readReview, saveQuestion } from '../server/reviews.js';

const directories: string[] = [];
const FILE = 'revue.json';

const filters: ResearchFilters = {
  query: '"exemple"',
  sources: ['cassation', 'appel'],
  matieres: ['CIVIL'],
  publicationBulletin: 'TOUS',
  sieges: [],
  publicationConseilEtat: 'TOUS',
  villesCaa: [],
  publicationCaa: 'TOUS',
  typesPremiereInstance: [],
  dateDebut: '2024-01-01',
  dateFin: '2024-12-31',
  dispositifOnly: true,
};

function writeReview(review: Partial<Review>): string {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-edit-'));
  directories.push(project);
  const folder = path.join(project, 'Tabular Review');
  fs.mkdirSync(folder, { recursive: true });
  const complete = { version: 1, title: 'Revue exemple', templateName: 'Modèle', category: 'documents', projectPath: project, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', provider: 'claude', model: 'm', concurrency: 1, columns: [], rows: [], cells: {}, ...review };
  fs.writeFileSync(path.join(folder, FILE), JSON.stringify(complete));
  return project;
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('édition d’une analyse tabulaire dans la page', () => {
  it('ajoute une question dont le titre est tiré du texte', async () => {
    const project = writeReview({});
    await saveQuestion(project, FILE, undefined, '  Quelle est la durée   du préavis ?  ', '');
    const review = (await readReview(project, FILE));
    expect(review.columns).toEqual([{ index: 0, name: 'Quelle est la durée du préavis ?', prompt: 'Quelle est la durée   du préavis ?', format: 'text' }]);
  });

  it('modifie la question d’une colonne existante sans changer son index ni son titre', async () => {
    const project = writeReview({ columns: [{ index: 3, name: 'Ancien', prompt: 'Ancien', format: 'text' }] });
    await saveQuestion(project, FILE, 3, 'Nouvelle question', '');
    expect((await readReview(project, FILE)).columns).toEqual([{ index: 3, name: 'Ancien', prompt: 'Nouvelle question', format: 'text' }]);
  });

  it('enregistre un titre donné à la création comme à la modification', async () => {
    const project = writeReview({ columns: [{ index: 0, name: 'A', prompt: 'A', format: 'text' }] });
    await saveQuestion(project, FILE, undefined, 'Question longue', '  Préavis  ');
    await saveQuestion(project, FILE, 0, 'A', 'Titre');
    expect((await readReview(project, FILE)).columns.map((column) => column.name)).toEqual(['Titre', 'Préavis']);
  });

  it('refuse une question vide et une colonne inconnue', async () => {
    const project = writeReview({ columns: [{ index: 0, name: 'A', prompt: 'A', format: 'text' }] });
    await expect(saveQuestion(project, FILE, undefined, '   ', '')).rejects.toThrow('Écrivez la question');
    await expect(saveQuestion(project, FILE, 7, 'Question', '')).rejects.toThrow('Question introuvable');
  });

  it('enregistre la période et les juridictions et recalcule les critères', async () => {
    const project = writeReview({ category: 'recherche-juridique', research: { query: '"exemple"', criteria: researchCriteria(filters), dispositifOnly: true, total: 2, filters } });
    await updateResearchFilters(project, FILE, { dateDebut: '2025-01-01', dateFin: '2025-06-30', sources: ['caa'] });
    const { research } = (await readReview(project, FILE));
    expect(research?.filters).toEqual({ ...filters, dateDebut: '2025-01-01', dateFin: '2025-06-30', sources: ['caa'] });
    expect(research?.criteria).toEqual(researchCriteria({ ...filters, dateDebut: '2025-01-01', dateFin: '2025-06-30', sources: ['caa'] }));
    expect(research?.query).toBe('"exemple"');
  });

  it('refuse une recherche sans critères enregistrés', async () => {
    const project = writeReview({ category: 'recherche-juridique', research: { query: '"exemple"', criteria: [], dispositifOnly: true, total: 0 } });
    await expect(updateResearchFilters(project, FILE, { dateDebut: '', dateFin: '', sources: ['cassation'] })).rejects.toThrow('ne peuvent pas être modifiées');
  });

  it('marque une réponse vérifiée par l’avocat, ce qui en fait une réponse d’auteur humain', async () => {
    const project = writeReview({
      columns: [{ index: 0, name: 'Résilié', prompt: 'Résilié ?', format: 'yes_no' }],
      rows: [{ id: 'r', label: 'Courrier', documents: [], status: 'done' }],
      cells: { r: { 0: { summary: 'Oui', flag: 'red', reasoning: '', citations: [{ document: 'c', quote: 'q', verified: true }] } } },
    });
    expect(cellAuthor((await readReview(project, FILE)).cells.r[0])).toBe('agent');
    const checked = await checkCell(project, FILE, 'r', 0, true);
    expect(checked.cells.r[0].checked?.at).toBeTruthy();
    expect(cellAuthor(checked.cells.r[0])).toBe('human');
    expect((await checkCell(project, FILE, 'r', 0, false)).cells.r[0].checked).toBeUndefined();
    await expect(checkCell(project, FILE, 'r', 3, true)).rejects.toThrow('Cellule introuvable.');
  });

  it('ne retient comme positive qu’une réponse trouvée, et « Oui » pour une question Oui / Non', () => {
    const cell = (summary: string) => ({ summary, flag: 'grey' as const, reasoning: '' });
    expect(isPositiveCell({ format: 'yes_no' }, cell('Oui, page 2'))).toBe(true);
    expect(isPositiveCell({ format: 'yes_no' }, cell('Non'))).toBe(false);
    expect(isPositiveCell({ format: 'date' }, cell('2024-01-09'))).toBe(true);
    expect(isPositiveCell({ format: 'text' }, cell('Non trouvé.'))).toBe(false);
    expect(isPositiveCell({ format: 'text' }, cell('Non traité'))).toBe(false);
  });
});
