import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classificationApi } from '../api.js';
import { editOntology } from '../ontology.js';
import { okfApi, type OntologyState } from '../okf.js';

let dom: JSDOM;
let root: HTMLElement;
const state: OntologyState = {
  lof: [
    { id: 'ODP001_0001002', iri: 'https://example.org/ODP001_0001002', label: 'legal document', kind: 'class', annotations: [['definition', 'A document of legal effect.']] },
    { id: 'ODP005_0001200', iri: 'https://example.org/ODP005_0001200', label: 'has date-time value', kind: 'dataprop', annotations: [], domain: ['ODP001_0001002'] },
  ],
  attribution: 'Legal Ontologies Foundry, CC BY 4.0',
  source: 'https://example.org/lof',
  personnalisee: false,
  types: ['Pièces'],
};

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>');
  vi.stubGlobal('document', dom.window.document);
  root = dom.window.document.getElementById('root')!;
  vi.spyOn(okfApi, 'ontology').mockResolvedValue(state);
});

afterEach(() => { dom.window.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ontologie LOF', () => {
  it('montre les termes LOF, leur description et l’attribution, sans édition', async () => {
    await editOntology(root, 'dossier-exemple', () => {});
    expect(root.querySelectorAll('[data-lof-term]')).toHaveLength(2);
    expect(root.textContent).toContain('A document of legal effect.');
    expect(root.textContent).toContain('Legal Ontologies Foundry, CC BY 4.0');
    expect(root.querySelector('[data-lof-term="ODP005_0001200"]')!.textContent).toContain('legal document');
    expect(root.querySelector('[data-lof-view] input')).toBeNull();
  });

  it('enregistre le classement et reconstruit l’index', async () => {
    vi.spyOn(classificationApi, 'read').mockResolvedValue({ folders: [{ name: 'Documents', explanation: 'Documents du dossier', type: 'Pièces' }] });
    const treeSave = vi.spyOn(classificationApi, 'save').mockResolvedValue({});
    const rebuild = vi.spyOn(okfApi, 'rebuild').mockResolvedValue({ written: 1, removed: 0 });
    const saved = vi.fn();
    await editOntology(root, 'dossier-exemple', saved, '/dossier', 'tree');
    await vi.waitFor(() => expect(root.querySelector('[data-tree-name]')).not.toBeNull());
    root.querySelector<HTMLInputElement>('[data-tree-type]')!.value = 'Archives';
    root.querySelector<HTMLElement>('[data-settings-save]')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(treeSave).toHaveBeenCalledWith('/dossier', [{ name: 'Documents', explanation: 'Documents du dossier', type: 'Archives' }]);
    expect(rebuild).toHaveBeenCalledOnce();
  });
});
