import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { expect, it, vi } from 'vitest';

import { withWorkspacePanels } from '@/modules/piecemaker-workspace-tabs';
import type { AppTab, Project } from '@/shared/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/plugins', () => ({
  usePlugins: () => ({ plugins: [
    { name: 'example', displayName: 'Exemple', enabled: true },
    { name: 'other', displayName: 'Autre', enabled: true },
  ] }),
  PluginTabContent: ({ pluginName }: { pluginName: string }) => <input aria-label={`Contenu ${pluginName}`} />,
}));
vi.mock('@/modules/file-tree', () => ({ FileTree: () => <div>Fichiers du dossier</div> }));
vi.mock('@/modules/git-panel', () => ({ GitPanel: () => <div>Git</div> }));
vi.mock('@/modules/task-master', () => ({ useTasksSettings: () => ({ tasksEnabled: true, isTaskMasterInstalled: true }), TaskMasterPanel: () => <div>Tâches</div> }));
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

it('permet de redimensionner le dock au clavier', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'files' }));
  const divider = screen.getByRole('separator');
  fireEvent.keyDown(divider, { key: 'ArrowLeft' });
  expect(divider.getAttribute('aria-valuenow')).toBe('50');
  fireEvent.keyDown(divider, { key: 'ArrowRight' });
  expect(divider.getAttribute('aria-valuenow')).toBe('48');
});
