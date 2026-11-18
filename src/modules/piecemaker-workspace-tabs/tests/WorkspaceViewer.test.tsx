import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { expect, it, vi } from 'vitest';

import { withWorkspacePanels } from '@/modules/piecemaker-workspace-tabs';
import { WorkspaceViewer } from '@/modules/piecemaker-workspace-tabs/WorkspaceViewer';
import type { AppTab, CodeEditorFile, Project } from '@/shared/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/plugins', () => ({ usePlugins: () => ({ plugins: [] }), PluginTabContent: () => null }));
vi.mock('@/modules/file-tree', () => ({ FileTree: () => null }));
vi.mock('@/modules/git-panel', () => ({ GitPanel: () => null }));
vi.mock('@/modules/browser-use', () => ({ useBrowserUseEnabled: () => false, BrowserUsePanel: () => null }));
vi.mock('@/modules/code-editor', () => ({ EditorSidebar: () => null }));
vi.mock('@/modules/piecemaker-workspace-tabs/useAutoPanel', () => ({ useAutoPanel: () => undefined }));
vi.mock('@/piecemaker/editor-tabs/TabbedCodeEditor', () => ({
  default: ({ isExpanded, onToggleExpand }: { isExpanded: boolean; onToggleExpand: () => void }) => (
    <button type="button" onClick={onToggleExpand}>{isExpanded ? 'Réduire le document' : 'Agrandir le document'}</button>
  ),
}));

const document: CodeEditorFile = { name: 'note.md', path: '/dossier/note.md', projectId: 'exemple' };

const Workspace = withWorkspacePanels((props) => <div data-testid="main">
  <button type="button" onClick={() => props.setActiveTab('files')}>files</button>
  <WorkspaceViewer editingFile={document} projectPath="/dossier" onCloseEditor={vi.fn()} onUnsavedChangesChange={vi.fn()} isMobile={false} editorExpanded={false} editorWidth={600} hasManualWidth={false} resizeHandleRef={{ current: null }} onResizeStart={vi.fn()} onToggleEditorExpand={vi.fn()} />
</div>);

function Harness() {
  const [activeTab, setActiveTab] = useState<AppTab>('chat');
  const props: ComponentProps<typeof Workspace> = {
    activeTab, setActiveTab, selectedProject: { projectId: 'exemple', path: '/dossier' } as Project, selectedSession: null,
    isMobile: false, isLoading: false, onShowSettings: vi.fn(), onProjectSelect: vi.fn(), onProjectsRefresh: vi.fn(),
  };
  return <Workspace {...props} />;
}

it('met en plein écran le document de la colonne visionneuse puis le réduit', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Agrandir le document' }));
  expect(screen.getByTestId('main').closest('[hidden]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Réduire le document' }));
  expect(screen.getByTestId('main').closest('[hidden]')).toBeNull();
});

it('garde le document agrandi quand le volet Fichiers s’ouvre et l’accueille', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Agrandir le document' }));
  fireEvent.click(screen.getByRole('button', { name: 'files', hidden: true }));
  expect(screen.getByTestId('main').closest('[hidden]')).toBeTruthy();
  expect(globalThis.document.querySelector('.piecemaker-files-panel')?.hasAttribute('hidden')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Réduire le document' }));
  expect(screen.getByTestId('main').closest('[hidden]')).toBeNull();
});
