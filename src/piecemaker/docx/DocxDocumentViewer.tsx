import { useCallback, useEffect, useRef, useState } from 'react';
import { DocxEditor, type DocxEditorRef } from '@eigenpal/docx-editor-react';
import { ListTree, MessageSquare } from 'lucide-react';
import '@eigenpal/docx-editor-react/styles.css';
import fr from '@eigenpal/docx-editor-i18n/fr';
import './docxDocumentViewer.css';

import { useAuth } from '@/modules/auth';
import { api, authenticatedFetch } from '@/shared/api';
import { useTheme } from '@/shared/context/ThemeContext';
import type { CodeEditorFile } from '@/shared/types';

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const VERSION_POLL_MS = 1000;
const SAVE_DEBOUNCE_MS = 800;
const COMMENTS_SIDEBAR_RESERVED_PX = 248;

type DocxDocumentViewerProps = {
  file: CodeEditorFile;
  projectId?: string;
  isSidebar: boolean;
  onClose: () => void;
};

function fitPageWidth(container: HTMLElement, editor: DocxEditorRef | null, lastLayout: { current: string }) {
  const scroller = container.querySelector<HTMLElement>('.docx-editor__scroll-container');
  const page = container.querySelector<HTMLElement>('.layout-page');
  if (!editor || !scroller || !page) return;
  const reserved = container.querySelector('.docx-unified-sidebar') ? COMMENTS_SIDEBAR_RESERVED_PX : 0;
  const availableWidth = scroller.clientWidth - reserved;
  const layout = `${availableWidth}:${page.offsetWidth}`;
  if (availableWidth <= 0 || layout === lastLayout.current) return;
  lastLayout.current = layout;
  const previousZoom = editor.getZoom();
  const nextZoom = availableWidth / page.offsetWidth;
  const previousScrollTop = scroller.scrollTop;
  editor.setZoom(nextZoom);
  window.setTimeout(() => { scroller.scrollTop = previousScrollTop * nextZoom / previousZoom; }, 300);
}

function decodeDocumentPath(filePath: string): string {
  try {
    return decodeURIComponent(filePath);
  } catch {
    return filePath;
  }
}

export default function DocxDocumentViewer({ file, projectId, isSidebar, onClose }: DocxDocumentViewerProps) {
  const { isDarkMode } = useTheme();
  const { user } = useAuth();
  const editorRef = useRef<DocxEditorRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastLayoutRef = useRef('');
  const versionRef = useRef<number | null>(null);
  const userEditingRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const resolvedPathRef = useRef(file.path);
  const [loaded, setLoaded] = useState<{ buffer: ArrayBuffer; version: number; filePath: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const fetchVersion = useCallback(async () => {
    const requestVersion = (filePath: string) => {
      const query = new URLSearchParams({ projectId: projectId ?? '', path: filePath });
      return authenticatedFetch(`/api/piecemaker/docx-document/version?${query}`);
    };
    let filePath = resolvedPathRef.current;
    let response = await requestVersion(filePath);
    if (response.status === 400 || response.status === 404) {
      const decodedPath = decodeDocumentPath(filePath);
      if (decodedPath !== filePath) {
        filePath = decodedPath;
        response = await requestVersion(filePath);
      }
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    resolvedPathRef.current = filePath;
    return { filePath, version: ((await response.json()) as { version: number }).version };
  }, [projectId]);

  const load = useCallback(async () => {
    if (!projectId) return;
    const { filePath, version } = await fetchVersion();
    const response = await api.readFileBlob(projectId, filePath);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    userEditingRef.current = false;
    versionRef.current = version;
    setError(null);
    setLoaded({ buffer, version, filePath });
  }, [fetchVersion, projectId]);

  useEffect(() => {
    resolvedPathRef.current = file.path;
    load().catch((loadError: unknown) => setError(String(loadError)));
    const poll = window.setInterval(() => {
      if (savingRef.current) return;
      fetchVersion()
        .then(({ version }) => { if (!savingRef.current && version !== versionRef.current) return load(); })
        .catch(() => undefined);
    }, VERSION_POLL_MS);
    return () => {
      window.clearInterval(poll);
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [fetchVersion, file.path, load]);

  const save = useCallback(async () => {
    saveTimerRef.current = null;
    const buffer = await editorRef.current?.save();
    if (!buffer) return;
    savingRef.current = true;
    try {
      const documentQuery = new URLSearchParams({ projectId: projectId ?? '', path: resolvedPathRef.current });
      const response = await authenticatedFetch(`/api/piecemaker/docx-document?${documentQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': DOCX_MIME_TYPE },
        body: buffer,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      versionRef.current = ((await response.json()) as { version: number }).version;
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      savingRef.current = false;
    }
  }, [projectId]);

  const scheduleSave = useCallback(() => {
    if (!userEditingRef.current) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { void save(); }, SAVE_DEBOUNCE_MS);
  }, [save]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !loaded) return undefined;
    lastLayoutRef.current = '';
    const fit = () => fitPageWidth(container, editorRef.current, lastLayoutRef);
    const resizeObserver = new ResizeObserver(fit);
    const mutationObserver = new MutationObserver(fit);
    resizeObserver.observe(container);
    mutationObserver.observe(container, { childList: true, subtree: true });
    fit();
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [loaded]);

  const markUserEditing = () => { userEditingRef.current = true; };

  const panelButtonClass = (active: boolean) => `rounded-md p-1.5 hover:bg-muted ${active ? 'bg-muted text-foreground' : 'text-muted-foreground'}`;

  return (
    <div ref={containerRef} className={`piecemaker-docx-viewer flex flex-col bg-background ${isSidebar ? 'h-full w-full' : 'fixed inset-0 z-[9999]'}`} onKeyDownCapture={markUserEditing} onPointerDownCapture={markUserEditing}>
      {error && <p className="border-b border-border px-3 py-1.5 text-xs text-destructive">{error}</p>}
      {loaded ? (
        <DocxEditor
          key={loaded.version}
          ref={editorRef}
          documentBuffer={loaded.buffer}
          documentName={loaded.filePath.split(/[\\/]/).pop() || file.name}
          documentNameEditable={false}
          showFileOpen={false}
          mode="editing"
          colorMode={isDarkMode ? 'dark' : 'light'}
          i18n={fr}
          author={user?.username}
          onChange={scheduleSave}
          showOutline={outlineOpen}
          showOutlineButton={false}
          commentsSidebarOpen={commentsOpen}
          onCommentsSidebarOpenChange={setCommentsOpen}
          renderLogo={() => (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setOutlineOpen((open) => !open)} className={panelButtonClass(outlineOpen)} aria-pressed={outlineOpen} aria-label="Table des matières" title="Table des matières"><ListTree className="h-4 w-4" /></button>
              <button type="button" onClick={() => setCommentsOpen((open) => !open)} className={panelButtonClass(commentsOpen)} aria-pressed={commentsOpen} aria-label="Commentaires" title="Commentaires"><MessageSquare className="h-4 w-4" /></button>
            </div>
          )}
          renderTitleBarRight={() => (
            <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted" aria-label="Fermer">✕</button>
          )}
          style={{ flex: 1, minHeight: 0 }}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{error ? file.path : 'Chargement…'}</div>
      )}
    </div>
  );
}
