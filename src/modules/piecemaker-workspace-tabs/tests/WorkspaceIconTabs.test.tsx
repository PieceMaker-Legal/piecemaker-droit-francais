import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { WorkspaceIconTabs } from '@/modules/piecemaker-workspace-tabs';

vi.mock('@/modules/piecemaker-workspace-tabs/WorkspacePanels', () => ({ withWorkspacePanels: vi.fn() }));
vi.mock('@/modules/piecemaker-workspace-tabs/WorkspaceViewer', () => ({ WorkspaceViewer: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/plugins', () => ({
  usePlugins: () => ({ plugins: [{ name: 'example', displayName: 'Exemple', icon: 'icon.svg', enabled: true }] }),
  PluginIcon: () => <svg />,
}));

let width = 400;
let resize: () => void;

beforeEach(() => {
  width = 400;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 40, top: 0, bottom: 40, left: 0, right: width, x: 0, y: 0, toJSON() {} }));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() {}
  });
});

afterEach(() => vi.unstubAllGlobals());

it('conserve le branchement PieceMaker lors des merges upstream', () => {
  execFileSync(process.execPath, ['scripts/piecemaker/workspace-tabs/restore.mjs']);
  const headerSource = readFileSync('src/modules/project-workspace/WorkspaceHeader.tsx', 'utf8');
  expect(headerSource).toContain("import { WorkspaceIconTabs as WorkspaceTabs } from '@/modules/piecemaker-workspace-tabs';");
  expect(readFileSync('src/modules/project-workspace/WorkspaceMain.tsx', 'utf8')).toContain('React.memo(withWorkspacePanels(WorkspaceMain))');
  expect(readFileSync('src/modules/project-workspace/WorkspaceMain.tsx', 'utf8')).toContain('WorkspaceViewer as EditorSidebar');
});

it('affiche uniquement les icônes et révèle leur nom au survol', async () => {
  render(<WorkspaceIconTabs activeTab="files" setActiveTab={vi.fn()} shouldShowTasksTab shouldShowBrowserTab />);
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  const files = screen.getByRole('tab', { name: 'tabs.files' });
  expect(files.textContent).toBe('');
  expect(files.getAttribute('aria-selected')).toBe('true');
  fireEvent.mouseEnter(files.parentElement!);
  expect(await screen.findByText('tabs.files')).toBeTruthy();
});

it('place le surplus dans le menu et conserve l’onglet actif visible après redimensionnement', () => {
  const setActiveTab = vi.fn();
  render(<WorkspaceIconTabs activeTab="plugin:example" setActiveTab={setActiveTab} shouldShowTasksTab shouldShowBrowserTab />);
  width = 114;
  act(() => resize());
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(screen.getByRole('tab', { name: 'Exemple' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'tabs.more' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'tabs.files' }));
  expect(setActiveTab).toHaveBeenCalledWith('files');
  width = 400;
  act(() => resize());
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.queryByRole('button', { name: 'tabs.more' })).toBeNull();
});

it('affiche l’icône du plugin dans le menu de débordement', () => {
  width = 114;
  render(<WorkspaceIconTabs activeTab="files" setActiveTab={vi.fn()} shouldShowTasksTab shouldShowBrowserTab />);
  act(() => resize());
  fireEvent.click(screen.getByRole('button', { name: 'tabs.more' }));
  expect(screen.getByRole('menuitem', { name: 'Exemple' }).querySelector('svg')).not.toBeNull();
});

it('permet de changer d’onglet au clavier', () => {
  const setActiveTab = vi.fn();
  render(<WorkspaceIconTabs activeTab="chat" setActiveTab={setActiveTab} shouldShowTasksTab={false} shouldShowBrowserTab={false} />);
  fireEvent.keyDown(screen.getByRole('tab', { name: 'tabs.chat' }), { key: 'ArrowRight' });
  expect(setActiveTab).toHaveBeenCalledWith('files');
});
