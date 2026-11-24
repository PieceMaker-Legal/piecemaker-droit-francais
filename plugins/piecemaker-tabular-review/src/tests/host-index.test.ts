import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Review } from '../shared.js';
import { checkCell, editCell, listReviews, readReview, writeNewReview } from '../server/reviews.js';

const ORIGIN = 'http://127.0.0.1:4999';
const directories: string[] = [];

function review(overrides: Partial<Review> = {}): Review {
  return {
    version: 1, title: 'Case index', templateName: 'Case index', category: 'documents', projectPath: '', createdAt: '2026-11-18T10:00:00.000Z', updatedAt: '2026-11-18T10:00:00.000Z',
    provider: 'claude', model: 'm', concurrency: 1,
    columns: [{ index: 0, name: 'Date', prompt: 'Date du document', format: 'date' }],
    rows: [{ id: 'r1', label: 'Contrat', documents: [{ source: 'Contrat.md', copy: 'docs/Contrat.md', chars: 1 }], status: 'done' }],
    cells: { r1: { 0: { summary: '2021-03-12', flag: 'grey', reasoning: '', citations: [{ document: 'Contrat.md', quote: '12 mars 2021', verified: true }] } } },
    ...overrides,
  };
}

/** L'hôte : l'Index dans « SQLite », et sa vue .json régénérée à chaque écriture, comme le fait PieceMaker. */
function host(project: string) {
  const state: { fichier: string | null; review: Review | null; revision: number } = { fichier: null, review: null, revision: 0 };
  const calls: Array<{ method: string; revision?: number }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    expect(url.startsWith(`${ORIGIN}/api/piecemaker/local/index-review`)).toBe(true);
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      calls.push({ method });
      return new Response(JSON.stringify(state));
    }
    const body = JSON.parse(String(init?.body)) as { folder: string; fichier: string; review: Review; revision?: number };
    calls.push({ method, revision: body.revision });
    expect(body.folder).toBe(project);
    if (body.revision !== undefined && body.revision !== state.revision) return new Response(JSON.stringify({ error: 'conflit' }), { status: 409 });
    Object.assign(state, { fichier: body.fichier, review: body.review, revision: state.revision + 1 });
    fs.mkdirSync(path.join(project, 'Tabular Review'), { recursive: true });
    fs.writeFileSync(path.join(project, 'Tabular Review', body.fichier), JSON.stringify(body.review));
    return new Response(JSON.stringify({ fichier: body.fichier, revision: state.revision }));
  }));
  return { state, calls };
}

beforeEach(() => { process.env.PIECEMAKER_HOST_ORIGIN = ORIGIN; });
afterEach(() => {
  delete process.env.PIECEMAKER_HOST_ORIGIN;
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function project(): string {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-host-index-'));
  directories.push(created);
  return created;
}

describe('Case index tenu par l’hôte (SQLite)', () => {
  it('crée l’Index dans SQLite et le relit de là, pas de sa vue .json', async () => {
    const dossier = project();
    const { state, calls } = host(dossier);
    const file = await writeNewReview(dossier, review({ projectPath: dossier }));
    expect(state.fichier).toBe(file);
    expect(calls).toEqual([{ method: 'PUT', revision: undefined }]);
    fs.writeFileSync(path.join(dossier, 'Tabular Review', file), JSON.stringify(review({ title: 'Vue modifiée à la main' })));
    expect((await readReview(dossier, file)).title).toBe('Case index');
    expect((await listReviews([dossier], () => false)).map((entry) => [entry.file, entry.title])).toEqual([[file, 'Case index']]);
  });

  it('écrit chaque modification dans SQLite avec la révision lue, et relit après un conflit', async () => {
    const dossier = project();
    const { state, calls } = host(dossier);
    const file = await writeNewReview(dossier, review({ projectPath: dossier }));
    await checkCell(dossier, file, 'r1', 0, true);
    expect(state.review!.cells.r1[0].checked).toBeDefined();
    expect(calls.at(-1)).toEqual({ method: 'PUT', revision: 1 });
    state.revision = 7;
    await editCell(dossier, file, 'r1', 0, '2021-03-13');
    expect(state.review!.cells.r1[0]).toMatchObject({ summary: '2021-03-13', edited: true });
    expect(calls.at(-1)).toEqual({ method: 'PUT', revision: 7 });
  });

  it('laisse les autres revues dans leur .json', async () => {
    const dossier = project();
    const { calls } = host(dossier);
    const file = await writeNewReview(dossier, review({ title: 'Baux', templateName: 'Analyse de baux', projectPath: dossier }));
    expect(calls.filter((call) => call.method === 'PUT')).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(dossier, 'Tabular Review', file), 'utf8')).title).toBe('Baux');
    await editCell(dossier, file, 'r1', 0, '2022-01-01');
    expect((await readReview(dossier, file)).cells.r1[0].summary).toBe('2022-01-01');
    expect(calls.filter((call) => call.method === 'PUT')).toEqual([]);
  });
});
