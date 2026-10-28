import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { DocxEditor, type DocxEditorRef } from '@eigenpal/docx-editor-react';
import { acceptChange, acceptChangeById, rejectChange, rejectChangeById } from '@eigenpal/docx-editor-core/prosemirror/commands';
import { extractTrackedChanges } from '@eigenpal/docx-editor-core/prosemirror/utils/extractTrackedChanges';
import { ListTree, MessageSquare } from 'lucide-react';
import type { EditorView } from 'prosemirror-view';
import '@eigenpal/docx-editor-react/styles.css';
import fr from '@eigenpal/docx-editor-i18n/fr';
import './docxDocumentViewer.css';

import { useAuth } from '@/modules/auth';
import { DocxReasoningStatus, useDocxReasoning } from '@/modules/docx-reasoning';
import { useCitationPassage } from '@/piecemaker/citations/citationPassage';
import { clearDocxCitationHighlight, highlightCitationInDocx } from '@/piecemaker/citations/docxPassage';
import { api, authenticatedFetch } from '@/shared/api';
import { DocxSaveContext } from '@/piecemaker/docx/pendingSaves';
import { useTheme } from '@/shared/context/ThemeContext';
import type { CodeEditorFile } from '@/shared/types';

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const VERSION_POLL_MS = 1000;
const MISSING_FILE_MS = 10_000;
const SAVE_DEBOUNCE_MS = 800;
const COMMENTS_SIDEBAR_RESERVED_PX = 248;
const REVISION_MARK_SELECTOR = '.docx-insertion, .docx-deletion, [data-revision-id]';
const MARKUP_MARK_SELECTOR = `${REVISION_MARK_SELECTOR}, [data-comment-id]`;

function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

function commentOpenShortcutLabel() {
  return isMacPlatform() ? '⌘-clic pour ouvrir le commentaire' : 'Ctrl-clic pour ouvrir le commentaire';
}

function isCommentOpenModifier(event: { metaKey: boolean; ctrlKey: boolean }) {
  return isMacPlatform() ? event.metaKey : event.ctrlKey;
}

function isSelectorTarget(target: EventTarget | null, selector: string) {
  return target instanceof Element && Boolean(target.closest(selector));
}

type TrackedChangeEntry = ReturnType<typeof extractTrackedChanges>['entries'][number];
type PagedEditorHandle = NonNullable<ReturnType<DocxEditorRef['getEditorRef']>>;
type TrackedChangeRange = { from: number; to: number };

function addRevisionId(raw: unknown, into: Set<number | string>) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    into.add(raw);
    into.add(String(raw));
    return;
  }
  if (typeof raw === 'string' && raw !== '') {
    into.add(raw);
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) into.add(asNumber);
  }
}

function trackedChangeActionFromButton(button: HTMLElement, card: Element) {
  const title = button.getAttribute('title') ?? '';
  if (/^(Accepter|Accept)$/i.test(title)) return 'accept' as const;
  if (/^(Refuser|Reject)$/i.test(title)) return 'reject' as const;
  const index = [...card.querySelectorAll<HTMLElement>('button')].indexOf(button);
  if (index === 0) return 'accept' as const;
  if (index === 1) return 'reject' as const;
  return null;
}

function pagedEditorViews(editor: PagedEditorHandle | null): EditorView[] {
  if (!editor) return [];
  const views: EditorView[] = [];
  const body = editor.getView();
  if (body) views.push(body);
  const headersAndFooters = editor.getHfPmViews?.();
  if (!headersAndFooters) return views;
  for (const view of headersAndFooters.values()) {
    if (view) views.push(view);
  }
  return views;
}

function collectEntryTargets(entry: TrackedChangeEntry, ids: Set<number | string>, ranges: TrackedChangeRange[]) {
  addRevisionId(entry.revisionId, ids);
  addRevisionId(entry.insertionRevisionId, ids);
  for (const id of entry.coalescedRevisionIds ?? []) addRevisionId(id, ids);
  if (entry.to > entry.from) ranges.push({ from: entry.from, to: entry.to });
}

function quotedCardSnippets(card: Element) {
  return [...card.querySelectorAll('span')]
    .map((element) => (element.textContent ?? '').replace(/^["«]|["»]$/g, '').trim())
    .filter(Boolean);
}

function matchTrackedChangeEntry(card: Element, container: HTMLElement, entries: TrackedChangeEntry[]) {
  if (entries.length === 1) return entries[0];
  const cards = [...container.querySelectorAll('.docx-tracked-change-card')];
  const index = cards.indexOf(card);
  if (index >= 0 && index < entries.length) return entries[index];
  const snippets = quotedCardSnippets(card);
  const haystack = card.textContent ?? '';
  const matches = entries.filter((entry) => {
    const parts = [entry.text, entry.deletedText].filter((part): part is string => Boolean(part));
    return parts.some((part) => haystack.includes(part) || snippets.some((snippet) => part.includes(snippet) || snippet.includes(part)));
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function applyTrackedChangeCommand(views: EditorView[], action: 'accept' | 'reject', ids: Set<number | string>, ranges: TrackedChangeRange[]) {
  let applied = false;
  for (const view of views) {
    for (const id of ids) {
      const command = action === 'accept' ? acceptChangeById(id as number) : rejectChangeById(id as number);
      if (command(view.state, view.dispatch)) applied = true;
    }
  }
  if (applied) return true;
  for (const view of views) {
    for (const range of ranges) {
      const command = action === 'accept' ? acceptChange(range.from, range.to) : rejectChange(range.from, range.to);
      if (command(view.state, view.dispatch)) applied = true;
    }
  }
  return applied;
}

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

function alignNewCommentCard(container: HTMLElement, zoomAtClick: number) {
  const card = container.querySelector('.docx-unified-sidebar textarea')?.closest<HTMLElement>('[style*="position: absolute"]');
  if (!card || card.dataset.alignedTop === card.style.top) return;
  card.style.top = `${parseFloat(card.style.top) / zoomAtClick}px`;
  card.dataset.alignedTop = card.style.top;
}

function countThreads(comments: { parentId?: number | null }[]) {
  return comments.filter((comment) => comment.parentId == null).length;
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
  const registerSave = useContext(DocxSaveContext);
  const editorRef = useRef<DocxEditorRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastLayoutRef = useRef('');
  const zoomAtClickRef = useRef(1);
  const versionRef = useRef<number | null>(null);
  const modelVersionRef = useRef<string | null>(null);
  const userEditingRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const savePromiseRef = useRef(Promise.resolve(true));
  const editVersionRef = useRef(0);
  const savedEditVersionRef = useRef(0);
  const documentEpochRef = useRef(0);
  const loadingEpochRef = useRef<number | null>(null);
  const resolvedPathRef = useRef(file.path);
  const [loaded, setLoaded] = useState<{ buffer: ArrayBuffer; version: number; filePath: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const passage = useCitationPassage(file.path);
  const commentsOpenFromClickRef = useRef(false);
  const [revisionHint, setRevisionHint] = useState<{ x: number; y: number } | null>(null);
  const { state: reasoningState, reset: resetReasoning, dirty: markReasoningDirty, begin: beginReasoning, publish: publishReasoning, failed: failReasoning, check: checkReasoning } = useDocxReasoning();

  const fetchVersion = useCallback(async () => {
    const epoch = documentEpochRef.current;
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
    if (epoch === documentEpochRef.current) resolvedPathRef.current = filePath;
    const current = (await response.json()) as { version: number; reasoningVersion?: string | null };
    return { filePath, version: current.version, reasoningVersion: current.reasoningVersion ?? null };
  }, [projectId]);

  const load = useCallback(async (discardChanges = false) => {
    if (!projectId) return;
    const epoch = documentEpochRef.current;
    if (loadingEpochRef.current === epoch) return;
    loadingEpochRef.current = epoch;
    try {
      const { filePath, version, reasoningVersion } = await fetchVersion();
      if (epoch !== documentEpochRef.current) return;
      const response = await api.readFileBlob(projectId, filePath);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      if (epoch !== documentEpochRef.current) return;
      if (!discardChanges && editVersionRef.current !== savedEditVersionRef.current) {
        setConflict(true);
        return;
      }
      resetReasoning();
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      userEditingRef.current = false;
      editVersionRef.current = 0;
      savedEditVersionRef.current = 0;
      savePromiseRef.current = Promise.resolve(true);
      setConflict(false);
      versionRef.current = version;
      modelVersionRef.current = reasoningVersion;
      setError(null);
      setLoaded({ buffer, version, filePath });
      void checkReasoning(projectId, filePath, version);
    } finally {
      if (loadingEpochRef.current === epoch) loadingEpochRef.current = null;
    }
  }, [checkReasoning, fetchVersion, projectId, resetReasoning]);

  useEffect(() => {
    const epoch = ++documentEpochRef.current;
    resolvedPathRef.current = file.path;
    versionRef.current = null;
    modelVersionRef.current = null;
    const openedAt = Date.now();
    const missing = (error: unknown) => error instanceof Error && /HTTP 404/.test(error.message);
    load().catch((loadError: unknown) => {
      if (epoch !== documentEpochRef.current) return;
      if (missing(loadError)) return;
      setError(String(loadError));
    });
    const poll = window.setInterval(() => {
      if (savingRef.current) return;
      fetchVersion()
        .then(({ version, reasoningVersion }) => {
          if (epoch !== documentEpochRef.current || savingRef.current) return;
          if (version !== versionRef.current) {
            if (editVersionRef.current !== savedEditVersionRef.current) setConflict(true);
            else return load();
            return;
          }
          if (reasoningVersion !== modelVersionRef.current) {
            modelVersionRef.current = reasoningVersion;
            markReasoningDirty();
            if (saveTimerRef.current === null && projectId) void checkReasoning(projectId, resolvedPathRef.current, version);
          }
        })
        .catch(() => {
          if (epoch !== documentEpochRef.current) return;
          if (versionRef.current !== null || Date.now() - openedAt < MISSING_FILE_MS) return;
          setError(`Fichier introuvable : ${file.path}`);
        });
    }, VERSION_POLL_MS);
    return () => {
      documentEpochRef.current += 1;
      resetReasoning();
      window.clearInterval(poll);
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [checkReasoning, fetchVersion, file.path, load, markReasoningDirty, projectId, resetReasoning]);

  const save = useCallback((): Promise<boolean> => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const editVersion = editVersionRef.current;
    if (editVersion === savedEditVersionRef.current) return savePromiseRef.current;
    const editor = editorRef.current;
    if (!editor) return Promise.resolve(false);
    const filePath = resolvedPathRef.current;
    const epoch = documentEpochRef.current;
    const ticket = beginReasoning();
    savingRef.current = true;
    const snapshot = editor.save();
    void snapshot.catch(() => {});
    const operation = savePromiseRef.current.then(async () => {
      if (editVersion <= savedEditVersionRef.current) return true;
      try {
        const buffer = await snapshot;
        if (!buffer) throw new Error('Le document ne peut pas être enregistré.');
        const documentQuery = new URLSearchParams({ projectId: projectId ?? '', path: filePath });
        const response = await authenticatedFetch(`/api/piecemaker/docx-document?${documentQuery}`, {
          method: 'PUT',
          headers: { 'Content-Type': DOCX_MIME_TYPE, 'If-Match': String(versionRef.current) },
          body: buffer,
        });
        if (response.status === 409) {
          setConflict(true);
          markReasoningDirty();
          return false;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const saved = (await response.json()) as { version: number; reasoning: unknown; reasoningVersion?: string | null };
        if (epoch === documentEpochRef.current && filePath === resolvedPathRef.current) {
          versionRef.current = saved.version;
          modelVersionRef.current = saved.reasoningVersion ?? null;
        }
        savedEditVersionRef.current = editVersion;
        setConflict(false);
        setError(null);
        publishReasoning(ticket, saved.reasoning);
        return true;
      } catch (saveError) {
        if (epoch === documentEpochRef.current) setError(String(saveError));
        failReasoning(ticket, saveError);
        return false;
      }
    });
    savePromiseRef.current = operation;
    void operation.then(() => { if (savePromiseRef.current === operation) savingRef.current = false; });
    return operation;
  }, [beginReasoning, failReasoning, markReasoningDirty, projectId, publishReasoning]);

  const flush = useCallback(async () => {
    do {
      if (!await save()) return false;
    } while (editVersionRef.current !== savedEditVersionRef.current);
    return true;
  }, [save]);

  useEffect(() => registerSave?.(flush), [flush, registerSave]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!savingRef.current && editVersionRef.current === savedEditVersionRef.current) return;
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, []);
  useLayoutEffect(() => () => { void save(); }, [save]);

  const scheduleSave = useCallback(() => {
    if (!userEditingRef.current) return;
    editVersionRef.current += 1;
    markReasoningDirty();
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { void save(); }, SAVE_DEBOUNCE_MS);
  }, [markReasoningDirty, save]);

  const close = async () => { if (await flush()) onClose(); };

  const reloadExternal = async () => {
    if (!window.confirm('Abandonner vos modifications locales et recharger le document du disque ?')) return;
    try { await savePromiseRef.current; await load(true); } catch (loadError) { setError(String(loadError)); }
  };

  const overwriteExternal = async () => {
    if (!window.confirm('Remplacer la version du disque par vos modifications locales ?')) return;
    try {
      versionRef.current = (await fetchVersion()).version;
      await save();
    } catch (saveError) { setError(String(saveError)); }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !loaded) return undefined;
    lastLayoutRef.current = '';
    const fit = () => fitPageWidth(container, editorRef.current, lastLayoutRef);
    const resizeObserver = new ResizeObserver(fit);
    const mutationObserver = new MutationObserver(() => {
      fit();
      setCommentCount(countThreads(editorRef.current?.getComments() ?? []));
      alignNewCommentCard(container, zoomAtClickRef.current);
    });
    resizeObserver.observe(container);
    mutationObserver.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    fit();
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [loaded]);

  useEffect(() => {
    if (!loaded || !passage?.quote) return undefined;
    let cancelled = false;
    let timer = 0;
    const tryHighlight = () => {
      if (cancelled) return;
      const views = pagedEditorViews(editorRef.current?.getEditorRef() ?? null);
      if (views.length === 0) {
        timer = window.setTimeout(tryHighlight, 80);
        return;
      }
      highlightCitationInDocx(views, passage.quote);
    };
    timer = window.setTimeout(tryHighlight, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      clearDocxCitationHighlight();
    };
  }, [loaded, passage?.nonce, passage?.quote]);

  const applyTrackedChangeButton = useCallback((event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('button');
    const card = button?.closest('.docx-tracked-change-card');
    if (!button || !card) return;
    const action = trackedChangeActionFromButton(button, card);
    if (!action) return;
    const editor = editorRef.current?.getEditorRef() ?? null;
    const views = pagedEditorViews(editor);
    if (views.length === 0) return;
    const container = event.currentTarget as HTMLElement;
    const ids = new Set<number | string>();
    const ranges: TrackedChangeRange[] = [];
    const targets = views.flatMap((view) => extractTrackedChanges(view.state).entries.map((entry) => ({ view, entry })));
    const entry = matchTrackedChangeEntry(card, container, targets.map((target) => target.entry));
    const owner = targets.find((target) => target.entry === entry);
    if (!entry || !owner) return;
    collectEntryTargets(entry, ids, ranges);
    if (!applyTrackedChangeCommand([owner.view], action, ids, ranges)) return;
    userEditingRef.current = true;
    editor?.relayout();
    scheduleSave();
  }, [scheduleSave]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !loaded) return undefined;
    const onClick = (event: MouseEvent) => applyTrackedChangeButton(event);
    container.addEventListener('click', onClick, true);
    return () => container.removeEventListener('click', onClick, true);
  }, [applyTrackedChangeButton, loaded]);

  const markUserEditing = () => { userEditingRef.current = true; };

  const markCommentOpenGesture = (event: { target: EventTarget | null; metaKey: boolean; ctrlKey: boolean }) => {
    commentsOpenFromClickRef.current = isSelectorTarget(event.target, MARKUP_MARK_SELECTOR) && isCommentOpenModifier(event);
  };

  const revisionHintPosition = (event: { clientX: number; clientY: number }) => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const x = (Number.isFinite(event.clientX) ? event.clientX : 0) - rect.left + 12;
    const y = (Number.isFinite(event.clientY) ? event.clientY : 0) - rect.top + 18;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 12, y: 18 };
    return { x, y };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    markUserEditing();
    zoomAtClickRef.current = editorRef.current?.getZoom() ?? 1;
    markCommentOpenGesture(event);
  };

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    markCommentOpenGesture(event);
  };

  const handlePointerOver = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isSelectorTarget(event.target, REVISION_MARK_SELECTOR)) return;
    const nextHint = revisionHintPosition(event);
    if (nextHint) setRevisionHint(nextHint);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!revisionHint || !isSelectorTarget(event.target, REVISION_MARK_SELECTOR)) return;
    const nextHint = revisionHintPosition(event);
    if (nextHint) setRevisionHint(nextHint);
  };

  const handlePointerOut = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isSelectorTarget(event.relatedTarget, REVISION_MARK_SELECTOR)) return;
    if (isSelectorTarget(event.target, REVISION_MARK_SELECTOR)) setRevisionHint(null);
  };

  const handleCommentsSidebarOpenChange = (open: boolean) => {
    if (!open) {
      setCommentsOpen(false);
      return;
    }
    if (commentsOpenFromClickRef.current) setCommentsOpen(true);
  };

  const panelButtonClass = (active: boolean) => `relative rounded-md p-1.5 hover:bg-muted ${active ? 'bg-muted text-foreground' : 'text-muted-foreground'}`;
  const revisionShortcut = commentOpenShortcutLabel();

  return (
    <div
      ref={containerRef}
      className={`piecemaker-docx-viewer relative flex flex-col bg-background ${isSidebar ? 'h-full w-full' : 'fixed inset-0 z-[9999]'}`}
      onKeyDownCapture={markUserEditing}
      onPointerDownCapture={handlePointerDown}
      onMouseDownCapture={handleMouseDown}
      onPointerOverCapture={handlePointerOver}
      onPointerMoveCapture={handlePointerMove}
      onPointerOutCapture={handlePointerOut}
    >
      {conflict && <div role="alert" className="border-b border-border px-3 py-2 text-sm">
        <p>Le document a été modifié ailleurs. Vos modifications restent dans l’éditeur.</p>
        <button type="button" onClick={() => { void reloadExternal(); }} className="mr-3 underline">Recharger la version du disque</button>
        <button type="button" onClick={() => { void overwriteExternal(); }} className="underline">Enregistrer ma version</button>
      </div>}
      {error && <p className="border-b border-border px-3 py-1.5 text-xs text-destructive">{error}</p>}
      <DocxReasoningStatus state={reasoningState} onCheck={() => {
        if (projectId && versionRef.current !== null) void checkReasoning(projectId, resolvedPathRef.current, versionRef.current);
      }} />
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
          onCommentsSidebarOpenChange={handleCommentsSidebarOpenChange}
          onCommentsChange={(comments) => setCommentCount(countThreads(comments))}
          renderLogo={() => (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setOutlineOpen((open) => !open)} className={panelButtonClass(outlineOpen)} aria-pressed={outlineOpen} aria-label="Table des matières" title="Table des matières"><ListTree className="h-4 w-4" /></button>
              <button type="button" onClick={() => setCommentsOpen((open) => !open)} className={panelButtonClass(commentsOpen)} aria-pressed={commentsOpen} aria-label="Commentaires" title="Commentaires"><MessageSquare className="h-4 w-4" />{commentCount > 0 && <span className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-primary px-1 text-center text-[10px] font-medium leading-4 text-primary-foreground">{commentCount}</span>}</button>
            </div>
          )}
          renderTitleBarRight={() => (
            <button type="button" onClick={() => { void close(); }} className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted" aria-label="Fermer">✕</button>
          )}
          style={{ flex: 1, minHeight: 0 }}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{error ? file.path : 'Chargement…'}</div>
      )}
      {revisionHint && (
        <div className="docx-revision-shortcut-hint" style={{ left: revisionHint.x, top: revisionHint.y }} role="tooltip">
          {revisionShortcut}
        </div>
      )}
    </div>
  );
}
