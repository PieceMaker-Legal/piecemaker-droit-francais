import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('enregistre chaque lien entre Pièces', async () => {
    const save = vi.spyOn(okfApi, 'saveOntology').mockResolvedValue(state);
    await editOntology(root, 'dossier-exemple', () => {});
    root.querySelector<HTMLElement>('[data-ontology-add]')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const names = root.querySelectorAll<HTMLInputElement>('[data-ontology-name]');
    const labels = root.querySelectorAll<HTMLInputElement>('[data-ontology-label]');
    names[1].value = 'conteste';
    labels[1].value = 'conteste';
    root.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    expect(save.mock.calls[0][1].map((relation) => [relation.name, relation.source, relation.target])).toEqual([
      ['amends', ['Pièces'], ['Pièces']],
      ['conteste', ['Pièces'], ['Pièces']],
    ]);
  });
});
