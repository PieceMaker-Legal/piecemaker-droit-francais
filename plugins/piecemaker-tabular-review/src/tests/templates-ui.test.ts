import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App, View } from '../client/app.js';
import type { Template } from '../shared.js';
import { createTemplatesView } from '../client/templates.js';

const template: Template = {
  id: 'exemple', name: 'Modèle exemple', description: 'Description exemple', updatedAt: '2026-01-01',
  columns: [
    { name: 'Objet', format: 'text', prompt: 'Identifier l’objet.' },
    { name: 'Date', format: 'date', prompt: 'Identifier la date.' },
    { name: 'Catégorie', format: 'tags', prompt: 'Choisir une catégorie.', tags: ['A', 'B'] },
  ],
};

let view: View;
let root: HTMLElement;
let rpc: ReturnType<typeof vi.fn>;

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Élément absent : ${selector}`);
  return found;
}

function input(selector: string, value: string): void {
  const field = element<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

async function mount(existing = true): Promise<void> {
  const templates = existing ? [structuredClone(template)] : [];
  rpc = vi.fn().mockResolvedValue({ templates });
  const app = {
    root, rpc, templates: async () => templates,
    onTemplatesChange: () => () => {}, setTemplates: vi.fn(),
  } as unknown as App;
  view = createTemplatesView(app);
  root.append(view.element);
  await vi.waitFor(() => expect(root.textContent).not.toContain('Chargement'));
  element(existing ? '[data-template]' : '[data-new]').click();
}

beforeEach(() => {
  root = document.createElement('div');
  root.className = 'ptr-root';
  document.body.append(root);
});

afterEach(() => {
  root.querySelector<HTMLElement>('[data-modal-close]')?.click();
  view?.destroy();
  root.remove();
});

describe('éditeur de modèles à deux panneaux', () => {
  it('affiche une seule question et conserve les champs lors des changements de sélection', async () => {
    await mount();
    expect(root.querySelectorAll('[role=option]')).toHaveLength(3);
    expect(root.querySelector('.ptr-template-legend')).toBeNull();
    expect(root.querySelector('[data-question-editor] h3')).toBeNull();
    expect(element<HTMLSelectElement>('[data-field=format]').options).toHaveLength(6);
    expect(element('[data-field=format] option[value=date]').textContent).toContain('JJ/MM/AAAA');
    expect(element('[data-field=format] option[value=tags]').textContent).toContain('Étiquettes séparées par des virgules');
    expect(root.querySelectorAll('[data-field=prompt]')).toHaveLength(1);
    input('[data-field=name]', 'Objet modifié');
    input('[data-field=prompt]', 'Consigne modifiée');
    input('[data-field=action]', 'rename');
    element('[data-select-question="1"]').click();
    expect(element<HTMLInputElement>('[data-field=name]').value).toBe('Date');
    element('[data-select-question="0"]').click();
    expect(element<HTMLInputElement>('[data-field=name]').value).toBe('Objet modifié');
    expect(element<HTMLTextAreaElement>('[data-field=prompt]').value).toBe('Consigne modifiée');
    expect(element<HTMLSelectElement>('[data-field=action]').value).toBe('rename');
    expect(element('[aria-selected=true]').textContent).toContain('Objet modifié');
  });

  it('ajoute, déplace et supprime la sélection avant d’enregistrer dans l’ordre affiché', async () => {
    await mount();
    element('[data-add-question]').click();
    expect(root.ownerDocument.activeElement).toBe(element('[data-field=name]'));
    input('[data-field=name]', 'Nouvelle colonne');
    input('[data-field=prompt]', 'Nouvelle consigne');
    element('[data-move="-1"]').click();
    expect(element('[aria-selected=true]').dataset.selectQuestion).toBe('2');
    expect(element<HTMLInputElement>('[data-field=name]').value).toBe('Nouvelle colonne');
    element('[data-select-question="1"]').click();
    element('[data-remove]').click();
    expect(element<HTMLInputElement>('[data-field=name]').value).toBe('Nouvelle colonne');
    element('[data-modal-action=save]').click();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce());
    const payload = rpc.mock.calls[0][2].template;
    expect(payload.columns.map((column: { name: string }) => column.name)).toEqual(['Objet', 'Nouvelle colonne', 'Catégorie']);
    expect(payload.columns[1].prompt).toBe('Nouvelle consigne');
    expect(payload.columns[2].tags).toEqual(['A', 'B']);
    expect(payload.id).toBe('exemple');
  });

  it('permet la navigation au clavier et conserve les étiquettes pendant les changements de type', async () => {
    await mount();
    element('[data-select-question="0"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(element('[aria-selected=true]').dataset.selectQuestion).toBe('2');
    expect(root.ownerDocument.activeElement).toBe(element('[aria-selected=true]'));
    input('[data-field=tagsText]', 'A, B, C');
    input('[data-field=format]', 'text');
    expect(root.querySelector('[data-field=tagsText]')).toBeNull();
    input('[data-field=format]', 'tags');
    expect(element<HTMLInputElement>('[data-field=tagsText]').value).toBe('A, B, C');
    element('[data-modal-action=save]').click();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce());
    expect(rpc.mock.calls[0][2].template.columns[2].tags).toEqual(['A', 'B', 'C']);
  });

  it('affiche l’action personnalisée et conserve son texte après sélection et enregistrement', async () => {
    await mount();
    expect(element('[data-field=action] option[value=custom]').textContent).toBe('Action personnalisée');
    input('[data-field=action]', 'custom');
    input('[data-field=customAction]', 'Rédige une synthèse des éléments <utiles>.');
    element('[data-select-question="1"]').click();
    element('[data-select-question="0"]').click();
    expect(element<HTMLTextAreaElement>('[data-field=customAction]').value).toBe('Rédige une synthèse des éléments <utiles>.');
    input('[data-field=action]', '');
    expect(root.querySelector('[data-field=customAction]')).toBeNull();
    input('[data-field=action]', 'custom');
    expect(element<HTMLTextAreaElement>('[data-field=customAction]').value).toBe('Rédige une synthèse des éléments <utiles>.');
    element('[data-modal-action=save]').click();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce());
    expect(rpc.mock.calls[0][2].template.columns[0]).toMatchObject({
      action: 'custom', customAction: 'Rédige une synthèse des éléments <utiles>.',
    });
  });

  it('crée un modèle avec une question initiale et protège la dernière question', async () => {
    await mount(false);
    expect(element('[data-remove]').hasAttribute('disabled')).toBe(true);
    expect(element('[data-move="-1"]').hasAttribute('disabled')).toBe(true);
    expect(element('[data-move="1"]').hasAttribute('disabled')).toBe(true);
    input('[data-template-name]', 'Nouveau modèle exemple');
    input('[data-template-description]', 'Description');
    input('[data-field=name]', 'Objet');
    input('[data-field=prompt]', 'Identifier l’objet.');
    element('[data-modal-action=save]').click();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledOnce());
    expect(rpc.mock.calls[0][2].template).toEqual({
      name: 'Nouveau modèle exemple', description: 'Description',
      columns: [{ name: 'Objet', prompt: 'Identifier l’objet.', format: 'text' }],
    });
  });
});
