import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { withWorkspacePanels, WorkspaceIconTabs } from '@/modules/piecemaker-workspace-tabs';
import { AgentChatCard } from '@/modules/piecemaker-workspace-tabs/agent/AgentCards';
import { AgentPanel } from '@/modules/piecemaker-workspace-tabs/agent/AgentPanel';
import { openInEditor } from '@/piecemaker/editor-tabs/editorPanels';
import type { AgentState, AgentThread } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';
import type { AppTab, Project, ProjectSession } from '@/shared/types';

const calls = vi.hoisted(() => ({ list: [] as Array<{ url: string; body?: unknown; method?: string }>, state: null as unknown, agentSession: null as string | null, pair: null as unknown }));

vi.mock('@/shared/authToken', () => ({
  requestJson: vi.fn(async (url: string, body?: unknown, method?: string) => {
    calls.list.push({ url, body, method });
    if (url.includes('/state?')) return calls.state;
    if (url.includes('/session?')) return { sessionId: calls.agentSession };
    if (url.endsWith('/central')) return { project: CENTRAL, projectId: 'central', sessionId: 'agent-1' };
    if (url.includes('/case?')) return calls.pair;
    if (url.endsWith('/case/about') || url.endsWith('/case/roadmap')) return { ...(calls.pair as object), ...(url.endsWith('/about') ? { about: (body as { text: string }).text } : { roadmap: (body as { roadmap: unknown }).roadmap }) };
    return {};
  }),
}));
vi.mock('@/piecemaker/editor-tabs/editorPanels', () => ({ openInEditor: vi.fn() }));
const CENTRAL = vi.hoisted(() => '/donnees/PieceMaker Agent');
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
  id: 'f1', reminderAt: null, title: 'Rédiger la note de synthèse', provider: 'claude', model: '', projectPath: PROJECT, sessionId: 's1', ackThread: 'Je rédige la note.',
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
    central: false,
    dossiers: [],
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

it('liste les fils, les décisions à traiter et ouvre un fil comme une session CloudCLI', async () => {
  render(<MemoryRouter><AgentPanel projectPath={PROJECT} /><Location /></MemoryRouter>);
  expect((await screen.findAllByText('Rédiger la note de synthèse')).length).toBe(2);
  expect(screen.getByText('Fils de discussion')).toBeTruthy();
  expect(screen.getByText('À traiter')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Plan long/ }));
  await act(async () => undefined);
  expect(calls.list.some((call) => call.url.endsWith('/decision') && (call.body as { option: number }).option === 1)).toBe(true);
  fireEvent.click(document.querySelector('[data-thread="f1"] button')!);
  expect(screen.getByTestId('location').textContent).toBe('/session/s1');
});

const Workspace = withWorkspacePanels((props) => <>
  <output data-testid={`main ${props.selectedProject?.fullPath}`}>{props.selectedSession?.id}</output>
  <WorkspaceIconTabs activeTab={props.activeTab} setActiveTab={props.setActiveTab} shouldShowTasksTab={false} shouldShowBrowserTab={false} />
  {props.selectedProject?.fullPath === CENTRAL && <AgentChatCard card={{ messageId: 'm1', decisions: [], outputs: [{ kind: 'file', ref: `${PROJECT}/note.docx`, title: 'Note Dupont' }] }} project={CENTRAL} />}
</>);

function Harness({ sessionId, project = PROJECT }: { sessionId: string; project?: string }) {
  const [activeTab, setActiveTab] = useState<AppTab>('chat');
  const props: ComponentProps<typeof Workspace> = {
    activeTab, setActiveTab, selectedProject: { projectId: 'dupont', fullPath: project } as Project, selectedSession: { id: sessionId } as ProjectSession,
    isMobile: false, isLoading: false, onShowSettings: vi.fn(), onProjectSelect: vi.fn(), onProjectsRefresh: vi.fn(),
  };
  return <MemoryRouter><Workspace {...props} /><Location /></MemoryRouter>;
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
  render(<MemoryRouter><AgentPanel projectPath={PROJECT} /></MemoryRouter>);
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

it('ouvre un fil de l’agent central dans un volet imbriqué, avec son dossier, puis revient au chat principal', async () => {
  const data = state();
  data.central = true;
  data.decisions = [];
  data.dossiers = [{ path: PROJECT, selected: true }];
  data.projectIds = { [PROJECT]: 'dupont' };
  calls.state = data;
  calls.agentSession = 'agent-1';
  render(<Harness sessionId="agent-1" project={CENTRAL} />);
  fireEvent.click(await screen.findByRole('button', { name: /Rédiger la note de synthèse/ }));
  const nested = await screen.findByRole('region', { name: 'Fil Rédiger la note de synthèse' });
  expect(nested.querySelector(`[data-testid="main ${PROJECT}"]`)?.textContent).toBe('s1');
  expect(nested.textContent).toContain('Dupont');
  expect(screen.getByTestId('location').textContent).toBe('/');
  fireEvent.click(screen.getByRole('button', { name: 'Revenir à l’agent central' }));
  expect(screen.queryByRole('region', { name: 'Fil Rédiger la note de synthèse' })).toBeNull();
  vi.mocked(openInEditor).mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Note Dupont' }));
  expect(await screen.findByRole('region', { name: 'Fil Rédiger la note de synthèse' })).toBeTruthy();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  expect(openInEditor).toHaveBeenCalledWith(`${PROJECT}/note.docx`);
});

it('range les fils de l’agent central par dossier et coche les dossiers qu’il peut utiliser', async () => {
  const central = CENTRAL;
  const exemple = '/dossiers/Societe Exemple';
  const data = state();
  data.central = true;
  data.decisions = [];
  data.settings.folders = [PROJECT];
  data.dossiers = [{ path: PROJECT, selected: true }, { path: exemple, selected: false }];
  data.threads = [thread, { ...thread, id: 'f2', title: 'Analyser le contrat', projectPath: exemple, sessionId: 's2' }];
  calls.state = data;
  render(<MemoryRouter><AgentPanel projectPath={central} /></MemoryRouter>);
  const dupont = await screen.findByRole('region', { name: 'Dossier Dupont' });
  expect(dupont.textContent).toContain('Rédiger la note de synthèse');
  expect(screen.getByRole('region', { name: 'Dossier Societe Exemple' }).textContent).toContain('Analyser le contrat');
  fireEvent.click(screen.getByRole('button', { name: 'Paramètres' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Societe Exemple' }));
  await act(async () => undefined);
  expect(calls.list).toContainEqual({ url: '/api/piecemaker/orchestrateur/settings', body: { project: central, folders: [PROJECT, exemple] }, method: 'PUT' });
});

it('déplace le brain de l’agent central vers le dossier choisi et y rouvre sa session', async () => {
  const data = state();
  data.central = true;
  data.decisions = [];
  calls.state = data;
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  render(<MemoryRouter><AgentPanel projectPath={CENTRAL} /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Paramètres' }));
  const input = await screen.findByRole('textbox', { name: 'Emplacement du brain' });
  expect((input as HTMLInputElement).value).toBe(CENTRAL);
  fireEvent.change(input, { target: { value: '/Users/exemple/Brain' } });
  fireEvent.click(screen.getByRole('button', { name: 'Déplacer' }));
  await act(async () => undefined);
  expect(calls.list).toContainEqual({ url: '/api/piecemaker/orchestrateur/central/brain', body: { path: '/Users/exemple/Brain' }, method: 'PUT' });
  expect(assign).toHaveBeenCalled();
});

it('règle le dream de l’agent central dans un onglet des paramètres et le lance à la demande', async () => {
  const data = state();
  data.central = true;
  data.decisions = [];
  data.dream = { running: false, lastRunAt: '2026-01-05T02:00:00Z', lastResult: 'Dossier Dupont : feuille de route à jour.', lastError: null };
  calls.state = data;
  render(<MemoryRouter><AgentPanel projectPath={CENTRAL} /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Paramètres' }));
  fireEvent.click(await screen.findByRole('tab', { name: 'Dream' }));
  expect(screen.getByText('Dossier Dupont : feuille de route à jour.')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Activer le dream' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Heure' }), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lancer maintenant' }));
  await act(async () => undefined);
  expect(calls.list).toContainEqual({ url: '/api/piecemaker/orchestrateur/settings', body: { project: CENTRAL, dream: { enabled: true } }, method: 'PUT' });
  expect(calls.list).toContainEqual({ url: '/api/piecemaker/orchestrateur/settings', body: { project: CENTRAL, dream: { hour: 4 } }, method: 'PUT' });
  expect(calls.list.some((call) => call.url.endsWith('/dream'))).toBe(true);
});

it('liste les dossiers de l’agent central dans le contexte, en ajoute un et modifie leur About et leur Roadmap', async () => {
  const exemple = '/dossiers/Societe Exemple';
  const data = state();
  data.central = true;
  data.decisions = [];
  data.settings.folders = [PROJECT];
  data.dossiers = [{ path: PROJECT, selected: true }, { path: exemple, selected: false }];
  calls.state = data;
  calls.pair = {
    folder: PROJECT, name: 'Dupont', about: '# Dupont\n', error: null, paths: { about: '/brain/projects/Dupont/About.md', roadmap: '/brain/projects/Dupont/Roadmap.json' },
    roadmap: { synthese: { parties: { etat: 'valide' }, okf: { etat: 'à exécuter : 2 manque(s)' } }, suivis: { 'appel-suivi.json': { echeances: { audience: { intitule: 'Audience de plaidoirie', kind: 'hearing', date: '2026-12-01' } } } } },
  };
  render(<MemoryRouter><AgentPanel projectPath={CENTRAL} /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('tab', { name: 'Contexte' }));
  const dossiers = await screen.findByRole('region', { name: 'Dossiers' });
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter un dossier' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Dossier à ajouter' }), { target: { value: exemple } });
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter le dossier' }));
  await act(async () => undefined);
  expect(calls.list).toContainEqual({ url: '/api/piecemaker/orchestrateur/settings', body: { project: CENTRAL, folders: [PROJECT, exemple] }, method: 'PUT' });
  fireEvent.click(dossiers.querySelector(`[data-case="${PROJECT}"] button`)!);
  fireEvent.click(await screen.findByRole('button', { name: 'About' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'About.md de Dupont' }), { target: { value: '# Dupont\n\nStatut : en cours\n' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await act(async () => undefined);
  expect(calls.list).toContainEqual({ url: '/api/piecemaker/orchestrateur/case/about', body: { project: CENTRAL, folder: PROJECT, text: '# Dupont\n\nStatut : en cours\n' }, method: 'PUT' });
  fireEvent.click(screen.getByRole('button', { name: 'Roadmap' }));
  expect(screen.getByRole('list', { name: 'Synthèse' }).textContent).toContain('Index : à exécuter : 2 manque(s)');
  fireEvent.change(screen.getByRole('textbox', { name: 'Intitulé de audience' }), { target: { value: 'Audience de renvoi' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Nouvelle ligne' }), { target: { value: 'Dépôt des conclusions' } });
  fireEvent.change(screen.getByLabelText('Date de la nouvelle ligne'), { target: { value: '2026-11-30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter la ligne' }));
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await act(async () => undefined);
  const saved = calls.list.find((call) => call.url.endsWith('/case/roadmap'))!.body as { roadmap: { suivis: Record<string, { echeances: Record<string, unknown> }> } };
  expect(saved.roadmap.suivis['appel-suivi.json'].echeances).toEqual({
    audience: { intitule: 'Audience de renvoi', kind: 'hearing', date: '2026-12-01' },
    'dépôt des conclusions': { intitule: 'Dépôt des conclusions', kind: 'filing', date: '2026-11-30' },
  });
});
