import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classificationApi } from '../api.js';
import { editOntology } from '../ontology.js';
import { okfApi, type OntologyState } from '../okf.js';

let dom: JSDOM;
let root: HTMLElement;
const state: OntologyState = {
  relations: [{ name: 'amends', label: 'modifie', inverse: 'modifié par', description: 'Avenant', source: ['Pièces', 'Projets'], target: ['Pièces'] }],
  personnalisee: true,
  systeme: [],
  types: ['Pièces', 'Projets'],
};

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>');
  vi.stubGlobal('document', dom.window.document);
  root = dom.window.document.getElementById('root')!;
  vi.spyOn(okfApi, 'ontology').mockResolvedValue(state);
});

afterEach(() => { dom.window.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('éditeur d’ontologie', () => {
  it('montre le nom technique en premier, sans choix de types', async () => {
    await editOntology(root, 'dossier-exemple', () => {});
    const row = root.querySelector('[data-ontology-row]')!;
    expect(row.querySelector('input')!.hasAttribute('data-ontology-name')).toBe(true);
    expect(row.querySelector('input[type="checkbox"]')).toBeNull();
    expect(root.textContent).not.toContain('Source');
    expect(root.querySelector('[data-ontology-add]')!.textContent).toBe('Créer un autre lien');
  });

  it('conserve les types des liens existants et crée un lien entre Pièces', async () => {
    const save = vi.spyOn(okfApi, 'saveOntology').mockResolvedValue(state);
    await editOntology(root, 'dossier-exemple', () => {});
    root.querySelector<HTMLElement>('[data-ontology-add]')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const names = root.querySelectorAll<HTMLInputElement>('[data-ontology-name]');
    const labels = root.querySelectorAll<HTMLInputElement>('[data-ontology-label]');
    names[1].value = 'conteste';
    labels[1].value = 'conteste';
    root.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    expect(save.mock.calls[0][1].map((relation) => [relation.name, relation.source, relation.target])).toEqual([
      ['amends', ['Pièces', 'Projets'], ['Pièces']],
      ['conteste', ['Pièces'], ['Pièces']],
    ]);
  });
  it('montre les types proposés par l’assistant et applique ceux acceptés', async () => {
    vi.mocked(okfApi.ontology).mockResolvedValue({ ...state, documentTypes: [{ name: 'contrat', icon: 'pen' }, { name: 'courrier', icon: 'mail' }], proposition: { documentTypes: [{ name: 'contrat', icon: 'scroll' }, { name: 'facture', icon: 'file' }], motif: 'Factures reçues', date: '' } });
    const typesSave = vi.spyOn(okfApi, 'saveTypes').mockResolvedValue(state);
    await editOntology(root, 'dossier-exemple', () => {}, '', 'types');
    expect(root.querySelector('[data-ontology-proposal]')).toBeNull();
    expect(root.querySelectorAll('[data-types-proposal] .pmd-ontology-change')).toHaveLength(3);
    expect(root.textContent).toContain('Factures reçues');
    const click = (selector: string) => root.querySelector<HTMLElement>(selector)!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    click('[data-change-accept="0"]');
    click('[data-change-accept="1"]');
    click('[data-change-refuse="2"]');
    click('[data-settings-save]');
    await vi.waitFor(() => expect(typesSave).toHaveBeenCalledWith('dossier-exemple', [{ name: 'contrat', icon: 'scroll' }, { name: 'courrier', icon: 'mail' }, { name: 'facture', icon: 'file' }]));
  });

  it('garde les saisies entre onglets et enregistre classement et icônes ensemble', async () => {
    vi.mocked(okfApi.ontology).mockResolvedValue({ ...state, documentTypes: [{ name: 'contrat', icon: 'pen' }, { name: 'courrier', icon: 'mail' }] });
    vi.spyOn(classificationApi, 'read').mockResolvedValue({ folders: [{ name: 'Documents', explanation: 'Documents du dossier', type: 'Pièces' }] });
    const treeSave = vi.spyOn(classificationApi, 'save').mockResolvedValue({});
    const typesSave = vi.spyOn(okfApi, 'saveTypes').mockResolvedValue(state);
    const relationsSave = vi.spyOn(okfApi, 'saveOntology').mockResolvedValue(state);
    const rebuild = vi.spyOn(okfApi, 'rebuild').mockResolvedValue({ written: 1, removed: 0 });
    const saved = vi.fn();
    await editOntology(root, 'dossier-exemple', saved, '/dossier');
    root.querySelector<HTMLInputElement>('[data-ontology-label]')!.value = 'amende';
    const click = (selector: string) => root.querySelector<HTMLElement>(selector)!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    click('[data-settings-tab="types"]');
    await vi.waitFor(() => expect(root.querySelectorAll('[data-document-type-row]')).toHaveLength(2));
    root.querySelector<HTMLInputElement>('[data-type-name]')!.value = 'Convention';
    const icon = root.querySelector<HTMLSelectElement>('[data-type-icon]')!;
    icon.value = 'scroll';
    icon.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(root.querySelector('.pmd-type-preview svg')).not.toBeNull();
    root.querySelectorAll<HTMLElement>('[data-type-remove]')[1].click();
    click('[data-type-add]');
    root.querySelectorAll<HTMLInputElement>('[data-type-name]')[1].value = 'Annexe';
    click('[data-settings-tab="tree"]');
    await vi.waitFor(() => expect(root.querySelector('[data-tree-name]')).not.toBeNull());
    root.querySelector<HTMLInputElement>('[data-tree-type]')!.value = 'Archives';
    click('[data-settings-tab="relations"]');
    expect(root.querySelector<HTMLInputElement>('[data-ontology-label]')!.value).toBe('amende');
    click('[data-settings-save]');
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(relationsSave.mock.calls[0][1][0]).toMatchObject({ label: 'amende', source: ['Pièces', 'Projets'] });
    expect(typesSave).toHaveBeenCalledWith('dossier-exemple', [{ name: 'Convention', icon: 'scroll' }, { name: 'Annexe', icon: 'file' }]);
    expect(treeSave).toHaveBeenCalledWith('/dossier', [{ name: 'Documents', explanation: 'Documents du dossier', type: 'Archives' }]);
    expect(rebuild).toHaveBeenCalledOnce();
    expect(root.querySelector('.pmd-modal')).toBeNull();
  });

});
