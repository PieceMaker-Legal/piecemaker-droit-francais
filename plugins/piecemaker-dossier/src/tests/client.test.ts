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
  dom = new JSDOM('<div id="root"></div>');
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
  it('opens the tabular analysis of the case from the button', async () => {
    vi.stubGlobal('Event', dom.window.Event);
    const tab = dom.window.document.createElement('button');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-label', 'Analyse Tabulaire');
    const opened = vi.fn();
    tab.addEventListener('click', opened);
    dom.window.document.body.append(tab);
    const shown = vi.fn();
    dom.window.addEventListener('piecemaker:tabular-review-show', shown);
    (dom.window as unknown as Record<string, unknown>).__piecemakerDossierView = 'chronology';
    vi.spyOn(knowledgeApi, 'graph').mockResolvedValue({ ...graph, nodes: [{ projectId: graph.projectId, id: 'doc', kind: 'document', label: 'Contrat', aliases: [], data: {}, date: '2024-03-05', createdAt: '', updatedAt: '' }] } as never);
    mount(container, { context: { theme: 'light', project: { name: graph.projectId, path: '/dossier-exemple' }, session: null }, onContextChange: () => () => undefined, rpc: vi.fn(), openFileInEditor: vi.fn() } as never);
    await vi.waitFor(() => expect(container.querySelector('[data-action="chronology-tabular"]')).not.toBeNull());
    container.querySelector<HTMLElement>('[data-action="chronology-tabular"]')!.click();
    expect((dom.window as unknown as Record<string, unknown>).__piecemakerTabularReviewShow).toEqual({ project: '/dossier-exemple', chronology: true });
    expect(opened).toHaveBeenCalledOnce();
    expect(shown).toHaveBeenCalledOnce();
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
