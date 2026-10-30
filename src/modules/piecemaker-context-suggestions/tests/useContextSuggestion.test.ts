import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COMPOSER_INSERT_EVENT } from '@/modules/piecemaker-context-suggestions/contextStore';
import { useContextSuggestion } from '@/modules/piecemaker-context-suggestions/useContextSuggestion';

const insertComposerText = vi.fn();

vi.mock('@/modules/command-palette', () => ({ usePaletteOps: () => ({ insertComposerText }) }));
vi.mock('@/modules/piecemaker-workspace-tabs', () => ({ useOpenWorkspacePanels: () => [] }));
vi.mock('@/modules/piecemaker-context-suggestions/publishContext', () => ({ publishWorkspaceContext: () => undefined }));

const options = { projectPath: '/dossiers/Dupont', input: '', placeholder: '', onKeyDown: () => undefined };
const send = (detail: unknown) => act(() => { window.dispatchEvent(new CustomEvent(COMPOSER_INSERT_EVENT, { detail })); });

describe('insertion demandée par un volet', () => {
  afterEach(() => insertComposerText.mockClear());

  it('remplit le chat avec le texte reçu, sans rien envoyer', () => {
    renderHook(() => useContextSuggestion(options));
    send({ text: 'Rédige un état des dossiers.' });
    expect(insertComposerText).toHaveBeenCalledExactlyOnceWith('Rédige un état des dossiers.');
  });

  it('ignore un événement sans texte et cesse d’écouter au démontage', () => {
    const { unmount } = renderHook(() => useContextSuggestion(options));
    send({});
    unmount();
    send({ text: 'Rédige un état des dossiers.' });
    expect(insertComposerText).not.toHaveBeenCalled();
  });
});
