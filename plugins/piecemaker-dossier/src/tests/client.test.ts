import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { etapesApi, knowledgeApi } from '../api.js';
import { mount, unmount } from '../client.js';
import { okfApi } from '../okf.js';
import { mountIndexAnalysis } from '../index-analysis.js';

vi.mock('../index-analysis.js', () => ({ mountIndexAnalysis: vi.fn(async () => vi.fn()) }));
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
  vi.spyOn(okfApi, 'read').mockResolvedValue({ types: [], typesGraphe: [], fiches: [] });
  vi.spyOn(okfApi, 'verify').mockResolvedValue({ erreurs: [], contradictions: [] });
  vi.spyOn(etapesApi, 'read').mockResolvedValue({});
  container = dom.window.document.getElementById('root')!;
});

afterEach(() => { unmount(container); dom.window.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Index', () => {
  it('affiche la revue de l’Index dans l’onglet même, sans tableau à part ni fenêtre', async () => {
    vi.mocked(mountIndexAnalysis).mockClear();
    const shown = vi.fn();
    dom.window.addEventListener('piecemaker:tabular-review-show', shown);
    (dom.window as unknown as Record<string, unknown>).__piecemakerDossierView = 'chronology';
    mount(container, { context: { theme: 'light', project: { name: graph.projectId, path: '/dossier-exemple' }, session: null }, onContextChange: () => () => undefined, rpc: vi.fn(), openFileInEditor: vi.fn() } as never);
    await vi.waitFor(() => expect(mountIndexAnalysis).toHaveBeenCalledOnce());
    const host = vi.mocked(mountIndexAnalysis).mock.calls[0][0];
    expect(container.contains(host)).toBe(true);
    expect(host.closest('[data-content]')).not.toBeNull();
    expect(vi.mocked(mountIndexAnalysis).mock.calls[0][1]).toEqual(expect.objectContaining({ context: expect.objectContaining({ project: { name: graph.projectId, path: '/dossier-exemple' } }) }));
    expect(container.querySelector('.pmd-modal, .pmd-chronology-table, [data-action="index-analysis"]')).toBeNull();
    expect(shown).not.toHaveBeenCalled();
    container.querySelector<HTMLButtonElement>('[data-tab="general"]')!.click();
    container.querySelector<HTMLButtonElement>('[data-tab="chronology"]')!.click();
    expect(container.contains(host)).toBe(true);
    expect(mountIndexAnalysis).toHaveBeenCalledOnce();
  });

  it('bascule l’Index en mode chronologie et prévient la revue', async () => {
    vi.mocked(mountIndexAnalysis).mockClear();
    vi.stubGlobal('localStorage', dom.window.localStorage);
    (dom.window as unknown as Record<string, unknown>).__piecemakerDossierView = 'chronology';
    mount(container, { context: { theme: 'light', project: { name: graph.projectId, path: '/dossier-exemple' }, session: null }, onContextChange: () => () => undefined, rpc: vi.fn(), openFileInEditor: vi.fn() } as never);
    await vi.waitFor(() => expect(mountIndexAnalysis).toHaveBeenCalledOnce());
    const chronology = vi.mocked(mountIndexAnalysis).mock.calls[0][3]!;
    const changed = vi.fn();
    chronology.subscribe(changed);
    expect(chronology.active()).toBe(false);
    container.querySelector<HTMLButtonElement>('[data-action="index-chronology"]')!.click();
    expect(chronology.active()).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-action="index-chronology"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('pmd-index-chronologie')).toBe('1');
    expect(mountIndexAnalysis).toHaveBeenCalledOnce();
  });

  it('ouvre l’Index quand pm demande l’analyse de l’Index', async () => {
    vi.mocked(mountIndexAnalysis).mockClear();
    const focus: unknown[] = [];
    dom.window.addEventListener('piecemaker:panel-focus', (event) => focus.push((event as CustomEvent).detail.view));
    (dom.window as unknown as Record<string, unknown>).__piecemakerDossierView = 'index-analysis';
    mount(container, { context: { theme: 'light', project: { name: graph.projectId, path: '/dossier-exemple' }, session: null }, onContextChange: () => () => undefined, rpc: vi.fn(), openFileInEditor: vi.fn() } as never);
    await vi.waitFor(() => expect(mountIndexAnalysis).toHaveBeenCalledOnce());
    expect(focus).toContain('chronology');
    expect(container.querySelector('.pmd-modal')).toBeNull();
  });

  it('affiche les erreurs de vérification à l’ouverture de l’Index', async () => {
    vi.mocked(okfApi.verify).mockResolvedValue({ erreurs: [{ fiche: 'contrat.md', erreur: 'Lien sans source' }], contradictions: [] });
    mount(container, { context: { theme: 'light', project: { name: graph.projectId, path: '/dossier-exemple' }, session: null }, onContextChange: () => () => {}, openFileInEditor: vi.fn() });
    container.querySelector<HTMLButtonElement>('[data-tab="chronology"]')!.click();
    await vi.waitFor(() => {
      expect(container.querySelector('[data-okf-report="errors"]')?.textContent).toContain('Lien sans source');
    });
  });
});

describe('Liens des légendes', () => {
  it.each([
    ['chronology', 'edit-document-types', 'types', '[data-type-name]'],
    ['graph', 'edit-ontology', 'relations', '[data-ontology-form]'],
  ])('ouvre directement l’éditeur depuis %s', async (tab, action, pane, field) => {
    vi.spyOn(okfApi, 'ontology').mockResolvedValue({ relations: [], systeme: [], personnalisee: false, types: [], documentTypes: [{ name: 'contrat', icon: 'file' }] });
    mount(container, { context: { theme: 'light', project: { name: graph.projectId, path: '/dossier-exemple' }, session: null }, onContextChange: () => () => {}, openFileInEditor: vi.fn() });
    container.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)!.click();
    const selector = `.pmd-okf-legend a[data-action="${action}"]`;
    await vi.waitFor(() => expect(container.querySelector(selector)).not.toBeNull());
    container.querySelector<HTMLAnchorElement>(selector)!.click();
    await vi.waitFor(() => expect(container.querySelector(`[data-settings-pane="${pane}"]:not([hidden]) ${field}`)).not.toBeNull());
  });
});

describe('Index : classement', () => {
  const documents = [
    { id: 'ten', label: 'Écrit 10.pdf', date: '2024-02-01', data: { path: '/dossier-exemple/10 Archives/Écrit 10.pdf' } },
    { id: 'two', label: 'ecrit 2.pdf', date: '2024-12-01', data: { path: '/dossier-exemple/2 Contrats/ecrit 2.pdf' } },
    { id: 'missing', label: 'Annexe.pdf', date: null, data: { path: '/dossier-exemple/Annexe.pdf' } },
  ];

  async function openIndex() {
    (dom.window as unknown as Record<string, unknown>).__piecemakerDossierView = 'chronology';
    vi.spyOn(knowledgeApi, 'graph').mockResolvedValue({ ...graph, nodes: documents.map((node) => ({ projectId: graph.projectId, kind: 'document', aliases: [], createdAt: '', updatedAt: '', ...node })) } as KnowledgeSnapshot);
    mount(container, { context: { theme: 'light', project: { name: graph.projectId, path: '/dossier-exemple' }, session: null }, onContextChange: () => () => {}, openFileInEditor: vi.fn() });
    await vi.waitFor(() => expect(container.querySelector('[data-index-analysis]')).not.toBeNull());
  }

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
    container.querySelector<HTMLAnchorElement>('.pmd-okf-legend a[data-action="edit-tree"]')!.click();
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
    await vi.waitFor(() => expect(container.querySelector('[data-settings-error]')!.textContent).toContain('Nom de dossier invalide'));
    expect(container.querySelector<HTMLInputElement>('[data-tree-name]')!.value).toBe('Contrats/Signés');
    rejectSave = false;
    submit();
    await vi.waitFor(() => expect(container.querySelector('.pmd-modal')).toBeNull());
    const [url, init] = fetchMock.mock.calls.findLast(([, request]) => request?.method === 'PUT')!;
    expect(url).toBe('/api/plugins/piecemaker-tabular-review/rpc/classification');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    expect(JSON.parse(init.body as string)).toEqual({ project: '/dossier-exemple', folders: [{ name: 'Contrats/Signés', explanation: 'Les accords' }, { name: 'Courriers', explanation: 'Les échanges' }] });
    expect(fetchMock.mock.calls.map(([address]) => address)).toContain('/api/plugins/piecemaker-tabular-review/rpc/classification?project=%2Fdossier-exemple');
    container.querySelector<HTMLAnchorElement>('.pmd-okf-legend a[data-action="edit-tree"]')!.click();
    await vi.waitFor(() => expect(container.querySelector('[data-tree-name]')).not.toBeNull());
    const calls = fetchMock.mock.calls.length;
    container.querySelector<HTMLButtonElement>('.pmd-modal [data-close]')!.click();
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it('indents loaded subfolders and saves the full path of an added one', async () => {
    vi.stubGlobal('localStorage', dom.window.localStorage);
    const folders = [{ name: 'Contrats/Signés', explanation: 'Signés' }, { name: 'Courriers', explanation: '' }, { name: 'Contrats', explanation: 'Accords' }];
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ folders }) }));
    vi.stubGlobal('fetch', fetchMock);
    await openIndex();
    container.querySelector<HTMLAnchorElement>('.pmd-okf-legend a[data-action="edit-tree"]')!.click();
    await vi.waitFor(() => expect(container.querySelector('[data-tree-name]')).not.toBeNull());
    const rows = () => Array.from(container.querySelectorAll<HTMLElement>('[data-tree-row]'));
    expect(rows().map((row) => row.querySelector<HTMLInputElement>('[data-tree-name]')!.value)).toEqual(['Courriers', 'Contrats', 'Signés']);
    expect(rows().map((row) => row.querySelector<HTMLInputElement>('[data-tree-name]')!.style.marginLeft)).toEqual(['0px', '0px', '24px']);
    container.querySelector<HTMLButtonElement>('[data-tree-add-child="1"]')!.click();
    expect(rows()[3].querySelector<HTMLInputElement>('[data-tree-name]')!.style.marginLeft).toBe('24px');
    rows()[3].querySelector<HTMLInputElement>('[data-tree-name]')!.value = 'Résiliés';
    container.querySelector('form[data-tree-form]')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(container.querySelector('.pmd-modal')).toBeNull());
    const init = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>).findLast(([, request]) => request?.method === 'PUT')![1];
    expect((JSON.parse(init.body as string) as { folders: { name: string }[] }).folders.map((folder) => folder.name))
      .toEqual(['Courriers', 'Contrats', 'Contrats/Signés', 'Contrats/Résiliés']);
  });
});

describe('Dossier edit action', () => {
  it.each(['profile', 'mapping'])('opens the viewer from the %s menu', async (source) => {
    const openFileInEditor = vi.fn();
    mount(container, { context: { theme: 'light', project: { name: graph.projectId, path: '/dossier-exemple' }, session: null }, onContextChange: () => () => {}, openFileInEditor });
    await vi.waitFor(() => expect(container.querySelector('[data-edit-node]')).not.toBeNull());
    if (source === 'mapping') { (window as Window & { __piecemakerMappingShow?: string }).__piecemakerMappingShow = '/dossier-exemple'; window.dispatchEvent(new window.Event('piecemaker:mapping-show')); }
    const scope = source === 'mapping' ? container.querySelector('.pmd-mapping-dialog')! : container;
    scope.querySelector<HTMLElement>('[data-edit-node]')!.click();
    expect(openFileInEditor).toHaveBeenCalledExactlyOnceWith('piecemaker://identity/open/Soci%C3%A9t%C3%A9%20Exemple%20SAS');
    expect(container.querySelector('.pmd-modal')).toBeNull();
  });

  it('publishes the anonymization state and opens the mapping on request', async () => {
    const states: Array<{ anonymized: boolean; project: string }> = [];
    const listen = (event: Event) => states.push((event as CustomEvent).detail);
    window.addEventListener('piecemaker:anonymization-state', listen);
    mount(container, { context: { theme: 'light', project: { name: graph.projectId, path: '/dossier-exemple' }, session: null }, onContextChange: () => () => {}, openFileInEditor: vi.fn() });
    await vi.waitFor(() => expect(container.querySelector('[data-edit-node]')).not.toBeNull());
    window.removeEventListener('piecemaker:anonymization-state', listen);
    expect(states.at(-1)?.project).toBe('/dossier-exemple');
    (window as Window & { __piecemakerMappingShow?: string }).__piecemakerMappingShow = '/dossier-exemple';
    window.dispatchEvent(new window.Event('piecemaker:mapping-show'));
    expect(container.querySelector('.pmd-mapping-dialog')).not.toBeNull();
  });
});
