import { useCallback, useEffect, useRef, useState } from 'react';
import { DocxEditor, type DocxEditorRef } from '@eigenpal/docx-editor-react';
import '@eigenpal/docx-editor-react/styles.css';
import fr from '@eigenpal/docx-editor-i18n/fr';

import { api, authenticatedFetch } from '@/shared/api';
import { useTheme } from '@/shared/context/ThemeContext';
import type { CodeEditorFile } from '@/shared/types';

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const VERSION_POLL_MS = 1000;
const SAVE_DEBOUNCE_MS = 800;

type DocxDocumentViewerProps = {
  file: CodeEditorFile;
  projectId?: string;
  isSidebar: boolean;
  onClose: () => void;
};

function decodeDocumentPath(filePath: string): string {
  try {
    return decodeURIComponent(filePath);
  } catch {
    return filePath;
  }
}

export default function DocxDocumentViewer({ file, projectId, isSidebar, onClose }: DocxDocumentViewerProps) {
  const { isDarkMode } = useTheme();
  const editorRef = useRef<DocxEditorRef>(null);
  const versionRef = useRef<number | null>(null);
  const userEditingRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const resolvedPathRef = useRef(file.path);
  const [loaded, setLoaded] = useState<{ buffer: ArrayBuffer; version: number; filePath: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const markUserEditing = () => { userEditingRef.current = true; };

  return (
    <div className={`flex flex-col bg-background ${isSidebar ? 'h-full w-full' : 'fixed inset-0 z-[9999]'}`} onKeyDownCapture={markUserEditing} onPointerDownCapture={markUserEditing}>
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
          onChange={scheduleSave}
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
