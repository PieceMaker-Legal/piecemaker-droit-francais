import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Review } from '../shared.js';
import { deleteReview } from '../server/reviews.js';

const directories: string[] = [];

function reviewWith(copies: string[]): Review {
  return {
    version: 1,
    title: 'Revue exemple',
    templateName: 'Modèle',
    category: 'documents',
    projectPath: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    provider: 'claude',
    model: 'm',
    concurrency: 1,
    columns: [],
    rows: copies.map((copy, index) => ({ id: String(index), label: copy, documents: [{ source: copy, copy: `docs/${copy}`, chars: 1 }], status: 'done' })),
    cells: {},
  } as Review;
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('suppression d’une tabular review', () => {
  it('retire le JSON, ses exports et ses copies exclusives, mais garde les copies partagées', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-'));
    directories.push(project);
    const folder = path.join(project, 'Tabular Review');
    fs.mkdirSync(path.join(folder, 'docs'), { recursive: true });
    for (const name of ['partage.md', 'exclusif.md']) fs.writeFileSync(path.join(folder, 'docs', name), 'x');
    fs.writeFileSync(path.join(folder, 'a.json'), JSON.stringify(reviewWith(['partage.md', 'exclusif.md'])));
    fs.writeFileSync(path.join(folder, 'b.json'), JSON.stringify(reviewWith(['partage.md'])));
    fs.writeFileSync(path.join(folder, 'a.docx'), 'x');
    fs.writeFileSync(path.join(folder, 'a.pdf'), 'x');
    fs.writeFileSync(path.join(folder, 'b.pdf'), 'x');

    deleteReview(project, 'a.json');

    expect(fs.readdirSync(folder).sort()).toEqual(['b.json', 'b.pdf', 'docs']);
    expect(fs.readdirSync(path.join(folder, 'docs'))).toEqual(['partage.md']);
  });
});
