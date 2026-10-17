import { act, fireEvent, render, screen } from '@testing-library/react';
import { useContext, useState } from 'react';
import type { ComponentProps } from 'react';
import { expect, it, vi } from 'vitest';

import { withWorkspacePanels } from '@/modules/piecemaker-workspace-tabs';
import { WorkspaceViewerContext } from '@/modules/piecemaker-workspace-tabs/context/WorkspaceViewerContext';
import type { AppTab, Project, ServerEvent } from '@/shared/types';

const socket = vi.hoisted(() => ({ listeners: new Set<(event: ServerEvent) => void>() }));

vi.mock('@/modules/piecemaker-workspace-tabs/WorkspaceViewer', () => ({ WorkspaceViewer: vi.fn() }));
vi.mock('@/shared/context/WebSocketContext', () => ({
  useWebSocket: () => ({
    subscribe: (listener: (event: ServerEvent) => void) => {
      socket.listeners.add(listener);
      return () => socket.listeners.delete(listener);
    },
  }),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/plugins', () => ({
  usePlugins: () => ({ plugins: [
    { name: 'example', displayName: 'Exemple', enabled: true },
    { name: 'other', displayName: 'Autre', enabled: true },
    { name: 'piecemaker-dossier', displayName: 'Dossier', enabled: true },
  ] }),
  PluginTabContent: ({ pluginName }: { pluginName: string }) => {
    const viewer = useContext(WorkspaceViewerContext);
    return <><input aria-label={`Contenu ${pluginName}`} /><button onClick={() => viewer?.register(true)}>Ouvrir l’éditeur</button></>;
  },
}));
vi.mock('@/modules/file-tree', () => ({ FileTree: () => <div>Fichiers du dossier</div> }));
vi.mock('@/modules/git-panel', () => ({ GitPanel: () => <div>Git</div> }));
vi.mock('@/modules/browser-use', () => ({ useBrowserUseEnabled: () => true, BrowserUsePanel: () => <div>Navigateur</div> }));

const Workspace = withWorkspacePanels((props) => <div>
  <div data-testid="main">{props.activeTab}</div>
  {(['chat', 'shell', 'files', 'plugin:example', 'plugin:other'] as AppTab[]).map((tab) => <button key={tab} onClick={() => props.setActiveTab(tab)}>{tab}</button>)}
</div>);

function Harness() {
  const [activeTab, setActiveTab] = useState<AppTab>('chat');
  const project = { projectId: 'example', path: '/tmp/example' } as Project;
  const props: ComponentProps<typeof Workspace> = {
    activeTab, setActiveTab, selectedProject: project, selectedSession: null, isMobile: false,
    isLoading: false, onShowSettings: vi.fn(), onProjectSelect: vi.fn(), onProjectsRefresh: vi.fn(),
  };
  return <Workspace {...props} />;
}

it('garde chat ou terminal au centre et ouvre plusieurs cards indépendantes', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'plugin:example' }));
  fireEvent.click(screen.getByRole('button', { name: 'plugin:other' }));
  expect(screen.getByTestId('main').textContent).toBe('chat');
  expect(screen.getByLabelText('Contenu example')).toBeTruthy();
  expect(screen.getByLabelText('Contenu other')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'shell' }));
  expect(screen.getByTestId('main').textContent).toBe('shell');
  expect(screen.getByLabelText('Contenu example')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Fermer Exemple' }));
  expect(screen.queryByLabelText('Contenu example')).toBeNull();
  expect(screen.getByLabelText('Contenu other')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'plugin:example' }));
  expect(screen.getByLabelText('Contenu example')).toBeTruthy();
});

it('agrandit puis restaure une card sans perdre son contenu ni les autres volets', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'plugin:example' }));
  fireEvent.click(screen.getByRole('button', { name: 'files' }));
  fireEvent.change(screen.getByLabelText('Contenu example'), { target: { value: 'Brouillon fictif' } });
  fireEvent.click(screen.getByRole('button', { name: 'Agrandir Exemple' }));
  expect(screen.getByTestId('main').closest('[hidden]')).toBeTruthy();
  expect(screen.getByText('Fichiers du dossier').closest('[hidden]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Réduire Exemple' }));
  expect(screen.getByTestId('main').closest('[hidden]')).toBeNull();
  expect((screen.getByLabelText('Contenu example') as HTMLInputElement).value).toBe('Brouillon fictif');
  expect(screen.getByText('Fichiers du dossier').closest('[hidden]')).toBeNull();
});

it('garde le volet agrandi à gauche et ouvre le nouvel éditeur à droite', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'plugin:example' }));
  fireEvent.click(screen.getByRole('button', { name: 'Agrandir Exemple' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir l’éditeur' }));
  const columns = Array.from(document.querySelectorAll('.piecemaker-workspace-column'));
  expect(screen.getByRole('button', { name: 'Réduire Exemple' })).toBeTruthy();
  expect(columns[0].querySelector('[aria-label="Contenu example"]')).toBeTruthy();
  expect(columns[1].getAttribute('aria-label')).toBe('Colonne visionneuse');
  expect(columns[1].hasAttribute('hidden')).toBe(false);
});

it('déplace à droite le volet Fichiers qui héberge le nouvel éditeur', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'files' }));
  fireEvent.click(screen.getByRole('button', { name: 'plugin:example' }));
  fireEvent.click(screen.getByRole('button', { name: 'Agrandir Exemple' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir l’éditeur' }));
  const columns = Array.from(document.querySelectorAll('.piecemaker-workspace-column'));
  expect(screen.getByRole('button', { name: 'Réduire Exemple' })).toBeTruthy();
  expect(columns[0].querySelector('[aria-label="Contenu example"]')).toBeTruthy();
  expect(columns[1].querySelector('.piecemaker-files-panel')).toBeTruthy();
  expect(columns[1].hasAttribute('hidden')).toBe(false);
});

it('ouvre le .docx dès que l’agent l’écrit, sans attendre un afficher', () => {
  const opened: string[] = [];
  const record = (event: Event) => opened.push((event as CustomEvent<{ path: string }>).detail.path);
  window.addEventListener('piecemaker:open-in-editor', record);
  render(<Harness />);
  act(() => {
    for (const listener of socket.listeners) {
      listener({ kind: 'tool_use', toolId: 'exec-1', toolName: 'Bash', toolInput: { command: 'docx create bonjour.docx --text bonjour' } });
    }
  });
  expect(opened).toEqual(['bonjour.docx']);
  act(() => {
    for (const listener of socket.listeners) {
      listener({ kind: 'tool_use', toolId: 'exec-2', toolName: 'Bash', toolInput: { command: 'docx read bonjour.docx' } });
    }
  });
  window.removeEventListener('piecemaker:open-in-editor', record);
  expect(opened).toEqual(['bonjour.docx']);
});

it('ouvre le volet Dossier sur la chronologie quand le LLM appelle l’outil chronologie', () => {
  render(<Harness />);
  const viewRequests: unknown[] = [];
  const recordView = () => viewRequests.push((window as unknown as Record<string, unknown>).__piecemakerDossierView);
  window.addEventListener('piecemaker:dossier-view', recordView);
  act(() => {
    for (const listener of socket.listeners) listener({ kind: 'tool_use', toolId: 'outil-1', toolName: 'mcp__piecemaker__chronologie', toolInput: { action: 'lister' } });
  });
  window.removeEventListener('piecemaker:dossier-view', recordView);
  expect(screen.getByLabelText('Contenu piecemaker-dossier')).toBeTruthy();
  expect(screen.getByTestId('main').textContent).toBe('chat');
  expect(viewRequests).toEqual(['chronology']);
});

it('permet de redimensionner le dock au clavier', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'files' }));
  const divider = screen.getByRole('separator', { name: 'Largeur des volets' });
  fireEvent.keyDown(divider, { key: 'ArrowLeft' });
  expect(divider.getAttribute('aria-valuenow')).toBe('50');
  fireEvent.keyDown(divider, { key: 'ArrowRight' });
  expect(divider.getAttribute('aria-valuenow')).toBe('48');
});
