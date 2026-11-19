import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { AgentWorkspace, AGENT_OPEN_EVENT, useAgentSidebarButton } from '@/modules/piecemaker-agent';
import type { AgentMessage, AgentState, AgentThread } from '@/modules/piecemaker-agent/api';

const calls = vi.hoisted(() => ({ list: [] as Array<{ url: string; body?: unknown; method?: string }>, state: null as unknown }));

vi.mock('@/shared/authToken', () => ({
  requestJson: vi.fn(async (url: string, body?: unknown, method?: string) => {
    calls.list.push({ url, body, method });
    return url.includes('/state?') ? calls.state : {};
  }),
}));
vi.mock('@/piecemaker/editor-tabs/editorPanels', () => ({ openInEditor: vi.fn() }));

const thread: AgentThread = {
  id: 'f1', title: 'Rédiger la note de synthèse', provider: 'claude', model: '', sessionId: 's1', ackThread: 'Je rédige la note.',
  state: 'working', createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z', resolved: false, replies: [], error: null,
};

const message = (id: string, author: AgentMessage['author'], text: string, at: string, extra: Partial<AgentMessage> = {}): AgentMessage =>
  ({ id, author, text, at, attachments: [], decisionIds: [], reactions: [], ...extra });

function state(messages: AgentMessage[]): AgentState {
  return {
    revision: 1,
    settings: { instructions: '', orchestratorProvider: 'auto', orchestratorModel: '', defaultProvider: 'auto', defaultModels: {}, concurrency: { claude: 2, codex: 2, mistral: 2 }, folders: [], recycleAfter: 50 },
    messages,
    decisions: [{ id: 'd1', question: 'Quel plan retenir ?', options: [{ label: 'Plan court', consequence: 'Deux parties.' }, { label: 'Plan long', consequence: 'Quatre parties.' }], recommended: 0, chosen: null, closedBy: null, withdrawn: false }],
    threads: [thread],
    deliverables: [],
    schedules: [],
    orchestrator: { running: false, provider: 'claude', sessionId: null },
    providers: [{ provider: 'claude', installed: true, authenticated: true }],
    memory: { text: '', revision: 0, updatedAt: null },
    artifacts: [],
    files: [],
    storage: { used: 0, total: 0 },
  } as AgentState;
}

afterEach(() => {
  calls.list = [];
  window.localStorage.clear();
  document.body.innerHTML = '';
});

it('affiche le chat de l’orchestrateur, la carte du fil sous l’accusé et le séparateur Nouveau', async () => {
  window.localStorage.setItem('pm-agent-seen:/dossiers/Dupont', '2026-01-01T10:00:30Z');
  calls.state = state([
    message('m1', 'user', 'Rédige une note de synthèse.', '2026-01-01T10:00:00Z'),
    message('m2', 'orchestrator', 'Je lance un fil pour la note.', '2026-01-01T10:00:10Z', { threadId: 'f1' }),
    message('m3', 'orchestrator', 'La note est prête.', '2026-01-01T10:01:00Z', { threadId: 'f1', decisionIds: ['d1'] }),
  ]);
  render(<AgentWorkspace projectName="Dupont" projectPath="/dossiers/Dupont" isMobile={false} />);
  expect(await screen.findByText('Je lance un fil pour la note.')).toBeTruthy();
  expect(screen.getAllByText('Rédiger la note de synthèse').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('Nouveau')).toBeTruthy();
  expect(screen.getByText('Fils de discussion')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Plan long/ }));
  await act(async () => undefined);
  expect(calls.list.some((call) => call.url.endsWith('/decision') && (call.body as { option: number }).option === 1)).toBe(true);
});

it('envoie le message du compositeur à l’orchestrateur', async () => {
  calls.state = state([]);
  render(<AgentWorkspace projectName="Dupont" projectPath="/dossiers/Dupont" isMobile={false} />);
  const input = await screen.findByRole('textbox', { name: /message/i });
  fireEvent.change(input, { target: { value: 'Prépare les conclusions.' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await act(async () => undefined);
  expect(calls.list.find((call) => call.url.endsWith('/message'))?.body).toEqual({ project: '/dossiers/Dupont', text: 'Prépare les conclusions.' });
});

it('insère PieceMaker Agent au-dessus de Nouvelle session et ouvre le dossier', async () => {
  document.body.innerHTML = `<div data-piecemaker-project-path="/dossiers/Dupont"><div class="ml-1.5 space-y-1 border-l border-border/70 pl-1.5"><div class="px-3 pb-1 pt-1"><button class="nouvelle"><svg class="lucide-plus"></svg>Nouvelle session</button></div></div></div>`;
  const opened = vi.fn();
  window.addEventListener(AGENT_OPEN_EVENT, opened);
  const newSession = vi.fn();
  document.querySelector('button.nouvelle')!.addEventListener('click', newSession);
  function Host() { useAgentSidebarButton(); return null; }
  render(<Host />);
  const button = screen.getByRole('button', { name: /PieceMaker Agent/ });
  expect(button.closest('[data-piecemaker-agent]')?.nextElementSibling?.textContent).toContain('Nouvelle session');
  fireEvent.click(button);
  await act(async () => { await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null))); });
  expect(newSession).toHaveBeenCalled();
  expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ project: '/dossiers/Dupont' });
  window.removeEventListener(AGENT_OPEN_EVENT, opened);
});
