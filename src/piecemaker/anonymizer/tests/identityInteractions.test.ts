import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HIGHLIGHT_NAME } from '@/piecemaker/anonymizer/highlighter';
import { startIdentityInteractions } from '@/piecemaker/anonymizer/identityInteractions';
import { identityPath, OPEN_IN_EDITOR_EVENT } from '@/piecemaker/editor-tabs/editorPanels';
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
  window.getSelection()?.addRange(selection);
};

const openContextMenu = () => pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));

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

  it('propose d’anonymiser une sélection du chat par clic droit', () => {
    selectSigne();
    const menuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 });
    pane.dispatchEvent(menuEvent);
    expect(menuEvent.defaultPrevented).toBe(true);
    const item = document.querySelector<HTMLButtonElement>('#piecemaker-identity-menu button');
    expect(item?.textContent).toBe('Anonymiser');
    item?.click();
    expect(received).toEqual([identityPath('add', 'signé')]);
    expect(document.getElementById('piecemaker-identity-menu')).toBeNull();
  });

  it('démarre une conversation annexe : fork, citation dans le brouillon, ouverture', async () => {
    window.history.pushState(null, '', '/session/source-1');
    vi.mocked(api.forkSession).mockResolvedValue(forkResponse(true, { data: { sessionId: 'fork-1' } }));
    const popstate = vi.fn();
    window.addEventListener('popstate', popstate);
    selectSigne();
    openContextMenu();
    sideConversationItem()?.click();
    await vi.waitFor(() => expect(window.location.pathname).toBe('/session/fork-1'));
    window.removeEventListener('popstate', popstate);
    expect(api.forkSession).toHaveBeenCalledWith('source-1');
    expect(readDraftText('fork-1')).toBe('> signé\n\n');
    expect(popstate).toHaveBeenCalledOnce();
  });

  it('reste sur la conversation et prévient si le fork échoue', async () => {
    window.history.pushState(null, '', '/session/source-1');
    vi.mocked(api.forkSession).mockResolvedValue(forkResponse(false, { message: 'non pris en charge' }));
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    selectSigne();
    openContextMenu();
    sideConversationItem()?.click();
    await vi.waitFor(() => expect(alert).toHaveBeenCalledOnce());
    expect(window.location.pathname).toBe('/session/source-1');
  });

  it('ne propose pas de conversation annexe sans session ouverte', () => {
    selectSigne();
    openContextMenu();
    expect(sideConversationItem()).toBeUndefined();
  });

  it('ne propose pas de conversation annexe hors du chat', () => {
    window.history.pushState(null, '', '/session/source-1');
    pane.className = '';
    pane.setAttribute('data-piecemaker-identity-highlight', 'on');
    selectSigne();
    openContextMenu();
    expect(document.querySelector('#piecemaker-identity-menu')).not.toBeNull();
    expect(sideConversationItem()).toBeUndefined();
  });

  it('laisse le menu natif sans sélection', () => {
    const menuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    pane.dispatchEvent(menuEvent);
    expect(menuEvent.defaultPrevented).toBe(false);
  });
});
