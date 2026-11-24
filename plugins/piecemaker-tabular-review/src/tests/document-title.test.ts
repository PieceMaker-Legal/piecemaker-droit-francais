import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Review } from '../shared.js';
import { documentTitle } from '../shared.js';
import { readReview } from '../server/reviews.js';
import { citationSource } from '../server/citations.js';

const session = vi.hoisted(() => ({ send: vi.fn(), close: vi.fn() }));
vi.mock('../server/sessions.js', () => ({ openSession: () => session }));
const { isRunning, queueTasks } = await import('../server/runner.js');
const directories: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-title-'));
  directories.push(project);
  vi.stubEnv('PIECEMAKER_HOME', path.join(project, 'config'));
  fs.mkdirSync(path.join(project, 'Tabular Review', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(project, 'Tabular Review', 'docs', 'piece.md'), 'Contrat de prestation. Le prix est fixé à 100 euros.');
  const review: Review = { version: 1, title: 'Case index', templateName: 'Case index', category: 'documents', projectPath: project, createdAt: '', updatedAt: '', provider: 'claude', model: 'exemple', concurrency: 1, columns: [{ index: 0, name: 'Nature', prompt: 'Nature du document ?', format: 'text' }], rows: [{ id: 'r1', label: 'source.pdf', piece: 'source.pdf', documents: [{ source: 'piece.md', copy: 'docs/piece.md', chars: 52 }], status: 'pending' }], cells: {} };
  fs.writeFileSync(path.join(project, 'Tabular Review', 'index.json'), JSON.stringify(review));
  return { project, review };
}

const answer = (index: number, summary: string, quote: string) => JSON.stringify({ column_index: index, summary, flag: 'grey', reasoning: '', citations: [{ document: 'piece.md', quote }] });

describe('titre du document dans la première cellule', () => {
  it('corrige la citation puis conserve le titre hors des colonnes de questions', async () => {
    const { project } = fixture();
    session.send.mockResolvedValueOnce([answer(-1, 'Contrat de prestation', 'Extrait absent'), answer(0, 'contrat', 'Contrat de prestation.')].join('\n'))
      .mockResolvedValueOnce(answer(-1, 'Contrat de prestation', 'Contrat de prestation.'));
    await queueTasks(project, 'index.json', [{ rowId: 'r1' }], 1, {});
    await vi.waitFor(() => expect(isRunning(project, 'index.json')).toBe(false));
    const review = (await readReview(project, 'index.json'));
    expect(review.columns).toHaveLength(1);
    expect(review.cells.r1).not.toHaveProperty('-1');
    expect(review.rows[0].label).toBe('source.pdf');
    expect(documentTitle(review, review.rows[0])).toBe('Contrat de prestation');
    expect(review.rows[0].title?.citations?.[0].verified).toBe(true);
    expect(await citationSource(project, 'index.json', 'r1', -1, 0)).toMatchObject({ quote: 'Contrat de prestation.', verified: true });
    expect(session.send).toHaveBeenCalledTimes(2);
    expect(session.send.mock.calls[0][0]).toContain('legal document');
    expect(session.send.mock.calls[0][0]).not.toContain('assignation, conclusions');
  });

  it('garde le nom source sans titre justifié et classe un type inconnu comme indéterminé', async () => {
    const { project } = fixture();
    session.send.mockResolvedValue([JSON.stringify({ column_index: -1, summary: 'Non trouvé', flag: 'grey', citations: [] }), answer(0, 'autre', 'Contrat de prestation.')].join('\n'));
    await queueTasks(project, 'index.json', [{ rowId: 'r1' }], 1, {});
    await vi.waitFor(() => expect(isRunning(project, 'index.json')).toBe(false));
    const review = (await readReview(project, 'index.json'));
    expect(review.rows[0].title).toBeUndefined();
    expect(documentTitle(review, review.rows[0])).toBe('source.pdf');
    expect(review.cells.r1[0].summary).toBe('indéterminé');
  });
});
