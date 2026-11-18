import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount } from '../client/index.js';
import type { Review } from '../shared.js';

vi.mock('../client/host.js', async (original) => ({
  ...await original<typeof import('../client/host.js')>(),
  loadModels: async () => ({ options: [{ value: 'gpt-6-luna', label: 'Luna' }], cheapest: 'gpt-6-luna' }),
}));

const root = document.createElement('div');
afterEach(() => { unmount(root); root.replaceChildren(); vi.restoreAllMocks(); });

describe('analyse de l’Index dans Dossier', () => {
  it('reprend l’analyse enregistrée et permet d’y ajouter une colonne', async () => {
    const project = '/dossier-exemple';
    const file = 'Index exemple.json';
    const review: Review = { version: 1, title: 'Index', templateName: 'Index', category: 'documents', projectPath: project, createdAt: '', updatedAt: '', provider: 'codex', model: 'gpt-6-luna', concurrency: 1, columns: [{ index: 0, name: 'Date', prompt: 'Date du document', format: 'date' }], rows: [], cells: {} };
    const detail = { project, file, status: 'done', review };
    const rpc = vi.fn(async (_method: string, path: string, body?: unknown) => {
      if (path === '/assistant') return { fichier: file };
      if (path.startsWith('/reviews/item?')) return detail;
      if (path === '/templates') return { templates: [] };
      if (path === '/reviews/column') {
        const column = body as { title: string; prompt: string };
        review.columns.push({ index: 1, name: column.title, prompt: column.prompt, format: 'text' });
        return detail;
      }
      throw new Error(`Appel inattendu : ${path}`);
    });
    mount(root, { context: { theme: 'light', project: { name: 'Dossier exemple', path: project }, session: null }, rpc, onContextChange: () => () => {} }, { project, onBack: vi.fn() });
    await vi.waitFor(() => expect(root.querySelector('[data-add-questions]')).not.toBeNull());
    expect(rpc).not.toHaveBeenCalledWith('POST', '/reviews', expect.anything());
    root.querySelector<HTMLButtonElement>('[data-add-questions]')!.click();
    const prompt = root.querySelector<HTMLTextAreaElement>('[data-field="prompt"]')!;
    prompt.value = 'Quel est le montant ?';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[data-question-submit]')!.click();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('POST', '/reviews/column', expect.objectContaining({ project, file, prompt: 'Quel est le montant ?' })));
    await vi.waitFor(() => expect(root.querySelectorAll('[data-column-title]')).toHaveLength(2));
  });

  it('affiche le titre dans la première cellule, avec le nom source comme secours', async () => {
    const project = '/dossier-exemple';
    const title = { summary: 'Convention de prestation', flag: 'grey' as const, reasoning: '', citations: [{ document: 'piece.md', quote: 'Convention de prestation', verified: true }] };
    const review: Review = { version: 1, title: 'Index', templateName: 'Index', projectPath: project, createdAt: '', updatedAt: '', provider: 'codex', model: 'exemple', concurrency: 1, columns: [{ index: 0, name: 'Date', prompt: 'Date ?', format: 'date' }], rows: [{ id: 'r1', label: 'source.pdf', title, documents: [], status: 'done' }, { id: 'r2', label: 'annexe.pdf', documents: [], status: 'done' }], cells: {} };
    const rpc = vi.fn(async (_method: string, path: string) => path === '/assistant' ? { fichier: 'index.json' } : { project, file: 'index.json', status: 'done', review });
    mount(root, { context: { theme: 'light', project: { name: 'Exemple', path: project }, session: null }, rpc, onContextChange: () => () => {} }, { project, onBack: vi.fn() });
    await vi.waitFor(() => expect(root.querySelectorAll('[data-title-row]')).toHaveLength(2));
    expect(root.querySelector('[data-title-row="r1"] .ptr-row-label')!.textContent).toBe('Convention de prestation');
    expect(root.querySelector('[data-title-row="r2"] .ptr-row-label')!.textContent).toBe('annexe.pdf');
    expect(root.querySelectorAll('[data-column-title]')).toHaveLength(1);
    expect(root.querySelector('[data-title-row="r1"] [data-citation]')).not.toBeNull();
  });

  it('s’affiche comme l’Index même de l’onglet Dossier : sans retour, avec la colonne de liens de l’hôte', async () => {
    const project = '/dossier-exemple';
    const review: Review = { version: 1, title: 'Index', templateName: 'Index', projectPath: project, createdAt: '', updatedAt: '', provider: 'codex', model: 'exemple', concurrency: 1, columns: [{ index: 0, name: 'Date', prompt: 'Date ?', format: 'date' }], rows: [{ id: 'r1', label: 'Contrat', piece: 'Pièces/Contrat.pdf', documents: [], status: 'done' }], cells: {} };
    const rpc = vi.fn(async (_method: string, path: string) => path === '/assistant' ? { fichier: 'index.json' } : { project, file: 'index.json', status: 'done', review });
    const cell = vi.fn((row: { piece?: string }) => `<span data-liens>${row.piece}</span>`);
    mount(root, { context: { theme: 'light', project: { name: 'Exemple', path: project }, session: null }, rpc, onContextChange: () => () => {} }, { project, rowColumn: { title: 'Liens', cell } });
    await vi.waitFor(() => expect(root.querySelector('[data-liens]')).not.toBeNull());
    expect(root.querySelector('.ptr-root')!.classList.contains('ptr-embedded')).toBe(true);
    expect([...root.querySelectorAll('thead th')].map((th) => th.textContent?.trim())[1]).toBe('Liens');
    expect(root.querySelector('[data-liens]')!.textContent).toBe('Pièces/Contrat.pdf');
  });

  it('reprend le projet existant dans Dossier et revient à l’Index sans ouvrir l’historique', async () => {
    const back = vi.fn();
    const focus = vi.fn();
    window.addEventListener('piecemaker:panel-focus', focus);
    const draft = { id: 'index-exemple', project: '/dossier-exemple', title: 'Index', templateName: 'Index', provider: 'codex', model: 'gpt-6-luna', rows: [{ label: 'Contrat', documents: ['Contrat.md'] }], columns: [{ name: 'Date', prompt: 'Date du document', format: 'date' }] };
    const rpc = vi.fn(async (_method: string, path: string) => {
      if (path === '/assistant') return { projet: draft.id };
      if (path === '/drafts/list') return { drafts: [draft] };
      if (path === '/templates') return { templates: [] };
      if (path === '/drafts') return { draft };
      if (path === '/protected-projects') return { projects: [draft.project] };
      throw new Error(`Appel inattendu : ${path}`);
    });
    mount(root, { context: { theme: 'light', project: { name: 'Dossier exemple', path: draft.project }, session: null }, rpc, onContextChange: () => () => {} }, { project: draft.project, onBack: back });
    await vi.waitFor(() => expect(root.querySelector('[data-launch]')).not.toBeNull());
    expect(root.querySelector('.ptr-launch')!.textContent).toContain('Index');
    expect(rpc).toHaveBeenCalledWith('POST', '/assistant', { action: 'index', project: draft.project });
    expect(focus).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { tab: 'plugin:piecemaker-dossier', view: 'chronology' } }));
    root.querySelector<HTMLButtonElement>('[data-add-questions]')!.click();
    const name = root.querySelector<HTMLInputElement>('[data-field="name"]')!;
    name.value = 'Montant';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const prompt = root.querySelector<HTMLTextAreaElement>('[data-field="prompt"]')!;
    prompt.value = 'Quel est le montant du document ?';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[data-question-submit]')!.click();
    await vi.waitFor(() => expect(root.querySelectorAll('[data-column-title]')).toHaveLength(2));
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith('PUT', '/drafts', expect.objectContaining({ draft: expect.objectContaining({ id: draft.id, columns: expect.arrayContaining([expect.objectContaining({ name: 'Montant', prompt: prompt.value })]) }) })));
    root.querySelector<HTMLButtonElement>('[data-back]')!.click();
    expect(back).toHaveBeenCalledOnce();
    expect(root.querySelector('.ptr-history')).toBeNull();
    window.removeEventListener('piecemaker:panel-focus', focus);
  });
});
