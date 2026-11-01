import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HIGHLIGHT_NAME } from '@/piecemaker/anonymizer/highlighter';
import { startIdentityInteractions } from '@/piecemaker/anonymizer/identityInteractions';
import { identityPath, OPEN_IN_EDITOR_EVENT, sessionPath } from '@/piecemaker/editor-tabs/editorPanels';
import { api } from '@/shared/api';
import { readDraftText, resetChatDrafts } from '@/shared/chatDrafts';

vi.mock('@/shared/api', () => ({
  api: {
    forkSession: vi.fn(),
    user: { saveDraft: vi.fn(async () => ({ ok: true })), deleteDraft: vi.fn(async () => ({ ok: true })) },
  },
}));

const selectSigne = () => {
  const selection = document.createRange();
  selection.setStart(word, 14);
  selection.setEnd(word, 19);
  const rect = { left: 40, right: 60, top: 40, bottom: 60 };
  selection.getClientRects = () => [rect] as unknown as DOMRectList;
  selection.getBoundingClientRect = () => rect as DOMRect;
  window.getSelection()?.addRange(selection);
};

const movePointer = async (target: Element, init: MouseEventInit) => {
  target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...init }));
  await new Promise(requestAnimationFrame);
};

const hoverSelection = (init: MouseEventInit = {}) => movePointer(pane, { clientX: 50, clientY: 50, ...init });

const menuLabels = () => Array.from(document.querySelectorAll('#piecemaker-identity-menu button'), (button) => button.textContent);

const sideConversationItem = () => Array.from(document.querySelectorAll<HTMLButtonElement>('#piecemaker-identity-menu button'))
  .find((button) => button.textContent === 'Démarrer une conversation annexe');

const forkResponse = (ok: boolean, body: unknown) => ({ ok, status: ok ? 200 : 409, json: async () => body }) as Response;

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
  vi.restoreAllMocks();
  resetChatDrafts();
  window.history.pushState(null, '', '/');
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

  it('propose d’anonymiser une sélection du chat au survol', async () => {
    selectSigne();
    await hoverSelection();
    const item = document.querySelector<HTMLButtonElement>('#piecemaker-identity-menu button');
    expect(item?.textContent).toBe('Anonymiser');
    item?.click();
    expect(received).toEqual([identityPath('add', 'signé')]);
    expect(document.getElementById('piecemaker-identity-menu')).toBeNull();
    expect(window.getSelection()?.isCollapsed).toBe(true);
  });

  it('place les boutons au-dessus de la sélection, Anonymiser en dernier, sans prendre le focus', async () => {
    window.history.pushState(null, '', '/session/source-1');
    selectSigne();
    await hoverSelection();
    const menu = document.getElementById('piecemaker-identity-menu');
    expect(menuLabels()).toEqual(['Démarrer une conversation annexe', 'Anonymiser']);
    expect(menu?.style.top).toBe('36px');
    expect(menu?.contains(document.activeElement)).toBe(false);
  });

  it('garde le menu quand le pointeur le rejoint et le ferme quand il s’éloigne', async () => {
    selectSigne();
    await hoverSelection();
    const menu = document.getElementById('piecemaker-identity-menu') as HTMLElement;
    await movePointer(menu, { clientX: 0, clientY: 0 });
    expect(document.getElementById('piecemaker-identity-menu')).not.toBeNull();
    await movePointer(pane, { clientX: 300, clientY: 300 });
    expect(document.getElementById('piecemaker-identity-menu')).toBeNull();
  });

  it('n’affiche rien hors de la sélection ni pendant qu’on sélectionne', async () => {
    selectSigne();
    await hoverSelection({ clientX: 300 });
    expect(document.getElementById('piecemaker-identity-menu')).toBeNull();
    await hoverSelection({ buttons: 1 });
    expect(document.getElementById('piecemaker-identity-menu')).toBeNull();
  });

  it('démarre une conversation annexe dans le volet, sans quitter la conversation', async () => {
    window.history.pushState(null, '', '/session/source-1');
    vi.mocked(api.forkSession).mockResolvedValue(forkResponse(true, { data: { sessionId: 'fork-1' } }));
    selectSigne();
    await hoverSelection();
    sideConversationItem()?.click();
    await vi.waitFor(() => expect(received).toEqual([sessionPath('fork-1')]));
    expect(api.forkSession).toHaveBeenCalledWith('source-1');
    expect(readDraftText('fork-1')).toBe('> signé\n\n');
    expect(window.location.pathname).toBe('/session/source-1');
  });

  it('forke la conversation du volet quand la sélection s’y trouve', async () => {
    window.history.pushState(null, '', '/session/source-1');
    vi.mocked(api.forkSession).mockResolvedValue(forkResponse(true, { data: { sessionId: 'fork-2' } }));
    const sidePane = document.createElement('div');
    sidePane.dataset.sideConversation = 'fork-1';
    pane.replaceWith(sidePane);
    sidePane.appendChild(pane);
    selectSigne();
    await hoverSelection();
    sideConversationItem()?.click();
    await vi.waitFor(() => expect(received).toEqual([sessionPath('fork-2')]));
    expect(api.forkSession).toHaveBeenCalledWith('fork-1');
    sidePane.remove();
  });

  it('reste sur la conversation et prévient si le fork échoue', async () => {
    window.history.pushState(null, '', '/session/source-1');
    vi.mocked(api.forkSession).mockResolvedValue(forkResponse(false, { message: 'non pris en charge' }));
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    selectSigne();
    await hoverSelection();
    sideConversationItem()?.click();
    await vi.waitFor(() => expect(alert).toHaveBeenCalledOnce());
    expect(window.location.pathname).toBe('/session/source-1');
  });

  it('ne propose pas de conversation annexe sans session ouverte', async () => {
    selectSigne();
    await hoverSelection();
    expect(sideConversationItem()).toBeUndefined();
  });

  it('ne propose pas de conversation annexe hors du chat', async () => {
    window.history.pushState(null, '', '/session/source-1');
    pane.className = '';
    pane.setAttribute('data-piecemaker-identity-highlight', 'on');
    selectSigne();
    await hoverSelection();
    expect(document.querySelector('#piecemaker-identity-menu')).not.toBeNull();
    expect(sideConversationItem()).toBeUndefined();
  });

  it('laisse le menu natif au clic droit', () => {
    selectSigne();
    const menuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    pane.dispatchEvent(menuEvent);
    expect(menuEvent.defaultPrevented).toBe(false);
  });
});
