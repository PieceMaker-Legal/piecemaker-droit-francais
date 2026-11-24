import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classificationApi } from '../api.js';
import { editClassification } from '../classification.js';

let dom: JSDOM;
let root: HTMLElement;

beforeEach(() => {
  dom = new JSDOM('<div id="root"></div>');
  vi.stubGlobal('document', dom.window.document);
  root = dom.window.document.getElementById('root')!;
});

afterEach(() => { dom.window.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('arborescence du dossier', () => {
  it('enregistre le classement', async () => {
    vi.spyOn(classificationApi, 'read').mockResolvedValue({ folders: [{ name: 'Documents', explanation: 'Documents du dossier', type: 'Pièces' }] });
    const treeSave = vi.spyOn(classificationApi, 'save').mockResolvedValue({});
    const saved = vi.fn();
    await editClassification(root, '/dossier', saved);
    await vi.waitFor(() => expect(root.querySelector('[data-tree-name]')).not.toBeNull());
    root.querySelector<HTMLInputElement>('[data-tree-type]')!.value = 'Archives';
    root.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(treeSave).toHaveBeenCalledWith('/dossier', [{ name: 'Documents', explanation: 'Documents du dossier', type: 'Archives' }]);
  });
});
