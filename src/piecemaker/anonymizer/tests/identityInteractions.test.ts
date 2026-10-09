import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HIGHLIGHT_NAME } from '@/piecemaker/anonymizer/highlighter';
import { startIdentityInteractions } from '@/piecemaker/anonymizer/identityInteractions';
import { identityPath, OPEN_IN_EDITOR_EVENT } from '@/piecemaker/editor-tabs/editorPanels';

let stop: () => void = () => {};
let pane: HTMLDivElement;
let word: Text;
const received: unknown[] = [];
const record = (event: Event) => received.push((event as CustomEvent<{ path: unknown }>).detail.path);

beforeEach(() => {
  pane = document.createElement('div');
  pane.className = 'chat-messages-pane';
  word = document.createTextNode('Jean Dupont a signé');
  pane.appendChild(word);
  document.body.appendChild(pane);
  const range = document.createRange();
  range.setStart(word, 0);
  range.setEnd(word, 11);
  range.getClientRects = () => [{ left: 10, right: 90, top: 10, bottom: 30 }] as unknown as DOMRectList;
  vi.stubGlobal('CSS', { highlights: { get: (name: string) => name === HIGHLIGHT_NAME ? [range] : undefined } });
  window.addEventListener(OPEN_IN_EDITOR_EVENT, record);
  stop = startIdentityInteractions();
});

afterEach(() => {
  stop();
  window.removeEventListener(OPEN_IN_EDITOR_EVENT, record);
  window.getSelection()?.removeAllRanges();
  pane.remove();
  received.length = 0;
  vi.unstubAllGlobals();
});

describe('startIdentityInteractions', () => {
  it('ouvre la fiche dans un onglet de l’éditeur quand on clique sur un mot surligné', () => {
    pane.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 40, clientY: 20 }));
    expect(received).toEqual([identityPath('open', 'Jean Dupont')]);
  });

  it('ignore un clic hors du surlignage', () => {
    pane.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200, clientY: 20 }));
    expect(received).toEqual([]);
  });

  it('propose d’ajouter une sélection du chat au mapping par clic droit', () => {
    const selection = document.createRange();
    selection.setStart(word, 14);
    selection.setEnd(word, 19);
    window.getSelection()?.addRange(selection);
    const menuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 });
    pane.dispatchEvent(menuEvent);
    expect(menuEvent.defaultPrevented).toBe(true);
    const item = document.querySelector<HTMLButtonElement>('#piecemaker-identity-menu button');
    expect(item?.textContent).toBe('Ajouter au mapping');
    item?.click();
    expect(received).toEqual([identityPath('add', 'signé')]);
    expect(document.getElementById('piecemaker-identity-menu')).toBeNull();
  });

  it('laisse le menu natif sans sélection', () => {
    const menuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    pane.dispatchEvent(menuEvent);
    expect(menuEvent.defaultPrevented).toBe(false);
  });
});
