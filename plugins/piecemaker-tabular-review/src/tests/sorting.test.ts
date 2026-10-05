import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Cell, Review, Template } from '../shared.js';
import { citationIssue } from '../shared.js';
import { actionValue, depseudonymize, newPieces, plannedChange, targetPath } from '../client/sorting.js';
import { appendRows, createReview, editCell, markApplied, readReview } from '../server/reviews.js';
import { normalizeTemplate } from '../server/templates.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.resetModules();
});

const cell = (summary: string): Cell => ({ summary, flag: 'green', reasoning: '' });

const sortingTemplate: Template = {
  id: 'tri',
  name: 'Tri des pièces',
  description: '',
  updatedAt: '',
  columns: [
    { name: 'Date', prompt: 'Date ?', format: 'date' },
    { name: 'Nouveau nom', prompt: 'Nom ?', format: 'text', action: 'rename' },
    { name: 'Dossier cible', prompt: 'Dossier ?', format: 'text', action: 'move' },
  ],
};

function caseWithPieces(names: string[]): string {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-tri-')));
  directories.push(project);
  fs.mkdirSync(path.join(project, 'Fichiers convertis PieceMaker'));
  for (const name of names) fs.writeFileSync(path.join(project, 'Fichiers convertis PieceMaker', `${name}.md`), `# ${name}`);
  return project;
}

const settings = { provider: 'claude' as const, model: 'haiku', concurrency: 1 };

function sortingReview(): Review {
  return {
    version: 1,
    title: 'Tri',
    templateName: 'Tri des pièces',
    category: 'tri-pieces',
    projectPath: '',
    createdAt: '',
    updatedAt: '',
    provider: 'claude',
    model: 'haiku',
    concurrency: 1,
    columns: sortingTemplate.columns.map((column, index) => ({ ...column, index })),
    rows: [{ id: 'r1', label: 'jugement', documents: [], status: 'done', piece: 'Pièces/jugement.pdf' }],
    cells: {},
  };
}

describe('valeurs des colonnes d’action', () => {
  it('ne garde que la valeur brute de la réponse', () => {
    expect(actionValue(cell('**2024-01-09_Jugement**'))).toBe('2024-01-09_Jugement');
    expect(actionValue(cell('« Procédure/Jugements »\nCar il s’agit d’une décision.'))).toBe('Procédure/Jugements');
    expect(actionValue(cell('`2024-01-09_Jugement`.'))).toBe('2024-01-09_Jugement');
  });

  it('ne retient rien pour une cellule vide ou « Non trouvé »', () => {
    expect(actionValue(undefined)).toBe('');
    expect(actionValue(cell('Non trouvé.'))).toBe('');
    expect(actionValue(cell('Non traité'))).toBe('');
  });

  it('remplace les codes d’anonymisation par les noms réels, sans caractère interdit', () => {
    const pseudonyms = [{ masked: 'SOCIETE_1', real: 'Alpha' }, { masked: 'SOCIETE_12', real: 'Beta / Gamma' }];
    expect(depseudonymize('Jugement - SOCIETE_12 c- SOCIETE_1', pseudonyms)).toBe('Jugement - Beta - Gamma c- Alpha');
  });
});

describe('plan d’application', () => {
  it('renomme et range la pièce selon les colonnes d’action', () => {
    const review = sortingReview();
    review.cells.r1 = { 1: cell('2024-01-09_Jugement - SOCIETE_01.pdf'), 2: cell('Procédure/Jugements/') };
    const change = plannedChange(review, review.rows[0], [{ masked: 'SOCIETE_01', real: 'Alpha Conseil' }]);
    expect(change).toMatchObject({ piece: 'Pièces/jugement.pdf', name: '2024-01-09_Jugement - Alpha Conseil', directory: 'Procédure/Jugements' });
    expect(targetPath(change!)).toBe('Procédure/Jugements/2024-01-09_Jugement - Alpha Conseil.pdf');
  });

  it('n’applique que les colonnes renseignées, et rien si la pièce est déjà en place', () => {
    const review = sortingReview();
    review.cells.r1 = { 2: cell('Archives') };
    expect(targetPath(plannedChange(review, review.rows[0], [])!)).toBe('Archives/jugement.pdf');
    review.cells.r1 = { 1: cell('jugement'), 2: cell('Pièces') };
    expect(plannedChange(review, review.rows[0], [])).toBeNull();
  });

  it('liste les pièces absentes du tri, hors exports des tabular reviews', () => {
    const pieces = [
      { path: 'Pièces/jugement.pdf', status: 'ready', markdown: 'x.md' },
      { path: 'Pièces/contrat.pdf', status: 'not-converted', markdown: null },
      { path: 'Tabular Review/26-01-01 - Tri.pdf', status: 'not-converted', markdown: null },
    ];
    expect(newPieces(sortingReview(), pieces).map((piece) => piece.path)).toEqual(['Pièces/contrat.pdf']);
  });
});

describe('review de tri des pièces', () => {
  it('crée un tri dont chaque ligne porte sa pièce, puis accueille les nouvelles pièces sans doublon', async () => {
    const project = caseWithPieces(['jugement', 'contrat']);
    const { file, review } = createReview(project, sortingTemplate, 'Tri', [{ label: 'jugement', documents: ['Fichiers convertis PieceMaker/jugement.md'], piece: 'Pièces/jugement.pdf' }], settings);
    expect(review.category).toBe('tri-pieces');
    expect(review.rows[0].piece).toBe('Pièces/jugement.pdf');

    const added = await appendRows(project, file, [
      { label: 'jugement', documents: ['Fichiers convertis PieceMaker/jugement.md'], piece: 'Pièces/jugement.pdf' },
      { label: 'contrat', documents: ['Fichiers convertis PieceMaker/contrat.md'], piece: 'contrat.pdf' },
    ]);

    expect(added).toHaveLength(1);
    expect(readReview(project, file).rows.map((row) => row.piece)).toEqual(['Pièces/jugement.pdf', 'contrat.pdf']);
  });

  it('refuse une ligne de tri sans pièce, à plusieurs documents ou hors du dossier', () => {
    const project = caseWithPieces(['jugement', 'contrat']);
    const documents = ['Fichiers convertis PieceMaker/jugement.md'];
    expect(() => createReview(project, sortingTemplate, 'Tri', [{ label: 'x', documents }], settings)).toThrow(/Pièce invalide/);
    expect(() => createReview(project, sortingTemplate, 'Tri', [{ label: 'x', documents: [...documents, 'Fichiers convertis PieceMaker/contrat.md'], piece: 'a.pdf' }], settings)).toThrow(/une seule pièce/);
    expect(() => createReview(project, sortingTemplate, 'Tri', [{ label: 'x', documents, piece: '../a.pdf' }], settings)).toThrow(/Pièce invalide/);
  });

  it('enregistre une cellule modifiée à la main, sans citation exigée, puis l’application de la ligne', async () => {
    const project = caseWithPieces(['jugement']);
    const { file, review } = createReview(project, sortingTemplate, 'Tri', [{ label: 'jugement', documents: ['Fichiers convertis PieceMaker/jugement.md'], piece: 'jugement.pdf' }], settings);
    const rowId = review.rows[0].id;

    const edited = await editCell(project, file, rowId, 1, '2024-01-09_Jugement');
    expect(edited.cells[rowId]['1']).toMatchObject({ summary: '2024-01-09_Jugement', edited: true });
    expect(citationIssue(edited.cells[rowId]['1'])).toBeNull();
    expect(edited.rows[0].status).not.toBe('done');
    await editCell(project, file, rowId, 0, '2024-01-09');
    expect((await editCell(project, file, rowId, 2, 'Procédure')).rows[0].status).toBe('done');

    const applied = await markApplied(project, file, rowId, 'Procédure/2024-01-09_Jugement.pdf', 'Fichiers convertis PieceMaker/2024-01-09_Jugement.md');
    expect(applied.rows[0]).toMatchObject({ piece: 'Procédure/2024-01-09_Jugement.pdf', label: '2024-01-09_Jugement', applied: { from: 'jugement.pdf' } });
    expect(applied.rows[0].documents[0].source).toBe('Fichiers convertis PieceMaker/2024-01-09_Jugement.md');
  });
});

describe('modèles', () => {
  it('garde l’action d’une question et refuse deux questions de même action', () => {
    expect(normalizeTemplate(sortingTemplate).columns.map((column) => column.action)).toEqual([undefined, 'rename', 'move']);
    const doubled = { ...sortingTemplate, columns: [...sortingTemplate.columns, { name: 'Autre nom', prompt: 'Nom ?', format: 'text', action: 'rename' }] };
    expect(() => normalizeTemplate(doubled)).toThrow(/Renommer la pièce/);
  });

  it('propose une seule fois le modèle « Tri des pièces » à une installation existante', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-home-'));
    directories.push(home);
    vi.stubEnv('HOME', home);
    vi.resetModules();
    const templates = await import('../server/templates.js');
    const file = path.join(home, '.piecemaker', 'tabular-review', 'templates.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, templates: [{ id: 'a', name: 'Ancien', description: '', columns: [{ name: 'Q', prompt: 'Q ?', format: 'text' }] }] }));

    const first = templates.readTemplates();
    expect(first.map((template) => template.name)).toEqual(['Ancien', 'Tri des pièces']);
    templates.deleteTemplate(first[1].id);

    expect(templates.readTemplates().map((template) => template.name)).toEqual(['Ancien']);
  });
});
