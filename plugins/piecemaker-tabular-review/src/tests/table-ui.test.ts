import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App, View } from '../client/app.js';
import type { Template } from '../shared.js';

vi.mock('../client/host.js', () => ({
  loadModels: async () => ({ options: [{ value: 'haiku', label: 'Haiku' }], cheapest: 'haiku' }),
  anonymizationProxyOrigin: async () => 'http://127.0.0.1:1',
  caseFiles: { pieces: async () => [] },
}));

const { createLaunchView } = await import('../client/launch.js');

const template: Template = {
  id: 'exemple', name: 'Modèle exemple', description: '', updatedAt: '2026-01-01',
  columns: [
    { name: 'Objet', format: 'text', prompt: 'Identifier l’objet.' },
    { name: 'Montant', format: 'amount', prompt: 'Identifier le montant.' },
  ],
};

let root: HTMLElement;
let view: View;
let rpc: ReturnType<typeof vi.fn>;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Élément absent : ${selector}`);
  return found;
};

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  rpc = vi.fn(async (method: string, path: string) => {
    if (path.startsWith('/documents')) return { documents: [{ path: 'Pièces/b.md', size: 2048, modifiedAt: '' }, { path: 'Pièces/10 a.md', size: 1024, modifiedAt: '' }, { path: 'Pièces/2 c.md', size: 1024, modifiedAt: '' }] };
    if (path === '/protected-projects') return { projects: ['/dossier'] };
    if (path.startsWith('/drafts')) return { draft: {} };
    if (method === 'POST' && path === '/reviews') return { project: '/dossier', file: 'revue.json' };
    throw new Error(path);
  });
  const app = {
    root, rpc, projects: async () => [{ fullPath: '/dossier', displayName: 'Dossier exemple', projectId: 'p1' }],
    projectName: () => 'Dossier exemple', templates: async () => [template], openReview: vi.fn(),
  } as unknown as App;
  view = createLaunchView(app, { id: 'd1', project: '/dossier', title: 'Tableau exemple', templateName: '', columns: [], rows: [], createdAt: '', updatedAt: '' }, vi.fn());
  root.append(view.element);
});

afterEach(() => {
  view.destroy();
  root.remove();
});

describe('nouveau tableau', () => {
  it('ajoute les questions d’un modèle et les documents par panneaux latéraux, trie, puis lance', async () => {
    $('[data-add-questions]').click();
    await vi.waitFor(() => expect($('[data-template-pick]').textContent).toContain('Modèle exemple'));
    $('[data-template-insert]').click();
    expect(root.querySelectorAll('[data-line]')).toHaveLength(2);
    $('[data-question-submit]').click();
    await vi.waitFor(() => expect(root.querySelector('.ptr-drawer')).toBeNull());
    expect($('thead').textContent).toContain('Montant');

    $('[data-add-documents]').click();
    await vi.waitFor(() => expect(root.querySelectorAll('[data-doc]')).toHaveLength(3));
    const boxes = [...root.querySelectorAll<HTMLInputElement>('[data-doc]')];
    boxes[0].click();
    boxes[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect([...root.querySelectorAll<HTMLInputElement>('[data-doc]')].map((box) => box.checked)).toEqual([true, true, true]);
    expect(root.querySelectorAll('[data-row]')).toHaveLength(3);
    $('[data-documents-submit]').click();
    await vi.waitFor(() => expect(root.querySelector('.ptr-drawer')).toBeNull());

    const labels = () => [...root.querySelectorAll('tbody .ptr-row-label')].map((cell) => cell.textContent);
    $('[data-sort="label"]').click();
    expect(labels()).toEqual(['2 c', '10 a', 'b']);
    $('[data-sort="label"]').click();
    expect(labels()).toEqual(['b', '10 a', '2 c']);

    await vi.waitFor(() => expect($<HTMLButtonElement>('[data-launch]').disabled).toBe(false));
    $('[data-launch]').click();
    await vi.waitFor(() => $('[data-modal-action="confirm"]'));
    $('[data-modal-action="confirm"]').click();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('POST', '/reviews', expect.objectContaining({ templateName: 'Modèle exemple', title: 'Tableau exemple', columns: template.columns })));
    const body = rpc.mock.calls.find((call) => call[1] === '/reviews')![2];
    expect(body.rows).toHaveLength(3);
    const saved = rpc.mock.calls.filter((call) => call[0] === 'PUT' && call[1] === '/drafts').at(-1)![2];
    expect(saved.draft).toMatchObject({ id: 'd1', title: 'Tableau exemple', templateName: 'Modèle exemple' });
    expect(saved.draft.rows).toHaveLength(3);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('POST', '/drafts/delete', { id: 'd1' }));
  });
});
