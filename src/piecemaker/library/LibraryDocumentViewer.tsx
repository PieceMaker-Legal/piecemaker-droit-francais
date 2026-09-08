import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { EditorSidebar, useEditorSidebar } from '@/modules/code-editor';
import { api } from '@/shared/api';
import { AUTH_SESSION_EXPIRED_EVENT } from '@/shared/authToken';

export function LibraryDocumentViewer() {
  const [document, setDocument] = useState<{ name: string; content: string; container: HTMLElement; save: (content: string) => Promise<void> } | null>(null);
  const editor = useEditorSidebar({ selectedProject: null, isMobile: false });
  const { handleCloseEditor, handleFileOpen } = editor;
  const [projectId] = useState(() => `piecemaker-library:${crypto.randomUUID()}`);

  useEffect(() => {
    const open = (event: Event) => {
      const data = (event as CustomEvent).detail;
      if (typeof data?.name !== 'string' || typeof data?.content !== 'string' || !(data.container instanceof HTMLElement) || typeof data.save !== 'function') return;
      setDocument(data);
      handleFileOpen(`${data.name}.md`);
    };
    const close = () => { setDocument(null); handleCloseEditor(); };
    window.addEventListener('piecemaker:library-document', open);
    window.addEventListener('piecemaker:library-close', close);
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, close);
    return () => {
      window.removeEventListener('piecemaker:library-document', open);
      window.removeEventListener('piecemaker:library-close', close);
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, close);
    };
  }, [handleCloseEditor, handleFileOpen]);

  useLayoutEffect(() => {
    if (!document) return;
    let currentContent = document.content;
    const readFile = api.readFile;
    const saveFile = api.saveFile;
    const readLibraryFile: typeof api.readFile = (id, path) => id === projectId
      ? Promise.resolve(Response.json({ content: currentContent }))
      : readFile(id, path);
    const saveLibraryFile: typeof api.saveFile = async (id, path, content) => {
      if (id !== projectId) return saveFile(id, path, content);
      try {
        await document.save(content);
        currentContent = content;
        return Response.json({ ok: true });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
      }
    };
    api.readFile = readLibraryFile;
    api.saveFile = saveLibraryFile;
    return () => {
      if (api.readFile === readLibraryFile) api.readFile = readFile;
      if (api.saveFile === saveLibraryFile) api.saveFile = saveFile;
    };
  }, [document, projectId]);

  if (!document || !editor.editingFile) return null;
  return createPortal(
    <EditorSidebar
      key={document.name}
      editingFile={{ ...editor.editingFile, projectId }}
      isMobile={false}
      editorExpanded={editor.editorExpanded}
      editorWidth={editor.editorWidth}
      hasManualWidth={editor.hasManualWidth}
      resizeHandleRef={editor.resizeHandleRef}
      onResizeStart={editor.handleResizeStart}
      onCloseEditor={() => { setDocument(null); handleCloseEditor(); }}
      onToggleEditorExpand={editor.handleToggleEditorExpand}
    />,
    document.container,
  );
}
