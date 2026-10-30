import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { knowledgeApi } from '../api.js';
import { mount, unmount } from '../client.js';
import type { KnowledgeSnapshot } from '../types.js';

let dom: JSDOM;
let container: HTMLElement;
const graph: KnowledgeSnapshot = {
  projectId: 'dossier-exemple',
  nodes: [{ projectId: 'dossier-exemple', id: 'entity:CLIENT_SAS_01', kind: 'company', label: 'Société Exemple SAS', aliases: [], data: { code: 'CLIENT_SAS_01', partySide: 'client' }, date: null, createdAt: '', updatedAt: '' }],
  mappings: [{ projectId: 'dossier-exemple', nodeId: 'entity:CLIENT_SAS_01', real: 'Société Exemple SAS', masked: 'CLIENT_SAS_01', data: {} }],
  links: [],
  citations: [],
};

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:5173' });
  dom.window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('CustomEvent', dom.window.CustomEvent);
  vi.spyOn(knowledgeApi, 'graph').mockResolvedValue(graph);
  vi.spyOn(knowledgeApi, 'scanJob').mockResolvedValue({ job: null });
  container = dom.window.document.getElementById('root')!;
});

afterEach(() => { unmount(container); dom.window.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Chronologie', () => {
  it('shows the index in the dossier without opening the tabular analysis', async () => {
    vi.stubGlobal('Event', dom.window.Event);
    const shown = vi.fn();
    dom.window.addEventListener('piecemaker:tabular-review-show', shown);
    (dom.window as unknown as Record<string, unknown>).__piecemakerDossierView = 'chronology';
    vi.spyOn(knowledgeApi, 'graph').mockResolvedValue({ ...graph, nodes: [{ projectId: graph.projectId, id: 'doc', kind: 'document', label: 'Contrat', aliases: [], data: {}, date: '2024-03-05', createdAt: '', updatedAt: '' }] } as never);
    mount(container, { context: { theme: 'light', project: { name: graph.projectId, path: '/dossier-exemple' }, session: null }, onContextChange: () => () => undefined, rpc: vi.fn(), openFileInEditor: vi.fn() } as never);
    await vi.waitFor(() => expect(container.querySelector('.pmd-chronology-table')).not.toBeNull());
    expect(container.querySelector('[data-action="chronology-tabular"]')).toBeNull();
    expect(shown).not.toHaveBeenCalled();
  });
});

describe('Index : tri et classement', () => {
  const documents = [
    { id: 'ten', label: 'Écrit 10.pdf', date: '2024-02-01', data: { path: '/dossier-exemple/10 Archives/Écrit 10.pdf' } },
    { id: 'two', label: 'ecrit 2.pdf', date: '2024-12-01', data: { path: '/dossier-exemple/2 Contrats/ecrit 2.pdf' } },
    { id: 'missing', label: 'Annexe.pdf', date: null, data: { path: '/dossier-exemple/Annexe.pdf' } },
  ];

  async function openIndex() {
    (dom.window as unknown as Record<string, unknown>).__piecemakerDossierView = 'chronology';
    vi.spyOn(knowledgeApi, 'graph').mockResolvedValue({ ...graph, nodes: documents.map((node) => ({ projectId: graph.projectId, kind: 'document', aliases: [], createdAt: '', updatedAt: '', ...node })) } as KnowledgeSnapshot);
    mount(container, { context: { theme: 'light', project: { name: graph.projectId, path: '/dossier-exemple' }, session: null }, onContextChange: () => () => {}, openFileInEditor: vi.fn() });
    await vi.waitFor(() => expect(container.querySelector('.pmd-chronology-table')).not.toBeNull());
  }

  it.each([
    ['document', ['missing', 'two', 'ten'], ['ten', 'two', 'missing']],
    ['date', ['ten', 'two', 'missing'], ['two', 'ten', 'missing']],
    ['classification', ['two', 'ten', 'missing'], ['ten', 'two', 'missing']],
  ])('sorts %s in both directions, with missing values last', async (column, ascending, descending) => {
    await openIndex();
    const ids = () => [...container.querySelectorAll<HTMLElement>('tbody tr')].map((row) => row.dataset.openDocument);
    const sort = () => container.querySelector<HTMLButtonElement>(`[data-sort="${column}"]`)!.click();
    if (column !== 'date') sort();
    expect(ids()).toEqual(ascending);
    expect(container.querySelector(`[data-sort="${column}"]`)!.closest('th')!.getAttribute('aria-sort')).toBe('ascending');
    sort();
    expect(ids()).toEqual(descending);
    container.querySelector<HTMLButtonElement>('[data-action="refresh"]')!.click();
    await vi.waitFor(() => expect(ids()).toEqual(descending));
  });

  it('edits the shared classification through authenticated RPC and retains entries after a save error', async () => {
    vi.stubGlobal('localStorage', dom.window.localStorage);
    localStorage.setItem('auth-token', 'test-token');
    const folders = [{ name: 'Contrats', explanation: 'Les accords' }];
    let rejectSave = true;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const failed = init.method === 'PUT' && rejectSave;
      return { ok: !failed, status: failed ? 400 : 200, headers: new Headers(), json: async () => failed ? { error: 'Nom de dossier invalide' } : { folders } };
    });
    vi.stubGlobal('fetch', fetchMock);
    await openIndex();
    container.querySelector<HTMLButtonElement>('[data-action="edit-tree"]')!.click();
    await vi.waitFor(() => expect(container.querySelector('[data-tree-name]')).not.toBeNull());
    const firstName = container.querySelector<HTMLInputElement>('[data-tree-name]')!;
    firstName.value = 'Contrats/Signés';
    container.querySelector<HTMLButtonElement>('[data-tree-add]')!.click();
    const names = container.querySelectorAll<HTMLInputElement>('[data-tree-name]');
    names[1].value = 'Courriers';
    container.querySelectorAll<HTMLInputElement>('[data-tree-explanation]')[1].value = 'Les échanges';
    container.querySelector<HTMLButtonElement>('[data-tree-add]')!.click();
    container.querySelector<HTMLButtonElement>('[data-tree-remove="2"]')!.click();
    const submit = () => container.querySelector('form[data-tree-form]')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    submit();
    await vi.waitFor(() => expect(container.querySelector('[data-tree-error]')!.textContent).toContain('Nom de dossier invalide'));
    expect(container.querySelector<HTMLInputElement>('[data-tree-name]')!.value).toBe('Contrats/Signés');
    rejectSave = false;
    submit();
    await vi.waitFor(() => expect(container.querySelector('.pmd-modal')).toBeNull());
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/api/plugins/piecemaker-tabular-review/rpc/classification');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    expect(JSON.parse(init.body as string)).toEqual({ project: '/dossier-exemple', folders: [{ name: 'Contrats/Signés', explanation: 'Les accords' }, { name: 'Courriers', explanation: 'Les échanges' }] });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/plugins/piecemaker-tabular-review/rpc/classification?project=%2Fdossier-exemple');
    container.querySelector<HTMLButtonElement>('[data-action="edit-tree"]')!.click();
    await vi.waitFor(() => expect(container.querySelector('[data-tree-name]')).not.toBeNull());
    const calls = fetchMock.mock.calls.length;
    container.querySelector<HTMLButtonElement>('.pmd-modal [data-close]')!.click();
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });
});

describe('Nature du document', () => {
  it('changes the nature from the pill without opening the document', async () => {
    vi.stubGlobal('Event', dom.window.Event);
    (dom.window as unknown as Record<string, unknown>).__piecemakerDossierView = 'chronology';
    vi.spyOn(knowledgeApi, 'graph').mockResolvedValue({ ...graph, nodes: [{ projectId: graph.projectId, id: 'doc', kind: 'document', label: 'Contrat', aliases: [], data: { nature: 'contrat', localisation: 'Paris' }, date: '2024-03-05', createdAt: '', updatedAt: '' }], links: [] });
    const update = vi.spyOn(knowledgeApi, 'update').mockResolvedValue(undefined as never);
    mount(container, { context: { theme: 'light', project: { name: graph.projectId, path: '/dossier-exemple' }, session: null }, onContextChange: () => () => undefined });
    await vi.waitFor(() => expect(container.querySelector('[data-edit-nature]')).not.toBeNull());
    container.querySelector<HTMLElement>('[data-edit-nature]')!.click();
    const select = container.querySelector<HTMLSelectElement>('[data-nature-select]')!;
    select.click();
    expect(container.querySelector('.pmd-modal')).toBeNull();
    select.value = 'facture';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0][1]).toEqual([{ op: 'upsertNode', node: expect.objectContaining({ id: 'doc', date: '2024-03-05', data: { nature: 'facture', localisation: 'Paris' } }) }]);
  });
});

describe('Dossier edit action', () => {
  it.each(['profile', 'mapping'])('opens the viewer from the %s menu', async (source) => {
    const openFileInEditor = vi.fn();
    mount(container, { context: { theme: 'light', project: { name: graph.projectId, path: '/dossier-exemple' }, session: null }, onContextChange: () => () => {}, openFileInEditor });
    await vi.waitFor(() => expect(container.querySelector('[data-edit-node]')).not.toBeNull());
    if (source === 'mapping') container.querySelector<HTMLElement>('[data-action="mapping"]')!.click();
    const scope = source === 'mapping' ? container.querySelector('.pmd-mapping-dialog')! : container;
    scope.querySelector<HTMLElement>('[data-edit-node]')!.click();
    expect(openFileInEditor).toHaveBeenCalledExactlyOnceWith('piecemaker://identity/open/Soci%C3%A9t%C3%A9%20Exemple%20SAS');
    expect(container.querySelector('.pmd-modal')).toBeNull();
  });

  it('opens the mapping from the anonymized count', async () => {
    mount(container, { context: { theme: 'light', project: { name: graph.projectId, path: '/dossier-exemple' }, session: null }, onContextChange: () => () => {}, openFileInEditor: vi.fn() });
    await vi.waitFor(() => expect(container.querySelector('.pmd-status-label')).not.toBeNull());
    container.querySelector<HTMLButtonElement>('.pmd-status-label')!.click();
    expect(container.querySelector('.pmd-mapping-dialog')).not.toBeNull();
  });

  it('opens the mapping from the shield', async () => {
    mount(container, { context: { theme: 'light', project: { name: graph.projectId, path: '/dossier-exemple' }, session: null }, onContextChange: () => () => {}, openFileInEditor: vi.fn() });
    await vi.waitFor(() => expect(container.querySelector('.pmd-status-icon')).not.toBeNull());
    container.querySelector<HTMLButtonElement>('.pmd-status-icon')!.click();
    expect(container.querySelector('.pmd-mapping-dialog')).not.toBeNull();
  });
});
