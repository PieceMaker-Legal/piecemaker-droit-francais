import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { withWorkspacePanels, WorkspaceIconTabs } from '@/modules/piecemaker-workspace-tabs';
import { AgentPanel } from '@/modules/piecemaker-workspace-tabs/agent/AgentPanel';
import type { AgentState, AgentThread } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';
import type { AppTab, Project, ProjectSession } from '@/shared/types';

const calls = vi.hoisted(() => ({ list: [] as Array<{ url: string; body?: unknown; method?: string }>, state: null as unknown, agentSession: null as string | null }));

vi.mock('@/shared/authToken', () => ({
  authenticatedFetch: (url: string, options?: RequestInit) => fetch(url, options),
  requestJson: vi.fn(async (url: string, body?: unknown, method?: string) => {
    calls.list.push({ url, body, method });
    if (url.includes('/state?')) return calls.state;
    if (url.includes('/session?')) return { sessionId: calls.agentSession };
    return {};
  }),
}));
vi.mock('@/piecemaker/editor-tabs/SessionTab', () => ({
  SessionTab: ({ id }: { id: string }) => <p>Session {id}</p>,
}));
vi.mock(import('@/piecemaker/docx'), async (importOriginal) => ({
  ...await importOriginal(),
  DocxDocumentViewer: ({ file }: { file: { path: string } }) => <p>Éditeur Word de {file.path}</p>,
}));
vi.mock(import('@/shared/api'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    api: { ...actual.api, sessionDetails: async (id: string) => Response.json({
      data: { sessionId: id, provider: 'claude', project: { projectId: 'fil', fullPath: '/dossiers/exemple-fil' } },
    }) },
  };
});
vi.mock('@/shared/context/UiPreferencesContext', () => ({ useUiPreferences: () => ({}) }));
vi.mock('@/modules/chat', () => ({
  ChatInterface: ({ selectedSession, selectedProject }: { selectedSession: ProjectSession; selectedProject: Project }) => (
    <p>Session {selectedSession.id} dans {selectedProject.fullPath}</p>
  ),
}));
vi.mock('@/piecemaker/editor-tabs/editorPanels', () => ({ openInEditor: vi.fn() }));
vi.mock('@/modules/piecemaker-workspace-tabs/WorkspaceViewer', () => ({ WorkspaceViewer: vi.fn() }));
vi.mock('@/shared/context/WebSocketContext', () => ({ useWebSocket: () => ({ subscribe: () => () => undefined }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/plugins', () => ({ usePlugins: () => ({ plugins: [] }), PluginTabContent: () => null, PluginIcon: () => <svg /> }));
vi.mock('@/modules/file-tree', () => ({ FileTree: () => null }));
vi.mock('@/modules/git-panel', () => ({ GitPanel: () => null }));
vi.mock('@/modules/browser-use', () => ({ useBrowserUseEnabled: () => false, BrowserUsePanel: () => null }));
vi.mock('@/piecemaker/dossier/api', () => ({ pmGet: vi.fn(async () => ({ active: false })), pmPost: vi.fn() }));

const PROJECT = '/dossiers/Dupont';

const thread: AgentThread = {
  id: 'f1', reminderAt: null, title: 'Rédiger la note de synthèse', provider: 'claude', model: '', sessionId: 's1', ackThread: 'Je rédige la note.',
  state: 'working', createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z', resolved: false, replies: [], error: null,
};

function state(): AgentState {
  return {
    revision: 1,
    settings: { instructions: '', orchestratorProvider: 'auto', orchestratorModel: '', defaultProvider: 'auto', defaultModels: {}, concurrency: { claude: 2, codex: 2, mistral: 2 }, folders: [], recycleAfter: 50 },
    messages: [],
    decisions: [{ id: 'd1', question: 'Quel plan retenir ?', options: [{ label: 'Plan court', consequence: 'Deux parties.' }, { label: 'Plan long', consequence: 'Quatre parties.' }], recommended: 0, chosen: null, closedBy: null, withdrawn: false, owner: { threadId: 'f1' } }],
    threads: [thread],
    deliverables: [],
    schedules: [],
    orchestrator: { running: false, provider: 'claude', sessionId: 'agent-1' },
    providers: [{ provider: 'claude', installed: true, authenticated: true }],
    memory: { text: '', revision: 0, updatedAt: null },
    artifacts: [],
    files: [],
    storage: { used: 0, total: 0 },
  };
}

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

beforeEach(() => {
  calls.state = state();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});

afterEach(() => {
  calls.list = [];
  calls.agentSession = null;
  vi.unstubAllGlobals();
});

it('liste les fils, les décisions à traiter et ouvre le chat du fil dans le volet sans quitter le coordinateur', async () => {
  render(<MemoryRouter initialEntries={['/session/agent-1']}><AgentPanel projectPath={PROJECT} projectId="projet-fictif" /><Location /></MemoryRouter>);
  expect((await screen.findAllByText('Rédiger la note de synthèse')).length).toBe(2);
  expect(screen.getByText('Fils de discussion')).toBeTruthy();
  expect(screen.getByText('À traiter')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Plan long/ }));
  await act(async () => undefined);
  expect(calls.list.some((call) => call.url.endsWith('/decision') && (call.body as { option: number }).option === 1)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /Rédiger la note de synthèse.*En cours/i }));
  const conversation = await screen.findByText('Session s1 dans /dossiers/exemple-fil');
  expect(conversation.closest('[aria-label="Volet de l’agent"]')).toBeTruthy();
  expect(screen.getByTestId('location').textContent).toBe('/session/agent-1');
  fireEvent.click(screen.getByRole('button', { name: 'Retour aux fils de discussion' }));
  expect(screen.queryByText('Session s1 dans /dossiers/exemple-fil')).toBeNull();
  expect(screen.getByText('Fils de discussion')).toBeTruthy();
});

const Workspace = withWorkspacePanels((props) => <WorkspaceIconTabs activeTab={props.activeTab} setActiveTab={props.setActiveTab} shouldShowTasksTab={false} shouldShowBrowserTab={false} />);

function Harness({ sessionId }: { sessionId: string }) {
  const [activeTab, setActiveTab] = useState<AppTab>('chat');
  const props: ComponentProps<typeof Workspace> = {
    activeTab, setActiveTab, selectedProject: { projectId: 'dupont', fullPath: PROJECT } as Project, selectedSession: { id: sessionId } as ProjectSession,
    isMobile: false, isLoading: false, onShowSettings: vi.fn(), onProjectSelect: vi.fn(), onProjectsRefresh: vi.fn(),
  };
  return <MemoryRouter><Workspace {...props} /></MemoryRouter>;
}

it('ouvre le volet de l’agent par défaut dans sa session et le replie depuis la barre du haut', async () => {
  calls.agentSession = 'agent-1';
  render(<Harness sessionId="agent-1" />);
  expect(await screen.findByText('Fils de discussion')).toBeTruthy();
  const toggle = screen.getByRole('tab', { name: 'tabs.agent' });
  expect(toggle.getAttribute('aria-selected')).toBe('true');
  fireEvent.click(toggle);
  expect(screen.queryByText('Fils de discussion')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'tabs.agent' }));
  expect(await screen.findByText('Fils de discussion')).toBeTruthy();
});

it('n’affiche ni le volet ni le bouton dans une session ordinaire', async () => {
  calls.agentSession = 'agent-1';
  render(<Harness sessionId="autre" />);
  await act(async () => undefined);
  expect(screen.queryByRole('tab', { name: 'tabs.agent' })).toBeNull();
  expect(screen.queryByText('Fils de discussion')).toBeNull();
});

it('réunit les instructions et les réglages et permet d’annuler chaque type de tâche', async () => {
  const data = state();
  const at = '2026-01-05T10:00:00Z';
  data.threads = [{ ...thread, reminderAt: at }];
  data.schedules = [
    { id: 's1', kind: 'once', text: 'Message fictif', at, nextRunAt: at, cron: null, thread: null, lastFiredAt: null },
    { id: 's2', kind: 'cron', text: '', at: null, nextRunAt: at, cron: '0 * * * *', thread: { title: 'Routine fictive' }, lastFiredAt: null },
  ];
  calls.state = data;
  render(<MemoryRouter><AgentPanel projectPath={PROJECT} projectId="projet-fictif" /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Paramètres' }));
  expect(await screen.findByRole('textbox', { name: /Instructions du projet/ })).toBeTruthy();
  expect(screen.getAllByRole('tab')).toHaveLength(3);
  fireEvent.click(screen.getByRole('tab', { name: 'Tâches planifiées' }));
  for (const [title, kind, id] of [[thread.title, 'reminder', 'f1'], ['Message fictif', 'once', 's1'], ['Routine fictive', 'cron', 's2']]) {
    const cancel = screen.getByRole('button', { name: `Annuler : ${title}` });
    expect(cancel.closest('li')?.querySelector('time')?.dateTime).toBe(at);
    fireEvent.click(cancel);
    await act(async () => undefined);
    expect(calls.list).toContainEqual({ url: '/api/piecemaker/orchestrateur/schedule/cancel', body: { project: PROJECT, kind, id }, method: undefined });
  }
});

it('ouvre le document Word à gauche et la session de publication à droite depuis la première rangée des fils', async () => {
  const id = 'rapport-fictif';
  const url = `piecemaker://artifact/${id}`;
  calls.state = {
    ...state(),
    artifacts: [{ url, title: 'Rapport fictif' }],
    deliverables: [{ id: 'livrable-fictif', kind: 'artifact', ref: url, threadId: thread.id }],
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const pathname = new URL(input, 'http://localhost').pathname;
    if (pathname.endsWith('/creator')) return Response.json({ sessionId: 'fil-createur' });
    if (pathname.endsWith(`/artifacts/${id}`)) {
      return Response.json({ id, url, format: 'docx', title: 'Rapport fictif', document_path: 'Artifacts/rapport-fictif.docx' });
    }
    return new Response(null, { status: 404 });
  }));
  render(<MemoryRouter><AgentPanel projectPath={PROJECT} projectId="projet-fictif" /></MemoryRouter>);
  const cards = await screen.findByRole('region', { name: 'Artéfacts' });
  const threadGroup = screen.getByRole('button', { name: /À traiter/ });
  expect(cards.compareDocumentPosition(threadGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(within(cards).getByRole('button', { name: 'Rapport fictif' }));
  const workspace = screen.getByRole('dialog', { name: 'Rapport fictif' });
  await within(workspace).findByText('Éditeur Word de Artifacts/rapport-fictif.docx');
  await within(within(workspace).getByRole('complementary', { name: 'Session de création' })).findByText('Session fil-createur');
  fireEvent.click(within(workspace).getByRole('button', { name: 'Fermer l’artifact' }));
  expect(screen.queryByRole('dialog', { name: 'Rapport fictif' })).toBeNull();
});
