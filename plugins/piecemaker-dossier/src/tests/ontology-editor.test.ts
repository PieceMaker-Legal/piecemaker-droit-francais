import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classificationApi } from '../api.js';
import { editOntology } from '../ontology.js';
import { okfApi, type OntologyState } from '../okf.js';

let dom: JSDOM;
let root: HTMLElement;
const state: OntologyState = {
  patterns: [
    { id: 'odp-001', title: 'Document et acte', description: 'Distinguer la pièce de l’acte qu’elle porte.', body: 'Un document porte un acte.' },
    { id: 'odp-003', title: 'Positions corrélatives', description: 'Créance et devoir vont par paire.', body: 'Une créance a son devoir corrélatif.' },
  ],
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
  it('montre les patterns LOF, leur description et l’attribution, sans édition', async () => {
    await editOntology(root, 'dossier-exemple', () => {});
    expect(root.querySelectorAll('[data-lof-term]')).toHaveLength(2);
    expect(root.textContent).toContain('Créance et devoir vont par paire.');
    expect(root.textContent).toContain('Legal Ontologies Foundry, David R. Koepsell, CC BY 4.0.');
    expect(root.querySelector('[data-lof-term="odp-001"]')!.textContent).toContain('Un document porte un acte.');
    expect(root.querySelector('[data-lof-view] input')).toBeNull();
  });

  it('enregistre le classement', async () => {
    vi.spyOn(classificationApi, 'read').mockResolvedValue({ folders: [{ name: 'Documents', explanation: 'Documents du dossier', type: 'Pièces' }] });
    const treeSave = vi.spyOn(classificationApi, 'save').mockResolvedValue({});
    const saved = vi.fn();
    await editOntology(root, 'dossier-exemple', saved, '/dossier', 'tree');
    await vi.waitFor(() => expect(root.querySelector('[data-tree-name]')).not.toBeNull());
    root.querySelector<HTMLInputElement>('[data-tree-type]')!.value = 'Archives';
    root.querySelector<HTMLElement>('[data-settings-save]')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(treeSave).toHaveBeenCalledWith('/dossier', [{ name: 'Documents', explanation: 'Documents du dossier', type: 'Archives' }]);
  });
});
