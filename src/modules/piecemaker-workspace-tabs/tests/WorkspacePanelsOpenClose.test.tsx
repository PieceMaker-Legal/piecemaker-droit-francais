import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { expect, it, vi } from 'vitest';

import { withWorkspacePanels } from '@/modules/piecemaker-workspace-tabs';
import { WorkspaceViewer } from '@/modules/piecemaker-workspace-tabs/WorkspaceViewer';
import type { AppTab, CodeEditorFile, Project, ProjectSession } from '@/shared/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/modules/plugins', () => ({
  usePlugins: () => ({ plugins: [{ name: 'example', displayName: 'Exemple', enabled: true }] }),
  PluginTabContent: ({ pluginName }: { pluginName: string }) => <div>Contenu {pluginName}</div>,
}));
vi.mock('@/modules/file-tree', () => ({ FileTree: () => <div>Fichiers du dossier</div> }));
vi.mock('@/modules/git-panel', () => ({ GitPanel: () => <div>Contenu git</div> }));
vi.mock('@/modules/browser-use', () => ({ useBrowserUseEnabled: () => false, BrowserUsePanel: () => null }));
vi.mock('@/modules/code-editor', () => ({ EditorSidebar: () => null }));
vi.mock('@/modules/piecemaker-workspace-tabs/useAutoPanel', () => ({ useAutoPanel: () => undefined }));
vi.mock('@/modules/piecemaker-workspace-tabs/agent/useAgentSession', () => ({ useAgentSession: () => true }));
vi.mock('@/modules/piecemaker-workspace-tabs/agent/AgentPanel', () => ({ AgentPanel: () => <div>Contenu agent</div> }));
vi.mock('@/piecemaker/editor-tabs/TabbedCodeEditor', () => ({
  default: ({ file, onClose }: { file: CodeEditorFile; onClose: () => void }) => (
    <div>Document {file.name}<button type="button" onClick={onClose}>Fermer l’onglet {file.name}</button></div>
  ),
}));

const document: CodeEditorFile = { name: 'contrat.docx', path: '/dossier/contrat.docx', projectId: 'exemple' };

function Harness({ onCloseEditor }: { onCloseEditor: () => void }) {
  const [activeTab, setActiveTab] = useState<AppTab>('chat');
  const [editingFile, setEditingFile] = useState<CodeEditorFile | null>(null);
  const closeEditor = () => { onCloseEditor(); setEditingFile(null); };
  const Workspace = useState(() => withWorkspacePanels((props: ComponentProps<typeof WorkspaceShell>) => <WorkspaceShell {...props} />))[0];
  return <Workspace
    activeTab={activeTab} setActiveTab={setActiveTab}
    selectedProject={{ projectId: 'exemple', path: '/dossier', fullPath: '/dossier' } as Project}
    selectedSession={{ id: 'session-agent' } as ProjectSession}
    isMobile={false} isLoading={false} onShowSettings={vi.fn()} onProjectSelect={vi.fn()} onProjectsRefresh={vi.fn()}
    editingFile={editingFile} openDocument={() => setEditingFile(document)} closeEditor={closeEditor}
  />;
}

type ShellProps = ComponentProps<ReturnType<typeof withWorkspacePanels>> & {
  editingFile: CodeEditorFile | null;
  openDocument: () => void;
  closeEditor: () => void;
};

function WorkspaceShell(props: ShellProps) {
  return <div>
    {(['files', 'git', 'plugin:example'] as AppTab[]).map((tab) => <button key={tab} type="button" onClick={() => props.setActiveTab(tab)}>{tab}</button>)}
    <button type="button" onClick={props.openDocument}>Ouvrir le document</button>
    <WorkspaceViewer editingFile={props.editingFile} projectPath="/dossier" onCloseEditor={props.closeEditor} onUnsavedChangesChange={vi.fn()} isMobile={false} editorExpanded={false} editorWidth={600} hasManualWidth={false} resizeHandleRef={{ current: null }} onResizeStart={vi.fn()} onToggleEditorExpand={vi.fn()} />
  </div>;
}

const panelOrder = () => Array.from(globalThis.document.querySelectorAll('.piecemaker-workspace-column')).map((column) => column.textContent);

it('ouvre le nouveau volet au-dessus du volet Agent', () => {
  render(<Harness onCloseEditor={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'git' }));
  const columns = panelOrder();
  expect(columns).toHaveLength(1);
  expect(columns[0]!.indexOf('Contenu git')).toBeLessThan(columns[0]!.indexOf('Contenu agent'));
});

it('ferme tout le volet Fichiers, document compris, sans le rouvrir dans une autre colonne', () => {
  const onCloseEditor = vi.fn();
  render(<Harness onCloseEditor={onCloseEditor} />);
  fireEvent.click(screen.getByRole('button', { name: 'files' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le document' }));
  expect(screen.getByText('Fichiers du dossier').closest('.piecemaker-files-panel')?.textContent).toContain('Document contrat.docx');
  fireEvent.click(screen.getByRole('button', { name: 'Fermer tabs.files' }));
  expect(onCloseEditor).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Fichiers du dossier')).toBeNull();
  expect(screen.queryByText(/Document contrat\.docx/)).toBeNull();
  expect(screen.queryByLabelText('Colonne visionneuse')).toBeNull();
  expect(screen.getByText('Contenu agent')).toBeTruthy();
});

it('ferme seulement l’onglet du document et garde le volet Fichiers ouvert', () => {
  render(<Harness onCloseEditor={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'files' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le document' }));
  fireEvent.click(screen.getByRole('button', { name: 'Fermer l’onglet contrat.docx' }));
  expect(screen.queryByText(/Document contrat\.docx/)).toBeNull();
  expect(screen.getByText('Fichiers du dossier')).toBeTruthy();
});
