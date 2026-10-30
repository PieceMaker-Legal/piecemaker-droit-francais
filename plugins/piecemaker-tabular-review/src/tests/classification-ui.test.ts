import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App, View } from '../client/app.js';
import type { Review, ReviewDetail } from '../shared.js';
import { classificationColumn, DEFAULT_CLASSIFICATION } from '../shared.js';

const rename = vi.fn(async () => ({ previous: 'bail.pdf', current: 'Archives/bail.pdf', markdown: 'Archives/bail.md' }));

vi.mock('../client/host.js', () => ({
  loadModels: async () => ({ options: [], cheapest: '' }),
  anonymizationProxyOrigin: async () => 'http://127.0.0.1:1',
  caseFiles: {
    pieces: async () => [{ path: 'bail.pdf', status: 'ready', markdown: 'bail.md' }, { path: 'courrier.pdf', status: 'ready', markdown: 'courrier.md' }],
    pseudonyms: async () => [],
    rename,
    convert: async () => undefined,
  },
}));

const { createReviewView } = await import('../client/review.js');

const row = (id: string, label: string) => ({ id, label, documents: [{ name: label, source: `${label}.md`, markdownFile: `${label}.md` }], status: 'done' });
const cell = (summary: string) => ({ summary, flag: 'green', reasoning: '' });

function detailOf(withClassement: boolean): ReviewDetail {
  const review = {
    version: 1, title: 'Chronologie', templateName: 'Chronologie', category: 'documents', projectPath: '/dossier', createdAt: '', updatedAt: '',
    provider: 'claude', model: 'haiku', concurrency: 1,
    columns: [
      { index: 0, name: 'Date', prompt: 'Date ?', format: 'date' },
      ...(withClassement ? [{ index: 1, ...classificationColumn(DEFAULT_CLASSIFICATION) }] : []),
    ],
    rows: [row('r1', 'bail')],
    cells: { r1: { 0: cell('2024-03-03'), 1: cell('Archives') } },
  } as unknown as Review;
  return { project: '/dossier', file: 'revue.json', status: 'done', review } as ReviewDetail;
}

let root: HTMLElement;
let view: View;
let rpc: ReturnType<typeof vi.fn>;
let current: ReviewDetail;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Élément absent : ${selector}`);
  return found;
};

async function mount(detail: ReviewDetail) {
  current = detail;
  view = createReviewView({
    root, rpc, projects: async () => [{ fullPath: '/dossier', displayName: 'Dossier exemple', projectId: 'p1' }],
    projectName: () => 'Dossier exemple',
  } as unknown as App, '/dossier', 'revue.json', vi.fn());
  root.append(view.element);
  view.show?.();
  await vi.waitFor(() => $('.ptr-table-wrap'));
}

beforeEach(() => {
  rename.mockClear();
  root = document.createElement('div');
  document.body.append(root);
  rpc = vi.fn(async (method: string, path: string) => {
    if (path === '/reviews/classification') {
      current = detailOf(true);
      return current;
    }
    if (path.startsWith('/classification')) return { folders: DEFAULT_CLASSIFICATION };
    if (path.startsWith('/documents')) return { documents: [{ path: 'bail.md' }, { path: 'courrier.md' }, { path: 'note.md' }] };
    return current;
  });
});

afterEach(() => {
  view.destroy();
  root.remove();
});

describe('colonne Classement', () => {
  it('s’ajoute depuis l’en-tête', async () => {
    await mount(detailOf(false));
    $('[data-add-classification]').click();
    await vi.waitFor(() => $('[data-edit-tree]'));
    expect(rpc).toHaveBeenCalledWith('POST', '/reviews/classification', { project: '/dossier', file: 'revue.json' });
    expect(document.querySelector('[data-add-classification]')).toBeNull();
  });

  it('ouvre l’arborescence depuis l’en-tête et enregistre le dossier ajouté', async () => {
    await mount(detailOf(true));
    expect($('.ptr-tree-summary').textContent).toContain('Notes et recherches');
    $('[data-edit-tree]').click();
    await vi.waitFor(() => expect(document.querySelectorAll('[data-tree-row]')).toHaveLength(4));
    $('[data-tree-add]').click();
    const added = [...document.querySelectorAll<HTMLElement>('[data-tree-row]')].pop()!;
    const name = added.querySelector<HTMLInputElement>('[data-tree-name]')!;
    name.value = 'Clients';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    $('[data-tree-remove="0"]').click();
    $('[data-modal-action="save"]').click();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('PUT', '/classification', expect.anything()));
    const saved = rpc.mock.calls.find((call) => call[0] === 'PUT')![2] as { folders: { name: string }[] };
    expect(saved.folders.map((folder) => folder.name)).toEqual(['Pièces', 'Archives', 'Notes et recherches', 'Clients']);
  });

  it('propose les dossiers dans le détail de la cellule', async () => {
    await mount(detailOf(true));
    $('td.ptr-cell[data-row="r1"][data-column="1"]').click();
    await vi.waitFor(() => $('select[data-edit-summary]'));
    const select = $<HTMLSelectElement>('select[data-edit-summary]');
    expect(select.value).toBe('Archives');
    expect([...select.options].map((option) => option.value)).toEqual(['', 'Projets', 'Pièces', 'Archives', 'Notes et recherches']);
  });

  it('ne déplace la pièce qu’après confirmation', async () => {
    await mount(detailOf(true));
    $('[data-apply-all]').click();
    await vi.waitFor(() => expect($('.ptr-modal').textContent).toContain('Archives/bail.pdf'));
    expect(rename).not.toHaveBeenCalled();
    [...document.querySelectorAll<HTMLElement>('[data-modal-action]')].find((button) => button.textContent === 'Appliquer')!.click();
    await vi.waitFor(() => expect(rename).toHaveBeenCalledWith('p1', 'bail.pdf', undefined, 'Archives'));
  });

  it('ajoute les documents arrivés dans le dossier, pièces et notes', async () => {
    await mount(detailOf(true));
    $('[data-add-pieces]').click();
    await vi.waitFor(() => expect($('.ptr-modal').textContent).toContain('courrier.pdf'));
    expect($('.ptr-modal').textContent).toContain('note.md');
    [...document.querySelectorAll<HTMLElement>('[data-modal-action]')].find((button) => button.textContent === 'Ajouter')!.click();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('POST', '/reviews/append', expect.objectContaining({
      rows: [{ label: 'courrier', documents: ['courrier.md'], piece: 'courrier.pdf' }, { label: 'note', documents: ['note.md'] }],
    })));
  });

  it('trie sur la colonne', async () => {
    const detail = detailOf(true);
    detail.review.rows.push(row('r2', 'avenant') as never);
    detail.review.cells.r2 = { 1: cell('Pièces') } as never;
    await mount(detail);
    $('[data-sort="c1"]').click();
    const labels = () => [...document.querySelectorAll('td.ptr-cell[data-column="1"]')].map((entry) => entry.getAttribute('data-row'));
    expect(labels()).toEqual(['r1', 'r2']);
    $('[data-sort="c1"]').click();
    expect(labels()).toEqual(['r2', 'r1']);
  });
});
