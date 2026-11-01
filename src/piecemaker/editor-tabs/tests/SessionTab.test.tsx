import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionTab } from '@/piecemaker/editor-tabs/SessionTab';
import { OPEN_IN_EDITOR_EVENT, parseEditorPanel, sessionPath } from '@/piecemaker/editor-tabs/editorPanels';
import { api } from '@/shared/api';
import type { ProjectSession } from '@/shared/types';

type ChatProps = { selectedSession: ProjectSession; onNavigateToSession: (id: string) => void };

const { chatProps } = vi.hoisted(() => ({ chatProps: vi.fn() }));

vi.mock('@/modules/chat', () => ({
  ChatInterface: (props: ChatProps) => {
    chatProps(props);
    return <section data-testid="chat" className="chat-messages-pane">{props.selectedSession.id}</section>;
  },
}));

vi.mock('@/modules/project-workspace/context/ProjectsStateContext', () => ({
  useProjectMainState: () => ({ selectedProject: { projectId: 'dossier-a' }, openSettings: vi.fn() }),
}));

vi.mock('@/shared/context/WebSocketContext', () => ({ useWebSocket: () => ({ ws: null, sendMessage: vi.fn() }) }));

vi.mock('@/shared/context/UiPreferencesContext', () => ({ useUiPreferences: () => ({}) }));

vi.mock('@/shared/api', () => ({ api: { sessionDetails: vi.fn() } }));

const detailsResponse = (ok: boolean, data: unknown) => ({ ok, json: async () => ({ data }) }) as Response;

beforeEach(() => chatProps.mockClear());
afterEach(() => vi.restoreAllMocks());

describe('SessionTab', () => {
  it('reconnaît le chemin d’une conversation annexe', () => {
    expect(parseEditorPanel(sessionPath('fork-1'))).toEqual({ kind: 'session', id: 'fork-1' });
  });

  it('affiche la session forkée avec son fournisseur et marque le volet', async () => {
    vi.mocked(api.sessionDetails).mockResolvedValue(detailsResponse(true, { sessionId: 'fork-1', provider: 'codex', summary: '', project: { projectId: 'dossier-a' } }));
    render(<SessionTab id="fork-1" />);
    const chat = await screen.findByTestId('chat');
    expect(chat.closest('[data-side-conversation]')).toHaveProperty('dataset.sideConversation', 'fork-1');
    expect(chatProps.mock.lastCall?.[0].selectedSession).toMatchObject({ id: 'fork-1', __provider: 'codex', __projectId: 'dossier-a' });
  });

  it('masque l’historique copié et garde les messages écrits après le fork', async () => {
    vi.mocked(api.sessionDetails).mockResolvedValue(detailsResponse(true, { sessionId: 'fork-1', provider: 'claude', createdAt: '2026-01-10T10:00:00.000Z', project: { projectId: 'dossier-a' } }));
    render(<SessionTab id="fork-1" />);
    const chat = await screen.findByTestId('chat');
    const addRow = (timestamp: string) => {
      const row = document.createElement('div');
      row.dataset.messageTimestamp = timestamp;
      chat.appendChild(row);
      return row;
    };
    const original = addRow('2026-01-09T08:00:00.000Z');
    const stampedByFork = addRow('2026-01-10T10:00:00.880Z');
    const reply = addRow('2026-01-10T10:00:05.000Z');
    const optimistic = addRow(String(Date.UTC(2026, 0, 10, 10, 0, 4)));
    await waitFor(() => expect(original.hidden).toBe(true));
    expect(stampedByFork.hidden).toBe(true);
    expect(reply.hidden).toBe(false);
    expect(optimistic.hidden).toBe(false);
  });

  it('ouvre un nouveau fork dans un onglet du volet et ne change pas de page', async () => {
    vi.mocked(api.sessionDetails).mockResolvedValue(detailsResponse(true, { sessionId: 'fork-1', provider: 'claude', project: { projectId: 'dossier-a' } }));
    render(<SessionTab id="fork-1" />);
    await screen.findByTestId('chat');
    const opened = vi.fn();
    window.addEventListener(OPEN_IN_EDITOR_EVENT, opened);
    chatProps.mock.lastCall?.[0].onNavigateToSession('fork-2');
    window.removeEventListener(OPEN_IN_EDITOR_EVENT, opened);
    expect(opened.mock.calls[0][0].detail.path).toBe(sessionPath('fork-2'));
  });

  it('n’affiche pas une session d’un autre dossier', async () => {
    vi.mocked(api.sessionDetails).mockResolvedValue(detailsResponse(true, { sessionId: 'fork-1', provider: 'claude', project: { projectId: 'dossier-b' } }));
    render(<SessionTab id="fork-1" />);
    expect((await screen.findByRole('status')).textContent).toContain('autre dossier');
    expect(chatProps).not.toHaveBeenCalled();
  });

  it('prévient si la session est introuvable', async () => {
    vi.mocked(api.sessionDetails).mockResolvedValue(detailsResponse(false, null));
    render(<SessionTab id="fork-1" />);
    expect((await screen.findByRole('status')).textContent).toContain('Impossible');
  });
});
