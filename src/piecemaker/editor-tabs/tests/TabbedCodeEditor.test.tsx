import { createRef, useContext, useEffect } from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorSidebar } from '@/modules/code-editor';
import TabbedCodeEditor from '@/piecemaker/editor-tabs/TabbedCodeEditor';
import { citationPath, identityPath, openInEditor } from '@/piecemaker/editor-tabs/editorPanels';
import { usePiecemakerEditorBridge } from '@/piecemaker/editor-tabs/usePiecemakerEditorBridge';
import { DocxSaveContext } from '@/piecemaker/docx/pendingSaves';
import workspaceMainSource from '@/modules/project-workspace/WorkspaceMain.tsx?raw';
import type { CodeEditorFile } from '@/shared/types';

vi.mock('@/modules/code-editor/CodeEditor', () => ({
  default: function MockCodeEditor({ file, onClose }: { file: CodeEditorFile; onClose: () => void }) {
    const registerSave = useContext(DocxSaveContext);
    useEffect(() => {
      if (file.name.endsWith('.docx')) return registerSave?.(saveDocx);
    }, [file.name, registerSave]);
    return <section data-testid="code-editor" data-path={file.path}><button onClick={onClose}>Fermer le fichier</button></section>;
  },
}));

const { resolveFileRef, saveDocx } = vi.hoisted(() => ({
  saveDocx: vi.fn<() => Promise<boolean>>(),
  resolveFileRef: vi.fn(async (path: string) => (path.includes('disparu') ? null : `/reel${path}`)),
}));

vi.mock('@/piecemaker/chat/fileRef', () => ({ resolveFileRef }));

vi.mock('@/piecemaker/citations/CitationPanel', () => ({
  CitationPanel: ({ token, onClose }: { token: string; onClose: () => void }) => (
    <aside data-testid="citation" data-token={token}><button onClick={onClose}>Fermer la source</button></aside>
  ),
}));

const token = 'b'.repeat(64);
const file = (path: string): CodeEditorFile => ({ name: path.split('/').pop() ?? path, path, projectId: 'dossier-a' });
const tabs = () => screen.queryAllByRole('tab').map((tab) => tab.textContent);
const shown = async () => (await screen.findByTestId('code-editor')).dataset.path;

beforeEach(() => { saveDocx.mockReset().mockResolvedValue(true); });
afterEach(() => { vi.restoreAllMocks(); resolveFileRef.mockClear(); });

describe('onglets de l’éditeur latéral', () => {
  it('attend la sauvegarde Word avant de fermer un onglet', async () => {
    const onClose = vi.fn();
    render(<TabbedCodeEditor file={file('/dossier/note.docx')} onClose={onClose} isSidebar />);
    await shown();
    let finish!: (saved: boolean) => void;
    saveDocx.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Fermer le fichier' }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finish(true); });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('un conflit Word empêche de fermer le document ou d’en ouvrir un autre', async () => {
    const onClose = vi.fn();
    const first = file('/dossier/note.docx');
    const view = render(<TabbedCodeEditor file={first} onClose={onClose} isSidebar />);
    await shown();
    saveDocx.mockResolvedValue(false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fermer le fichier' })); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { view.rerender(<TabbedCodeEditor file={file('/dossier/plan.md')} onClose={onClose} isSidebar />); });
    expect(await shown()).toBe('/reel/dossier/note.docx');
  });

  it('un conflit Word dans un autre panneau ne bloque pas un éditeur texte', async () => {
    const closeWord = vi.fn();
    const closeText = vi.fn();
    render(<TabbedCodeEditor file={file('/dossier/note.docx')} onClose={closeWord} isSidebar />);
    await screen.findByTestId('code-editor');
    await act(async () => { render(<TabbedCodeEditor file={file('/dossier/notes.md')} onClose={closeText} isSidebar />); });
    saveDocx.mockResolvedValue(false);
    const buttons = screen.getAllByRole('button', { name: 'Fermer le fichier' });
    await act(async () => { fireEvent.click(buttons[1]); });
    expect(closeText).toHaveBeenCalledOnce();
    expect(saveDocx).not.toHaveBeenCalled();
    expect(closeWord).not.toHaveBeenCalled();
  });

  it('fermer deux onglets pendant une sauvegarde ne réouvre pas le premier', async () => {
    const onClose = vi.fn();
    const view = render(<TabbedCodeEditor file={file('/dossier/a.md')} onClose={onClose} isSidebar />);
    await shown();
    view.rerender(<TabbedCodeEditor file={file('/dossier/b.docx')} onClose={onClose} isSidebar />);
    await shown();
    let finish!: (saved: boolean) => void;
    const waiting = new Promise<boolean>((resolve) => { finish = resolve; });
    saveDocx.mockReturnValue(waiting);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer b.docx' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fermer a.md' }));
    await act(async () => { finish(true); });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ouvrir un fichier puis fermer un onglet pendant la sauvegarde conserve le nouveau fichier', async () => {
    const view = render(<TabbedCodeEditor file={file('/dossier/a.md')} onClose={vi.fn()} isSidebar />);
    await shown();
    view.rerender(<TabbedCodeEditor file={file('/dossier/b.docx')} onClose={vi.fn()} isSidebar />);
    await shown();
    let finish!: (saved: boolean) => void;
    const waiting = new Promise<boolean>((resolve) => { finish = resolve; });
    saveDocx.mockReturnValue(waiting);
    view.rerender(<TabbedCodeEditor file={file('/dossier/c.md')} onClose={vi.fn()} isSidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer b.docx' }));
    await act(async () => { finish(true); });
    expect(tabs()).toEqual(['a.md', 'c.md']);
    expect(await shown()).toBe('/reel/dossier/c.md');
  });

  it('garde chaque fichier ouvert dans un onglet, bascule de l’un à l’autre et referme le panneau avec le dernier', async () => {
    const onClose = vi.fn();
    const first = file('/dossier/notes.md');
    const view = render(<TabbedCodeEditor file={first} onClose={onClose} isSidebar />);
    expect(tabs()).toEqual([]);

    view.rerender(<TabbedCodeEditor file={file('/dossier/plan.md')} onClose={onClose} isSidebar />);
    expect(tabs()).toEqual(['notes.md', 'plan.md']);
    expect(await shown()).toBe('/reel/dossier/plan.md');

    fireEvent.click(screen.getByRole('tab', { name: 'notes.md' }));
    expect(await shown()).toBe('/reel/dossier/notes.md');

    view.rerender(<TabbedCodeEditor file={file('/dossier/notes.md')} onClose={onClose} isSidebar />);
    expect(tabs()).toEqual(['notes.md', 'plan.md']);

    fireEvent.click(screen.getByRole('button', { name: 'Fermer le fichier' }));
    expect(tabs()).toEqual([]);
    expect(await shown()).toBe('/reel/dossier/plan.md');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Fermer le fichier' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ouvre une citation dans un onglet nommé d’après sa référence', async () => {
    const view = render(<TabbedCodeEditor file={file('/dossier/notes.md')} onClose={vi.fn()} isSidebar />);
    view.rerender(<TabbedCodeEditor file={file(citationPath(token, 'Citation [2]'))} onClose={vi.fn()} isSidebar />);
    expect(tabs()).toEqual(['notes.md', 'Citation [2]']);
    expect(screen.getByTestId('citation').dataset.token).toBe(token);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer Citation [2]' }));
    expect(await shown()).toBe('/reel/dossier/notes.md');
  });

  it('vérifie le fichier avant d’ouvrir l’éditeur et signale un fichier disparu', async () => {
    const onClose = vi.fn();
    render(<TabbedCodeEditor file={file('/dossier/disparu.md')} onClose={onClose} isSidebar />);
    expect((await screen.findByRole('status')).textContent).toContain('disparu.md');
    expect(screen.queryByTestId('code-editor')).toBeNull();
    expect(resolveFileRef).toHaveBeenCalledWith('/dossier/disparu.md', { fresh: true, projectId: 'dossier-a' });
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ouvre un document de la Bibliothèque sans le chercher dans un dossier', async () => {
    render(<TabbedCodeEditor file={{ ...file('disparu.md'), projectId: 'piecemaker-library:exemple' }} onClose={vi.fn()} isSidebar />);
    expect((await screen.findByTestId('code-editor')).dataset.path).toBe('disparu.md');
    expect(resolveFileRef).not.toHaveBeenCalled();
  });

  it('confie au plugin Dossier un conteneur pour la fiche et le libère à la fermeture', () => {
    const opened: Array<{ text: string; container: HTMLElement; onClose: () => void }> = [];
    const closed = vi.fn();
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string; container: HTMLElement; onClose: () => void }>).detail;
      detail.container.append(Object.assign(document.createElement('div'), { textContent: 'Fiche' }));
      opened.push(detail);
    };
    window.addEventListener('piecemaker:identity-open', open);
    window.addEventListener('piecemaker:identity-close', closed);
    const onClose = vi.fn();
    try {
      const view = render(<TabbedCodeEditor file={file(identityPath('open', 'Jean Dupont'))} onClose={onClose} isSidebar />);
      expect(opened.map((entry) => entry.text)).toEqual(['Jean Dupont']);
      expect(screen.getByText('Fiche')).toBeTruthy();
      expect(screen.queryByRole('status')).toBeNull();
      act(() => opened[0].onClose());
      expect(onClose).toHaveBeenCalledOnce();
      view.unmount();
      expect(closed).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('piecemaker:identity-open', open);
      window.removeEventListener('piecemaker:identity-close', closed);
    }
  });

  it('signale une fiche indisponible quand le plugin Dossier ne répond pas', () => {
    render(<TabbedCodeEditor file={file(identityPath('add', 'Société Exemple SAS'))} onClose={vi.fn()} isSidebar />);
    expect(screen.getByRole('status').textContent).toContain('plugin Dossier');
  });
});

describe('exceptions CloudCLI : le panneau latéral passe par les onglets PieceMaker', () => {
  it('EditorSidebar rend ses fichiers à travers TabbedCodeEditor', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    render(
      <EditorSidebar
        editingFile={file(citationPath(token, 'Citation [1]'))}
        isMobile={false}
        editorExpanded={false}
        editorWidth={600}
        hasManualWidth={false}
        resizeHandleRef={createRef<HTMLDivElement>()}
        onResizeStart={vi.fn()}
        onCloseEditor={vi.fn()}
        onToggleEditorExpand={vi.fn()}
      />,
    );
    expect(screen.getByTestId('citation').dataset.token).toBe(token);
    vi.unstubAllGlobals();
  });

  it('WorkspaceMain relie les ouvertures PieceMaker à son éditeur latéral', () => {
    expect(workspaceMainSource).toContain('usePiecemakerEditorBridge(handleFileOpen);');
    const openFile = vi.fn();
    renderHook(() => usePiecemakerEditorBridge(openFile));
    openInEditor(citationPath(token, 'Citation [1]'));
    expect(openFile).toHaveBeenCalledWith(citationPath(token, 'Citation [1]'));
  });
});
